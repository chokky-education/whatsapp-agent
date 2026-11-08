#!/usr/bin/env node
// WhatsApp group summarizer bot.
// Logs in as a linked device (like WhatsApp Web), stores group messages in SQLite,
// has Claude describe images/PDFs as they arrive, and posts summaries on command or on a schedule.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  getContentType,
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
} from 'baileys';
import cron from 'node-cron';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import * as db from './db.js';
import { describeMedia } from './describe.js';
import { summarize } from './summarize.js';
import { explainError, hasCredentials, NO_KEY_MESSAGE } from './ai.js';
import * as tasks from './tasks.js';


const logger = pino({ level: process.env.LOG_LEVEL || 'error' });
const log = (...a) => console.log(new Date().toLocaleTimeString('th-TH'), ...a);

fs.mkdirSync(config.mediaDir, { recursive: true });

/** @type {import('baileys').WASocket} */
let sock;
const groupCache = new Map(); // jid -> metadata
const sentByBot = new Set(); // message ids the bot sent, so they never end up in a summary
const pendingMedia = new Map(); // groupJid -> Set<Promise>

const HELP = `🤖 *วิธีใช้บอท*

*คุยกับบอท* — แท็ก @บอท หรือขึ้นต้นด้วย "บอท" แล้วพิมพ์เหมือนคุยกับคน เช่น
- บอท พรุ่งนี้บ่าย 2 เตือน @Somchai ส่ง Render
- บอท ทุกวันจันทร์ 9 โมง เตือนทุกคนอัปเดตงาน
- บอท งาน #3 เสร็จแล้ว / เลื่อนงาน #3 เป็นศุกร์นี้
- บอท ลิงก์ Drive ล่าสุดอยู่ไหน

*ตอบข้อความเตือน* — ตอบกลับว่า "เสร็จแล้ว" หรือกด ✅ เพื่อปิดงาน, "เลื่อน 1 ชม." เพื่อเลื่อน

*คำสั่ง*
- */งาน* — งานที่ยังเปิดอยู่ทั้งหมด
- */เสร็จ 3* — ปิดงาน #3 · */ยกเลิก 3* — ยกเลิกงาน #3
- */สรุป* — สรุปแชทตั้งแต่ครั้งล่าสุด · */สรุป 2 วัน* — ย้อนหลังตามช่วงเวลา
- */สถิติ* — งานที่ปิดได้ใน 7 วัน
- */ช่วย* — แสดงข้อความนี้

บอทจดงานจากแชทให้เอง และสรุปงานของวันนี้ให้ทุกเช้า`;

// ---------- helpers ----------

async function groupMeta(jid) {
  if (groupCache.has(jid)) return groupCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    groupCache.set(jid, meta);
    return meta;
  } catch {
    return null;
  }
}

function isWatched(name) {
  if (!config.watchGroups.length) return true;
  return config.watchGroups.some((g) => g.toLowerCase() === (name || '').toLowerCase());
}

function textOf(content, type) {
  const c = content?.[type];
  if (!c) return null;
  if (typeof c === 'string') return c;
  return c.text || c.caption || c.name || null;
}

const KIND = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  ptvMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  pollCreationMessage: 'text',
  pollCreationMessageV3: 'text',
  locationMessage: 'text',
  contactMessage: 'text',
};

// Swap "@66812345678" mentions for the person's name so Claude knows who is meant.
function resolveMentions(text, mentioned = []) {
  if (!text) return text;
  let out = text;
  for (const jid of mentioned) {
    const num = jid.split('@')[0].split(':')[0];
    const name = db.contactName(jidNormalizedUser(jid));
    if (name) out = out.replaceAll('@' + num, '@' + name);
  }
  return out;
}

function trackMedia(groupJid, promise) {
  if (!pendingMedia.has(groupJid)) pendingMedia.set(groupJid, new Set());
  const set = pendingMedia.get(groupJid);
  set.add(promise);
  promise.finally(() => set.delete(promise));
}

async function waitForMedia(groupJid, ms = 90_000) {
  const set = pendingMedia.get(groupJid);
  if (!set?.size) return;
  await Promise.race([Promise.allSettled([...set]), new Promise((r) => setTimeout(r, ms))]);
}

// Run image/PDF descriptions two at a time.
let running = 0;
const queue = [];
function enqueue(job) {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        resolve(await job());
      } catch (err) {
        log('อธิบายไฟล์ไม่สำเร็จ:', explainError(err));
        resolve(null);
      }
    });
    pump();
  });
}
function pump() {
  while (running < 2 && queue.length) {
    running++;
    queue.shift()().finally(() => {
      running--;
      pump();
    });
  }
}

