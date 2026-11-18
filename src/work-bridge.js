import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isJidGroup, jidNormalizedUser } from 'baileys';
import * as db from './db.js';
import { localDayStartTs } from './tasks.js';
import {
  isTaskId, isWorkId, workLabel, WORK_BODY_LIMIT, WORK_MAX_OUTCOMES, WORK_PROOF_MS, WORK_SYNC_MS, WORK_TTL_MS,
} from '../warroom/src/work-protocol.js';

const normalize = (value) => {
  if (typeof value !== 'string') return null;
  if (/^\d{7,15}$/.test(value)) value += '@s.whatsapp.net';
  const jid = jidNormalizedUser(value);
  return /^\d+@(?:s\.whatsapp\.net|lid|hosted\.lid|hosted)$/.test(jid) ? jid : null;
};
const aliasesOf = (member) => [...new Set([member?.id, member?.lid, member?.phoneNumber].map(normalize).filter(Boolean))];

export function matchWorkMember(participants, ...candidateIds) {
  const ids = candidateIds.map(normalize).filter(Boolean);
  const matches = participants.map(aliasesOf).filter((aliases) => aliases.some((jid) => ids.includes(jid)));
  return matches.length === 1 ? new Set([...matches[0], ...ids]) : null;
}

export function loadWorkPairing(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.mode & 0o077) throw new Error('invalid_work_config');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!entry || !isWorkId(entry.pilot) || !isWorkId(entry.memberKey) ||
      typeof entry.groupJid !== 'string' || !isJidGroup(entry.groupJid) || !normalize(entry.memberJid)) {
    throw new Error('invalid_work_config');
  }
  return { pilot: entry.pilot, groupJid: entry.groupJid, memberKey: entry.memberKey, memberJid: normalize(entry.memberJid) };
}

