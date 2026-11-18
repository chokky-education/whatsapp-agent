import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { workLabel } from '../warroom/src/work-protocol.js';

const tmp = mkdtempSync(join(tmpdir(), 'work-bridge-'));
process.env.DB_PATH = join(tmp, 'test.db');
const db = await import('../src/db.js');
const { createWorkBridge, matchWorkMember } = await import('../src/work-bridge.js');
const { formatTaskList } = await import('../src/tasks.js');
process.once('exit', () => rmSync(tmp, { recursive: true, force: true }));

const groupJid = '100000000000001@g.us';
const pilot = randomUUID();
const memberKey = randomUUID();
const owner = '100000000000001@lid';
const ownerPhone = '66800000001@s.whatsapp.net';
const botId = '100000000000002@lid';
const teammate = '100000000000003@lid';
const participant = { id: owner, lid: owner, phoneNumber: ownerPhone };

test('member matching uses verified aliases from one participant only', () => {
  assert.deepEqual([...matchWorkMember([participant], ownerPhone)], [owner, ownerPhone]);
  assert.equal(matchWorkMember([{ id: teammate }], ownerPhone), null);
  assert.equal(matchWorkMember([participant, { id: teammate, phoneNumber: ownerPhone }], ownerPhone), null);
});

test('work fields remove contact identifiers and links, including bare links and hosted JIDs', () => {
  assert.equal(workLabel('ส่งแบบ docs.example.com/mock 100000000000001@hosted.lid nok@example.test', 200),
    'ส่งแบบ ［ลิงก์］ ［ข้อมูลติดต่อ］ ［ข้อมูลติดต่อ］');
});

function makeFixture({ assigned = owner, defer, onAuthorize, onPublish, transport, metadataError } = {}) {
  const taskId = db.addTask({ groupJid, title: 'ตรวจแบบ โทร 66800000001', assigneeName: 'นก', assigneeJid: assigned });
  const reminderId = db.addReminder({ groupJid, taskId, text: 'ตรวจแบบ', nextAt: Math.floor(Date.now() / 1000) + 60 });
  let command, linked = true, calls = 0;
  const payloads = [];
  const socket = {
    user: { id: botId },
    groupMetadata: async () => {
      if (metadataError) throw metadataError;
      return { id: groupJid, subject: 'EXAMPLE STUDIO',
        participants: [{ id: botId }, ...(linked ? [participant] : []), { id: teammate }] };
    },
  };
  const bridge = createWorkBridge({
    settings: { groupJid, pilot, memberKey, memberJid: ownerPhone },
    url: 'https://example.test', token: 'synthetic-bridge-token',
    connection: () => socket, isWatched: (name) => name === 'EXAMPLE STUDIO',
    serialize: async (job) => { await defer?.(); return job(); },
    log: () => {},
    fetch: transport ?? (async (url, req) => {
      const body = JSON.parse(req.body);
      if (url.endsWith('/authorize')) {
        await onAuthorize?.();
        return Response.json({ authorized: true });
      }
      calls++;
      payloads.push(body);
      await onPublish?.(body, calls);
      const next = command;
      command = null;
      return Response.json({ accepted: true, receiptsAccepted: body.mode === 'ready', command: next });
    }),
  });
  function queue(overrides = {}) {
    command = { taskId, requestId: randomUUID(), memberKey, expiresAt: Date.now() + 10000,
      epoch: db.workEpoch(groupJid), ...overrides };
    return command;
  }
  return { bridge, taskId, reminderId, queue, payloads, unlink: () => { linked = false; bridge.invalidate(); } };
}

test('a lost acknowledgement leaves a durable completion and deactivates the one-off reminder once', async () => {
  const fixture = makeFixture({
    onPublish: (_body, calls) => { if (calls === 2) throw new Error('timeout'); },
  });
  const command = fixture.queue();
  await fixture.bridge.tick();
  assert.equal(db.getTask(fixture.taskId).status, 'done');
  const doneAt = db.getTask(fixture.taskId).done_at;
  assert.equal(db.activeReminders(groupJid).some(r => r.id === fixture.reminderId), false);
  assert.equal(formatTaskList(groupJid).includes(`#${fixture.taskId} `), false);
  assert.equal(db.closedTasksBetween(groupJid, doneAt, doneAt).some(t => t.id === fixture.taskId && t.status === 'done'), true);
  fixture.queue(command);
  await fixture.bridge.tick();
  assert.equal(db.getTask(fixture.taskId).done_at, doneAt);
  const published = fixture.payloads[0].tasks.find(({ id }) => id === fixture.taskId);
  assert.equal(published.mine, true);
  assert.equal(published.title.includes('66800000001'), false);
  assert.equal(JSON.stringify(fixture.payloads).includes(ownerPhone), false);
  assert.ok(fixture.payloads.at(-2).outcomes.some(o => o.requestId === command.requestId && o.result === 'applied'));
});