async function send(jid, text, { mentions = [], taskId = null, reminderId = null, kind = null, quoted = null } = {}) {
  // Pick the id first: WhatsApp echoes our own message back before sendMessage returns,
  // and it must already be known as the bot's so it is never treated as a request.
  const messageId = generateMessageIDV2(sock.user?.id);
  sentByBot.add(messageId);
  db.recordBotMessage(messageId, jid, { taskId, reminderId, kind });
  return sock.sendMessage(
    jid,
    { text, mentions: [...new Set(mentions.filter(Boolean))] },
    { messageId, ...(quoted ? { quoted } : {}) },
  );
}

// ---------- people & addressing ----------

const userPart = (jid) => (jid || '').split('@')[0].split(':')[0];

function botIds() {
  const me = sock.user || {};
  return [me.id, me.lid].filter(Boolean).map(userPart);
}

function isAddressed(text, ctx) {
  if ((ctx?.mentionedJid || []).some((j) => botIds().includes(userPart(j)))) return true;
  const t = (text || '').trim().toLowerCase();
  return config.botNames.some((n) => t.startsWith(n.toLowerCase()) || t.startsWith('@' + n.toLowerCase()));
}

function participantIds(meta) {
  return (meta?.participants || []).flatMap((p) => [p.id, p.lid, p.phoneNumber].filter(Boolean));
}

/** Names of people in the group that we know. */
function peopleIn(meta) {
  const names = new Set();
  for (const p of meta?.participants || []) {
    if ([p.id, p.lid].some((j) => botIds().includes(userPart(j)))) continue;
    const name = [p.id, p.lid, p.phoneNumber].map((j) => j && db.contactName(jidNormalizedUser(j))).find(Boolean);
    if (name) names.add(name);
  }
  return [...names];
}

/** A display name -> the jid to @mention in this group. */
function resolvePerson(meta, name) {
  let jids = db.jidsForName(name);
  if (!jids.length && name) {
    // Nickname / partial match against people in this group, e.g. "som" -> "Somchai".
    const n = name.replace(/^@/, '').trim().toLowerCase();
    const hit = peopleIn(meta).find((p) => p.toLowerCase().startsWith(n) || n.startsWith(p.toLowerCase()));
    if (hit) jids = db.jidsForName(hit);
  }
  if (!jids.length) return null;
  for (const p of meta?.participants || []) {
    const ids = [p.id, p.lid, p.phoneNumber].filter(Boolean).map(userPart);
    if (jids.some((j) => ids.includes(userPart(j)))) return p.id;
  }
  return null;
}

// Find tasks in normal chat a few minutes after the conversation goes quiet.
const syncTimers = new Map();
function scheduleTaskSync(groupJid) {
  if (!config.autoTasks) return;
  clearTimeout(syncTimers.get(groupJid));
  syncTimers.set(
    groupJid,
    setTimeout(async () => {
      syncTimers.delete(groupJid);
      try {
        await waitForMedia(groupJid);
        const meta = await groupMeta(groupJid);
        const result = await tasks.syncTasks(groupJid, peopleIn(meta), (n) => resolvePerson(meta, n));
        if (!result) return;
        if (result.added.length || result.completed.length)
          log(`📌 ${meta?.subject}: งานใหม่ ${result.added.length}, ปิด ${result.completed.length}`);
        const notice = config.announceTasks && tasks.syncNotice(result);
        if (notice) await send(groupJid, notice, { kind: 'sync' });
      } catch (err) {
        log('จดงานอัตโนมัติไม่สำเร็จ:', explainError(err));
      }
    }, config.autoTaskQuietMinutes * 60_000),
  );
}

const DONE_WORDS = /^(✅|✔️|☑️|👍|เสร็จ|เรียบร้อย|ทำแล้ว|ส่งแล้ว|done|ok แล้ว)/i;