async function within(job, ms) {
  let timer;
  try {
    return await Promise.race([job, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

export function createWorkBridge({ settings, url, token, connection, isWatched, serialize, log, fetch = globalThis.fetch }) {
  const endpoint = new URL('/api/work/bridge', url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('invalid_work_url');
  const { pilot, memberKey, groupJid, memberJid } = settings;
  const runId = randomUUID();
  let revisionOfMembership = 0;
  let proof = null;
  let lastMemberIds = new Set([memberJid]);
  let lastBotIds = new Set();
  let removedAt = null;
  let busy = false;
  let lastWarning = 0;

  function warn() {
    if (Date.now() - lastWarning < 60_000) return;
    lastWarning = Date.now();
    log('ซิงก์รายการงาน Warroom ไม่สำเร็จ');
  }

  function invalidate() {
    revisionOfMembership++;
    proof = null;
  }

  function current(value) {
    return value && value.socket === connection() && value.revision === revisionOfMembership;
  }

  async function membership(force = false) {
    const socket = connection();
    if (!socket) return null;
    if (removedAt !== null && Date.now() - removedAt < 2 * WORK_SYNC_MS) return null;
    if (!force && current(proof) && Date.now() - proof.checkedAt < WORK_PROOF_MS - WORK_SYNC_MS) return proof;
    const revision = revisionOfMembership;
    const checked = await within((async () => {
      const checkedAt = Date.now();
      try {
        const meta = await socket.groupMetadata(groupJid);
        if (meta?.id !== groupJid || !Array.isArray(meta.participants)) return null;
        const member = matchWorkMember(meta.participants, memberJid);
        const aliases = member || (memberJid.endsWith('@s.whatsapp.net')
          ? matchWorkMember(meta.participants, memberJid,
            await socket.signalRepository?.lidMapping?.getLIDForPN(memberJid))
          : null);
        const bot = matchWorkMember(meta.participants, socket.user?.id, socket.user?.lid);
        const mode = aliases && bot && isWatched(meta.subject) &&
          ![...aliases].some((id) => bot.has(id)) ? 'ready' : 'missing';
        return { mode, aliases, bot, checkedAt, socket, revision };
      } catch (error) {
        const code = Number(error?.data || error?.output?.statusCode);
        if ([401, 403, 404, 410].includes(code)) return { mode: 'missing', checkedAt, socket, revision };
        return null;
      }
    })(), 4000);
    proof = current(checked) ? checked : null;
    if (proof?.mode === 'ready') {
      lastMemberIds = proof.aliases;
      lastBotIds = proof.bot;
      removedAt = null;
    }
    return proof;
  }

  async function send(suffix, data) {
    const requestBody = JSON.stringify(data);
    if (Buffer.byteLength(requestBody) > WORK_BODY_LIMIT) throw new Error('work_payload_too_large');
    const response = await fetch(endpoint.href + suffix, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: requestBody,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (response.status === 409 && suffix === '/authorize') return { authorized: false };
    if (!response.ok) throw new Error('work_request_failed');
    return response.json();
  }

  async function publish(check, {
    mode = current(check) ? check.mode : removedAt === null ? 'offline' : 'missing', claim = true,
  } = {}) {
    const generatedAt = Date.now();
    const epoch = db.workEpoch(groupJid);
    const revision = db.nextWorkRevision(pilot);
    let tasks = null, outcomes = [];
    if (mode === 'ready') {
      const seconds = Math.floor(generatedAt / 1000);
      tasks = db.workTasks(groupJid, localDayStartTs(seconds), seconds).map((row) => ({
        id: row.id,
        title: workLabel(row.title, 360),
        projectId: row.project_id,
        project: workLabel(row.project, 120),
        assignee: workLabel(row.assignee_name, 80),
        mine: check.aliases.has(normalize(row.assignee_jid)),
        dueAt: row.due_at === null ? null : row.due_at * 1000,
        doneAt: row.done_at === null ? null : row.done_at * 1000,
      }));
      outcomes = db.pendingWorkReceipts(pilot, groupJid, epoch, generatedAt - WORK_TTL_MS, WORK_MAX_OUTCOMES);
    }
    const data = { pilot, memberKey, runId, revision, epoch, mode, claim, generatedAt,
      proofAt: check?.checkedAt ?? null, tasks, outcomes };
    if (mode === 'ready' && Buffer.byteLength(JSON.stringify(data)) > WORK_BODY_LIMIT) {
      warn();
      return send('', { ...data, mode: 'offline', proofAt: null, tasks: null, outcomes: [] });
    }
    const reply = await send('', data);
    if (reply.accepted && reply.receiptsAccepted && outcomes.length) {
      db.acknowledgeWorkReceipts(pilot, outcomes.map(({ requestId }) => requestId));
    }
    return reply;
  }

  async function complete(command) {
    if (!isTaskId(command.taskId) || !isWorkId(command.requestId) || command.memberKey !== memberKey ||
        !Number.isSafeInteger(command.expiresAt) || command.epoch !== db.workEpoch(groupJid)) return;
    let rejection = 'expired';
    let aliases = null;
    if (Date.now() < command.expiresAt) {
      const check = await membership(true);
      rejection = current(check) ? 'forbidden' : 'offline';
      if (current(check) && check.mode === 'ready' && Date.now() < command.expiresAt) {
        // Claim authorization is short and cannot be reused. Recheck the socket and membership after awaiting it.
        const response = await send('/authorize', { pilot, runId, ...command });
        if (response.authorized && current(check)) {
          aliases = check.aliases;
          rejection = null;
        }
      }
    }
    db.applyWorkCompletion(pilot, groupJid, command, (jid) => aliases?.has(normalize(jid)), { rejection });
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const response = await publish(await membership());
      if (response.accepted && response.command) {
        await serialize(() => complete(response.command));
        await publish(await membership(), { claim: false });
      }
    } catch {
      warn();
    } finally {
      busy = false;
    }
  }

  async function purge(jid) {
    if (jid !== groupJid) return null;
    try {
      return (await publish(null, { mode: 'purge' })).accepted === true;
    } catch {
      warn();
      return false;
    }
  }

  function participantsChanged(event) {
    if (event.id !== groupJid) return;
    const socket = connection();
    const affected = (event.participants ?? []).flatMap(aliasesOf);
    const botIds = [socket?.user?.id, socket?.user?.lid].map(normalize);
    const target = affected.some((id) => lastMemberIds.has(id) || lastBotIds.has(id) || botIds.includes(id));
    invalidate();
    if (target && event.action === 'remove') {
      removedAt = Date.now();
      // Publish the denial independently of a slow request already holding the task sync loop.
      void publish(null, { mode: 'missing', claim: false }).catch(warn);
      return;
    }
    void tick();
  }

  return {
    tick, purge, invalidate, participantsChanged,
    start() {
      void tick();
      setInterval(tick, WORK_SYNC_MS).unref();
    },
  };
}