test('completion rechecks the assignee after waiting for the SQLite mutation queue', async () => {
  let fixture;
  fixture = makeFixture({ defer: () => db.updateTask(fixture.taskId, { assignee_jid: teammate }) });
  fixture.queue();
  await fixture.bridge.tick();
  assert.equal(db.getTask(fixture.taskId).status, 'open');
  assert.equal(db.activeReminders(groupJid).some(r => r.id === fixture.reminderId), true);
  assert.ok(fixture.payloads.at(-1).outcomes.some(o => o.reason === 'reassigned'));
});

test('expiry and membership invalidation prevent writing past the authorization window', async () => {
  let fixture;
  fixture = makeFixture({ onAuthorize: () => fixture.unlink() });
  fixture.queue();
  await fixture.bridge.tick();
  assert.equal(db.getTask(fixture.taskId).status, 'open');
  assert.equal(fixture.payloads.at(-1).mode, 'missing');
  const expired = makeFixture();
  expired.queue({ expiresAt: Date.now() - 1 });
  await expired.bridge.tick();
  assert.equal(db.getTask(expired.taskId).status, 'open');
  assert.ok(expired.payloads.at(-1).outcomes.some(o => o.reason === 'expired'));
});

test('definitive group denial and owner removal clear the remote projection rather than preserving a cache', async () => {
  const denied = makeFixture({ metadataError: { data: 403 } });
  await denied.bridge.tick();
  assert.equal(denied.payloads.at(-1).mode, 'missing');
  const fixture = makeFixture();
  await fixture.bridge.tick();
  fixture.bridge.participantsChanged({ id: groupJid, action: 'remove', participants: [participant] });
  assert.equal(fixture.payloads.at(-1).mode, 'missing');
  await fixture.bridge.tick();
  assert.equal(fixture.payloads.at(-1).tasks, null);
  assert.equal(fixture.payloads.at(-1).mode, 'missing');
});

test('group deletion advances the durable epoch and publishes an empty purge', async () => {
  const fixture = makeFixture();
  const previous = db.workEpoch(groupJid);
  db.deleteGroupData(groupJid, Math.floor(Date.now() / 1000));
  assert.equal(db.workEpoch(groupJid), previous + 1);
  assert.equal(await fixture.bridge.purge(groupJid), true);
  assert.equal(fixture.payloads[0].epoch, previous + 1);
  assert.equal(fixture.payloads[0].mode, 'purge');
  assert.equal(fixture.payloads[0].tasks, null);
  assert.equal(db.getTask(fixture.taskId), null);
});

test('the actual Worker and bot settle two queued tasks without losing the next claim in an acknowledgement', async (t) => {
  const { default: worker } = await import('../warroom/src/worker.js');
  const { hash } = await import('../warroom/src/auth.js');
  const { database, seedSession } = await import('../warroom/test/support.js');
  const d1 = database();
  t.after(() => d1.close());
  const env = {
    DB: d1, WORK_ENABLED: 'true', WORK_PILOT_ID: pilot, WORK_MEMBER_KEY: memberKey,
    WORK_BRIDGE_TOKEN: 'synthetic-bridge-token',
  };
  const origin = 'https://example.test';
  const googleSub = 'example-admin';
  const admin = await seedSession(d1);
  await d1.prepare("UPDATE members SET sub=? WHERE email=?").bind(googleSub, admin.email).run();
  await d1.prepare("INSERT INTO work_session_subjects VALUES(?,?)").bind(await hash(admin.raw), googleSub).run();
  await d1.prepare("INSERT INTO work_access VALUES(?,?,?)").bind(pilot, googleSub, memberKey).run();
  const transport = (url, init) => worker.fetch(new Request(url, init), env, {});
  const { taskId, bridge } = makeFixture({ transport });
  const otherId = db.addTask({ groupJid, title: 'เตรียมแบบขยายประตู', assigneeJid: owner });
  const headers = { origin, cookie: `__Host-warroom=${admin.raw}`, 'x-csrf-token': admin.csrf };
  await bridge.tick();
  const requestId = randomUUID();
  const queued = await transport(origin + '/api/work/completions', {
    method: 'POST', headers, body: JSON.stringify({ taskId, requestId }),
  });
  assert.equal(queued.status, 202);
  const secondId = randomUUID();
  assert.equal((await transport(origin + '/api/work/completions', {
    method: 'POST', headers, body: JSON.stringify({ taskId: otherId, requestId: secondId }),
  })).status, 202);
  assert.equal(db.getTask(taskId).status, 'open');
  await bridge.tick();
  await bridge.tick();
  assert.equal(db.getTask(taskId).status, 'done');
  assert.equal(db.getTask(otherId).status, 'done');
  const receipt = await transport(origin + '/api/work/completions/' + requestId, { headers });
  assert.equal((await receipt.json()).state, 'applied');
  const projection = await transport(origin + '/api/work', { headers });
  const { tasks } = await projection.json();
  assert.equal(tasks.find((task) => task.id === taskId).doneAt, db.getTask(taskId).done_at * 1000);
});