/** Someone talked to the bot (mention, its name, or a reply to one of its messages). */
async function handleRequest(m, { groupJid, meta, senderName, senderJid, text, botMsg, quotedText }) {
  const task = botMsg?.task_id ? db.getTask(botMsg.task_id) : null;
  const reminder = botMsg?.reminder_id ? db.getReminder(botMsg.reminder_id) : null;

  // Fast path: "เสร็จแล้ว" in reply to a reminder.
  if (botMsg && DONE_WORDS.test(text.trim())) {
    if (task && task.status === 'open') {
      db.setTaskStatus(task.id, 'done', senderName);
      return send(groupJid, `✅ ปิดงาน #${task.id}: ${task.title} — ขอบคุณครับ ${senderName}`, { quoted: m, taskId: task.id });
    }
    if (task) return send(groupJid, `👍 งาน #${task.id} ปิดไปแล้วครับ`, { quoted: m });
    if (reminder) {
      if (reminder.repeat === 'none') db.deactivateReminder(reminder.id);
      return send(groupJid, `👍 รับทราบครับ ${senderName}`, { quoted: m });
    }
  }

  const cleaned = config.botNames.reduce((t, n) => t.replace(new RegExp('^@?' + n + '[\\s,:]*', 'i'), ''), text.trim());
  const res = await tasks.handleRequest({
    groupJid,
    senderName,
    senderJid,
    text: cleaned || text,
    quoted: botMsg ? { text: quotedText, task, reminder } : null,
    people: peopleIn(meta),
    resolve: (n) => resolvePerson(meta, n),
  });
  return send(groupJid, res.text, { mentions: res.mentions, quoted: m, kind: 'reply' });
}

// ---------- incoming messages ----------

async function handleMessage(m, { live }) {
  const groupJid = m.key?.remoteJid;
  if (!groupJid || !isJidGroup(groupJid) || !m.message) return;

  const meta = await groupMeta(groupJid);
  const groupName = meta?.subject || groupJid;
  if (!isWatched(groupName)) return;

  const content = normalizeMessageContent(m.message);
  const type = getContentType(content);
  const kind = KIND[type];
  if (!kind) return; // reactions, protocol messages, edits, etc.

  const senderJid = m.key.fromMe
    ? jidNormalizedUser(sock.user?.id)
    : jidNormalizedUser(m.key.participant || m.participant || '');
  const senderAlt = m.key.participantAlt ? jidNormalizedUser(m.key.participantAlt) : null;
  const senderName = m.key.fromMe
    ? config.myName || sock.user?.name || 'ฉัน'
    : m.pushName || db.contactName(senderJid) || db.contactName(senderAlt) || senderJid.split('@')[0];
  if (m.pushName) {
    db.rememberContact(senderJid, m.pushName);
    db.rememberContact(senderAlt, m.pushName);
  }

  const ctx = content[type]?.contextInfo;
  let text = textOf(content, type);
  if (type === 'locationMessage') text = `[ตำแหน่ง] ${content.locationMessage.name || ''} ${content.locationMessage.address || ''}`.trim();
  if (type === 'contactMessage') text = `[นามบัตร] ${content.contactMessage.displayName || ''}`;
  if (type.startsWith('pollCreation')) {
    const p = content[type];
    text = `[โพล] ${p.name}: ${(p.options || []).map((o) => o.optionName).join(' / ')}`;
  }
  text = resolveMentions(text, ctx?.mentionedJid);

  const quoted = ctx?.quotedMessage ? normalizeMessageContent(ctx.quotedMessage) : null;
  const quotedText = quoted ? textOf(quoted, getContentType(quoted)) : null;

  const id = m.key.id;
  const ts = Number(m.messageTimestamp) || Math.floor(Date.now() / 1000);
  const fromBot =
    sentByBot.has(id) || Boolean(db.botMessage(id)) || (m.key.fromMe && /^(📋|🤖|⏰|📌|☀️|✅|💤|📅|🗑️|↩️|⚠️)/u.test(text || ''));

  const isNew = db.saveMessage({
    id,
    groupJid,
    groupName,
    senderJid,
    senderName,
    ts,
    kind,
    text,
    fileName: content.documentMessage?.fileName || null,
    quotedText,
    fromBot,
  });

  // Images and PDFs: download, keep a copy, and let Claude describe them.
  const mime = content[type]?.mimetype || '';
  const describable = kind === 'image' || (kind === 'document' && mime === 'application/pdf');
  const recent = ts > Date.now() / 1000 - 3 * 86400; // don't burn tokens on old history
  if (isNew && describable && config.describeMedia && recent) {
    const job = enqueue(async () => {
      const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const ext = kind === 'image' ? (mime.split('/')[1] || 'jpg').split(';')[0] : 'pdf';
      const dir = path.join(config.mediaDir, groupJid.split('@')[0]);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}.${ext}`);
      fs.writeFileSync(file, buffer);
      db.setMediaPath(id, file);

      const recentChat = db
        .getMessages(groupJid, ts - 3600, ts)
        .filter((r) => r.kind === 'text' && r.id !== id)
        .slice(-6)
        .map((r) => `${r.sender_name}: ${r.text}`)
        .join('\n');
      const desc = await describeMedia(buffer, kind === 'image' ? mime.split(';')[0] : 'application/pdf', {
        caption: text,
        sender: senderName,
        recentChat,
      });
      if (desc) {
        db.setMediaDesc(id, desc);
        log(`🖼️  ${groupName} / ${senderName}: ${desc.slice(0, 80)}`);
      }
    });
    trackMedia(groupJid, job);
  }

  if (!live || fromBot) return;

  if (text?.startsWith('/')) {
    await handleCommand(groupJid, groupName, text.trim(), { m, meta, senderName, senderJid }).catch((err) =>
      send(groupJid, `🤖 ทำไม่สำเร็จ: ${explainError(err)}`),
    );
    return;
  }

  const botMsg = ctx?.stanzaId ? db.botMessage(ctx.stanzaId) : null;
  if (text && (botMsg || isAddressed(text, ctx))) {
    db.markToBot(id);
    await handleRequest(m, { groupJid, meta, senderName, senderJid, text, botMsg, quotedText }).catch((err) =>
      send(groupJid, `🤖 ทำไม่สำเร็จ: ${explainError(err)}`),
    );
    return;
  }

  scheduleTaskSync(groupJid);
}

// ✅ on a bot message about a task closes the task.
async function handleReactions(events) {
  for (const { key, reaction } of events) {
    try {
      const botMsg = db.botMessage(key?.id);
      if (!/^(✅|✔️|☑️|👍)/u.test(reaction?.text || '')) continue;
      const task = botMsg?.task_id ? db.getTask(botMsg.task_id) : null;
      if (!task || task.status !== 'open') continue;
      const who = db.contactName(jidNormalizedUser(reaction.key?.participant || '')) || 'ทีม';
      db.setTaskStatus(task.id, 'done', who);
      await send(botMsg.group_jid, `✅ ปิดงาน #${task.id}: ${task.title} — ขอบคุณครับ ${who}`, { taskId: task.id });
    } catch (err) {
      log('อ่านรีแอ็กชันไม่สำเร็จ:', err.message);
    }
  }
}

// ---------- commands ----------

function parseRange(arg) {
  const m = arg.match(/(\d+)\s*(ชม|ชั่วโมง|h|hr|hour|วัน|d|day)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const hours = /^(วัน|d|day)/i.test(m[2]) ? n * 24 : n;
  return hours * 3600;
}

async function handleCommand(groupJid, groupName, text, { m, meta, senderName, senderJid } = {}) {
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  const now = Math.floor(Date.now() / 1000);

  if (['/ช่วย', '/help'].includes(cmd)) return send(groupJid, HELP);

  if (['/งาน', '/task'].includes(cmd)) return send(groupJid, tasks.formatTaskList(groupJid), { kind: 'list' });

  if (['/เสร็จ', '/done', '/ยกเลิก', '/cancel'].includes(cmd)) {
    const id = Number((arg.match(/\d+/) || [])[0]);
    const task = id ? db.getTask(id) : null;
    if (!task || task.group_jid !== groupJid) return send(groupJid, '🤖 ไม่พบงานเลขนี้ ดูเลขงานได้ด้วย /งาน');
    const done = ['/เสร็จ', '/done'].includes(cmd);
    db.setTaskStatus(task.id, done ? 'done' : 'cancelled', senderName);
    return send(groupJid, `${done ? '✅ ปิดงาน' : '🗑️ ยกเลิกงาน'} #${task.id}: ${task.title}`, { taskId: task.id });
  }

  if (['/เตือน', '/remind'].includes(cmd)) {
    if (!arg) return send(groupJid, '🤖 พิมพ์ต่อท้ายว่าจะให้เตือนอะไร เมื่อไหร่ เช่น /เตือน พรุ่งนี้ 9 โมง @Somchai ส่งแบบ');
    return handleRequest(m, { groupJid, meta, senderName, senderJid, text: 'เตือน ' + arg, botMsg: null, quotedText: null });
  }

  if (['/สถิติ', '/stats'].includes(cmd)) {
    const s = db.taskStats(groupJid, now - 7 * 86400);
    const avgH = s.avg_seconds_to_done ? (s.avg_seconds_to_done / 3600).toFixed(1) : '-';
    const pct = s.created ? Math.round(((s.done || 0) / s.created) * 100) : 0;
    return send(
      groupJid,
      `📊 *7 วันล่าสุด*\n- งานใหม่ ${s.created} งาน\n- ปิดแล้ว ${s.done || 0} (${pct}%)\n- ยังเปิด ${s.open || 0} · เลยกำหนด ${s.overdue || 0}\n- เวลาเฉลี่ยจากเปิดถึงปิด ${avgH} ชม.`,
    );
  }

  if (['/สรุป', '/summary', '/sum'].includes(cmd)) {
    const range = parseRange(arg);
    const from = range ? now - range : db.lastSummaryEnd(groupJid) ?? now - 86400;
    await send(groupJid, '🤖 กำลังสรุป...');
    await waitForMedia(groupJid);
    const rows = db.getMessages(groupJid, from + (range ? 0 : 1), now);
    if (!rows.length) return send(groupJid, '🤖 ยังไม่มีข้อความใหม่ให้สรุป');
    const summary = await summarize(rows, {
      groupName,
      previousSummary: range ? null : db.lastSummaryText(groupJid),
    });
    if (!range) db.saveSummary(groupJid, from, rows[rows.length - 1].ts, summary);
    return send(groupJid, summary);
  }

  if (['/งานค้าง', '/tasks', '/todo'].includes(cmd)) {
    await send(groupJid, '🤖 กำลังดูงานค้าง...');
    await waitForMedia(groupJid);
    const rows = db.getMessages(groupJid, now - 7 * 86400, now);
    if (!rows.length) return send(groupJid, '🤖 ไม่มีข้อความใน 7 วันล่าสุด');
    const summary = await summarize(rows, {
      groupName,
      previousSummary: db.lastSummaryText(groupJid),
      focus: 'tasks',
    });
    return send(groupJid, summary);
  }
}

// ---------- scheduled summary ----------

async function scheduledSummary() {
  const now = Math.floor(Date.now() / 1000);
  for (const g of db.knownGroups()) {
    const name = groupCache.get(g.group_jid)?.subject || g.group_name;
    if (!isWatched(name)) continue;
    const from = db.lastSummaryEnd(g.group_jid) ?? now - 86400;
    const rows = db.getMessages(g.group_jid, from + 1, now);
    if (!rows.length) continue;
    try {
      await waitForMedia(g.group_jid);
      const summary = await summarize(rows, { groupName: name, previousSummary: db.lastSummaryText(g.group_jid) });
      const target =
        config.summaryTarget === 'owner' && config.ownerNumber
          ? `${config.ownerNumber}@s.whatsapp.net`
          : g.group_jid;
      await send(target, summary);
      db.saveSummary(g.group_jid, from, rows[rows.length - 1].ts, summary);
      log(`📋 ส่งสรุปประจำวันของ ${name} แล้ว (${rows.length} ข้อความ)`);
    } catch (err) {
      log(`สรุปประจำวันของ ${name} ไม่สำเร็จ:`, explainError(err));
    }
  }
}

// ---------- connection ----------

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  let pairingRequested = false;

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    cachedGroupMetadata: async (jid) => groupCache.get(jid),
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  // Learn people's names (history messages only carry a number).
  const learnContacts = (contacts = []) => {
    for (const c of contacts) {
      const name = c.notify || c.name || c.verifiedName;
      if (!name) continue;
      for (const jid of [c.id, c.lid, c.phoneNumber]) if (jid) db.rememberContact(jidNormalizedUser(jid), name);
    }
  };
  sock.ev.on('contacts.upsert', learnContacts);
  sock.ev.on('contacts.update', learnContacts);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      if (config.pairingNumber && !pairingRequested) {
        pairingRequested = true;
        const code = await sock.requestPairingCode(config.pairingNumber);
        log(`\nรหัสจับคู่: ${code}\nเปิด WhatsApp บนมือถือ > อุปกรณ์ที่ลิงก์ > ลิงก์อุปกรณ์ > ลิงก์ด้วยหมายเลขโทรศัพท์แทน แล้วใส่รหัสนี้\n`);
      } else if (!config.pairingNumber) {
        log('สแกน QR นี้ด้วย WhatsApp บนมือถือ (อุปกรณ์ที่ลิงก์ > ลิงก์อุปกรณ์):');
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === 'open') {
      log(`✅ เชื่อมต่อแล้วในชื่อ ${sock.user?.name || sock.user?.id}`);
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) groupCache.set(jid, meta);
        const names = Object.values(groups).map((g) => g.subject);
        log(`กลุ่มที่บอทอยู่: ${names.join(', ') || '(ยังไม่มี)'}`);
        if (config.watchGroups.length) {
          const missing = config.watchGroups.filter((w) => !names.some((n) => n.toLowerCase() === w.toLowerCase()));
          if (missing.length) log(`⚠️  ไม่พบกลุ่มใน WATCH_GROUPS: ${missing.join(', ')}`);
        }
      } catch (err) {
        log('ดึงรายชื่อกลุ่มไม่ได้:', err.message);
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('❌ ถูกออกจากระบบ ลบโฟลเดอร์ data/auth แล้วรันใหม่เพื่อสแกน QR อีกครั้ง');
        process.exit(1);
      }
      log(`การเชื่อมต่อหลุด (${code ?? 'unknown'}) กำลังต่อใหม่...`);
      setTimeout(start, code === DisconnectReason.restartRequired ? 0 : 3000);
    }
  });

  sock.ev.on('groups.update', async (updates) => {
    for (const u of updates) {
      groupCache.delete(u.id);
      await groupMeta(u.id);
    }
  });
  sock.ev.on('group-participants.update', async (e) => {
    groupCache.delete(e.id);
    await groupMeta(e.id);
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      // Messages you type on your own phone can arrive as "append"; treat fresh ones as live too.
      const fresh = Number(m.messageTimestamp) > Date.now() / 1000 - 120;
      await handleMessage(m, { live: type === 'notify' || (type === 'append' && fresh) }).catch((err) => log('อ่านข้อความไม่สำเร็จ:', err.message));
    }
  });

  sock.ev.on('messages.reaction', (events) => handleReactions(events));

  sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
    learnContacts(contacts);
    for (const m of messages || []) {
      await handleMessage(m, { live: false }).catch(() => {});
    }
  });
}

function fireReminders() {
  return tasks.fireDueReminders(async (r, task) => {
      await send(r.group_jid, tasks.reminderText(r, task), {
        mentions: r.target_jid ? [r.target_jid] : [],
        taskId: task?.id ?? null,
        reminderId: r.id,
        kind: 'reminder',
      });
      log(`⏰ เตือน R${r.id}: ${r.text}`);
  });
}

async function sendBriefings() {
  for (const g of db.knownGroups()) {
    const name = groupCache.get(g.group_jid)?.subject || g.group_name;
    if (!isWatched(name)) continue;
    const text = tasks.briefing(g.group_jid, name);
    if (text) await send(g.group_jid, text, { kind: 'briefing' }).catch((e) => log('ส่งสรุปเช้าไม่สำเร็จ:', e.message));
  }
}

function main() {
  if (!hasCredentials()) {
    console.error(NO_KEY_MESSAGE);
    process.exit(1);
  }
  // Reminders: check every 30 seconds while connected.
  setInterval(() => {
    if (!sock?.user) return;
    fireReminders().catch((e) => log('ระบบเตือนผิดพลาด:', e.message));
  }, 30_000);

  if (config.briefingCron) {
    if (!cron.validate(config.briefingCron)) {
      console.error(`BRIEFING_CRON ไม่ถูกต้อง: ${config.briefingCron}`);
      process.exit(1);
    }
    cron.schedule(config.briefingCron, () => sendBriefings(), { timezone: config.timezone });
    log(`☀️ สรุปงานตอนเช้าตามเวลา "${config.briefingCron}"`);
  }

  if (config.summaryCron) {
  if (!cron.validate(config.summaryCron)) {
    console.error(`SUMMARY_CRON ไม่ถูกต้อง: ${config.summaryCron}`);
    process.exit(1);
  }
  cron.schedule(config.summaryCron, () => scheduledSummary().catch((e) => log(e)), { timezone: config.timezone });
  log(`⏰ สรุปอัตโนมัติตามเวลา "${config.summaryCron}" (${config.timezone}) ส่งไปที่ ${config.summaryTarget === 'owner' ? 'แชทส่วนตัวของเจ้าของ' : 'กลุ่ม'}`);
  }

  start();
}

// Run only when started as a program (`npm start`); tests import the handlers instead.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

export const _test = {
  setSocket: (s) => (sock = s),
  handleMessage,
  handleReactions,
  fireReminders,
  sendBriefings,
  flushTaskSync: async (groupJid) => {
    clearTimeout(syncTimers.get(groupJid));
    syncTimers.delete(groupJid);
  },
  groupCache,
};
