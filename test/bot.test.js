// End-to-end tests of the bot's message handling with a fake WhatsApp socket and a canned AI.
// Nothing is sent to WhatsApp or to an AI provider.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-bot-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.WATCH_GROUPS = '';
process.env.AUTO_TASK_QUIET_MINUTES = '0.001'; // ~60 ms
process.env.ANNOUNCE_TASKS = 'true';
process.env.DESCRIBE_MEDIA = 'false';

const { _test: bot } = await import('../src/bot.js');
const { _stub } = await import('../src/ai.js');
const db = await import('../src/db.js');
const tasks = await import('../src/tasks.js');
const { config } = await import('../src/config.js');

const G = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const NOK = { jid: '100000000000001@lid', name: 'Nok' };
const SOMCHAI = { jid: '100000000000002@lid', name: 'Somchai' };
const BOT_LID = '100000000000009@lid';

const meta = {
  [G]: { id: G, subject: 'TEST GROUP', participants: [{ id: NOK.jid }, { id: SOMCHAI.jid }, { id: BOT_LID }] },
  [G2]: { id: G2, subject: 'OTHER GROUP', participants: [{ id: NOK.jid }, { id: BOT_LID }] },
};

let sent = [];
const fakeSock = {
  user: { id: '66800000000:1@s.whatsapp.net', lid: '100000000000009:1@lid', name: 'BOTTY' },
  sendMessage: async (jid, content, opts = {}) => {
    sent.push({ jid, text: content.text, mentions: content.mentions, quoted: opts.quoted, id: opts.messageId });
    return { key: { id: opts.messageId, remoteJid: jid, fromMe: true } };
  },
  groupMetadata: async (jid) => meta[jid],
  updateMediaMessage: async () => {},
};

// Canned AI: tests push the next answer; every call is recorded.
let aiCalls = [];
let aiAnswers = [];
_stub.askJSON = async (p) => {
  aiCalls.push(p);
  const next = aiAnswers.shift();
  if (next instanceof Error) throw next;
  if (!next) throw new Error(`unexpected AI call: ${p.name}`);
  return typeof next === 'function' ? next(p) : next;
};
_stub.ask = async () => 'สรุปทดสอบ';

let n = 0;
const nowTs = () => Math.floor(Date.now() / 1000);
function msg(from, text, { group = G, mentions, quotedId, fromMe = false, id, ts } = {}) {
  const ctx = mentions || quotedId ? { mentionedJid: mentions, stanzaId: quotedId, quotedMessage: quotedId ? { conversation: 'quoted' } : undefined } : null;
  return {
    key: { remoteJid: group, id: id || `TEST${++n}`, participant: fromMe ? undefined : from.jid, fromMe },
    pushName: fromMe ? undefined : from.name,
    messageTimestamp: ts || nowTs(),
    message: ctx ? { extendedTextMessage: { text, contextInfo: ctx } } : { conversation: text },
  };
}
const say = (from, text, opts) => bot.handleMessage(msg(from, text, opts), { live: true });
const localStr = (ts) => {
  const d = new Date((ts + 7 * 3600) * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
};
const localHour = (ts) => new Date((ts + 7 * 3600) * 1000).getUTCHours();
const act = (o) => ({ type: 'add_task', task_id: null, reminder_id: null, title: null, person: null, when: null, repeat: 'none', ...o });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function reset() {
  sent = [];
  aiCalls = [];
  aiAnswers = [];
}

before(async () => {
  bot.setSocket(fakeSock);
  // Both people talk once so the bot learns their names.
  await say(NOK, 'สวัสดีครับ');
  await say(SOMCHAI, 'สวัสดีพี่');
  await bot.flushTaskSync(G);
  db.setLastTaskRow(G, db.maxRow());
});

// ---------- commands ----------

test('/ช่วย shows help, /งาน with nothing open says so', async () => {
  reset();
  await say(NOK, '/ช่วย');
  await say(NOK, '/งาน');
  assert.match(sent[0].text, /วิธีใช้บอท/);
  assert.match(sent[1].text, /ไม่มีงานค้าง/);
  assert.equal(aiCalls.length, 0);
});

test('/เสร็จ with a bad, missing or foreign task number is refused', async () => {
  reset();
  const foreign = db.addTask({ groupJid: G2, title: 'งานกลุ่มอื่น' });
  await say(NOK, '/เสร็จ 999');
  await say(NOK, '/เสร็จ');
  await say(NOK, `/เสร็จ ${foreign}`);
  assert.equal(sent.length, 3);
  for (const s of sent) assert.match(s.text, /ไม่พบงาน/);
  assert.equal(db.getTask(foreign).status, 'open');
});

test('/เตือน without text explains how to use it', async () => {
  reset();
  await say(NOK, '/เตือน');
  assert.match(sent[0].text, /พิมพ์ต่อท้าย/);
  assert.equal(aiCalls.length, 0);
});

// ---------- addressing the bot ----------

test('"บอท ..." creates a task for the named person with a reminder and an @mention', async () => {
  reset();
  const due = nowTs() + 86400;
  aiAnswers.push({ reply: '', actions: [act({ title: 'ส่ง Render', person: 'Somchai', when: localStr(due) })] });
  await say(NOK, 'บอท พรุ่งนี้เตือน @ชาย ส่ง Render');
  assert.equal(aiCalls[0].name, 'bot_request');
  assert.match(aiCalls[0].text, /คำขอ: พรุ่งนี้เตือน @ชาย ส่ง Render/); // bot name stripped
  const t = db.openTasks(G).find((x) => x.title === 'ส่ง Render');
  assert.ok(t);
  assert.equal(t.assignee_jid, SOMCHAI.jid);
  assert.equal(t.source, 'request');
  const r = db.activeReminders(G).find((x) => x.task_id === t.id);
  assert.ok(r, 'reminder created');
  assert.equal(Math.abs(r.next_at - due) < 60, true);
  assert.deepEqual(sent[0].mentions, [SOMCHAI.jid]);
  assert.match(sent[0].text, /📌 บันทึกงาน #\d+: @100000000000002 ส่ง Render/);
  assert.ok(sent[0].quoted, 'reply quotes the request');
});

test('@mentioning the bot by its LID is treated as a request', async () => {
  reset();
  aiAnswers.push({ reply: 'กลุ่มนี้มี 2 คนครับ', actions: [] });
  await say(SOMCHAI, '@100000000000009 กลุ่มนี้มีกี่คน', { mentions: [BOT_LID] });
  assert.equal(aiCalls.length, 1);
  assert.equal(sent[0].text, 'กลุ่มนี้มี 2 คนครับ');
  assert.match(aiCalls[0].text, /สมาชิกในกลุ่ม: Nok, Somchai/);
});

test('a nickname resolves to the right person when the AI passes it through', async () => {
  reset();
  aiAnswers.push({ reply: '', actions: [act({ title: 'อัปโหลดโลโก้', person: 'som', when: null })] });
  await say(NOK, 'บอท ฝาก som อัปโหลดโลโก้');
  const t = db.openTasks(G).find((x) => x.title === 'อัปโหลดโลโก้');
  assert.equal(t.assignee_jid, SOMCHAI.jid);
  assert.equal(t.assignee_name, 'Somchai', 'stored under the real name');
});

test('"เตือนฉัน" points at the sender', async () => {
  reset();
  aiAnswers.push({ reply: '', actions: [act({ title: 'โทรหาลูกค้า', person: 'ฉัน', when: localStr(nowTs() + 7200) })] });
  await say(NOK, 'บอท อีก 2 ชม. เตือนฉันโทรหาลูกค้า');
  const t = db.openTasks(G).find((x) => x.title === 'โทรหาลูกค้า');
  assert.equal(t.assignee_name, 'Nok');
  assert.equal(t.assignee_jid, NOK.jid);
});

test('a Buddhist-era year from the AI is converted', async () => {
  reset();
  const due = nowTs() + 3 * 86400;
  const be = localStr(due).replace(/^(\d{4})/, (y) => String(+y + 543));
  aiAnswers.push({ reply: '', actions: [act({ title: 'ส่งใบเสนอราคา', person: 'Nok', when: be })] });
  await say(SOMCHAI, 'บอท เตือนพี่ส่งใบเสนอราคา');
  assert.ok(Math.abs(db.openTasks(G).find((t) => t.title === 'ส่งใบเสนอราคา').due_at - due) < 60);
});

test('recurring reminder, and bad actions report clear errors instead of crashing', async () => {
  reset();
  aiAnswers.push({
    reply: '',
    actions: [
      act({ type: 'remind', title: 'อัปเดตงาน', when: localStr(nowTs() + 3600), repeat: 'weekly' }),
      act({ type: 'complete' }), // no task id
      act({ type: 'remind', title: 'ประชุม' }), // no time
      act({ type: 'add_task', title: null }), // no title
    ],
  });
  await say(NOK, 'บอท หลายอย่าง');
  const lines = sent[0].text.split('\n');
  assert.match(lines[0], /⏰ ตั้งเตือน R\d+: .*\(ทุกสัปดาห์\)/);
  assert.equal(lines.filter((l) => l.startsWith('⚠️ ทำไม่ได้')).length, 3);
});

test('a one-off reminder in the past is refused', async () => {
  reset();
  aiAnswers.push({ reply: '', actions: [act({ type: 'remind', title: 'x', when: localStr(nowTs() - 3600) })] });
  await say(NOK, 'บอท เตือนเมื่อชั่วโมงที่แล้ว');
  assert.match(sent[0].text, /ผ่านไปแล้ว/);
});

test('when the AI fails, the group gets an error message', async () => {
  reset();
  aiAnswers.push(new Error('boom'));
  await say(NOK, 'บอท ช่วยหน่อย');
  assert.match(sent[0].text, /ทำไม่สำเร็จ: boom/);
});

test('an empty AI answer still replies something', async () => {
  reset();
  aiAnswers.push({ reply: '', actions: [] });
  await say(NOK, 'บอท อืม');
  assert.match(sent[0].text, /ไม่แน่ใจ/);
});

// ---------- loops & ordering ----------

test("the bot's own echoed messages are never handled or summarized", async () => {
  reset();
  aiAnswers.push({ reply: 'บอทตอบ บอท อะไรสักอย่าง', actions: [] });
  await say(NOK, 'บอท ถามหน่อย');
  const out = sent[0];
  // WhatsApp echoes the bot's message back, even before sendMessage returns.
  await bot.handleMessage(msg(null, out.text, { fromMe: true, id: out.id }), { live: true });
  assert.equal(aiCalls.length, 1, 'no second AI call');
  assert.equal(sent.length, 1);
  const rows = db.getMessages(G, 0, nowTs() + 10);
  assert.ok(!rows.some((r) => r.id === out.id), 'bot message excluded from summaries');
});

test('old messages (history / offline) never trigger replies', async () => {
  reset();
  await bot.handleMessage(msg(NOK, 'บอท เตือนหน่อย', { ts: nowTs() - 3600 }), { live: false });
  await bot.handleMessage(msg(NOK, '/งาน'), { live: false });
  assert.equal(sent.length, 0);
  assert.equal(aiCalls.length, 0);
});

test('groups outside WATCH_GROUPS are ignored', async () => {
  reset();
  config.watchGroups = ['TEST GROUP'];
  await say(NOK, '/งาน', { group: G2 });
  config.watchGroups = [];
  assert.equal(sent.length, 0);
});

test('chatting about the bot without addressing it does not call it', async () => {
  reset();
  await say(NOK, 'นี่คือแชท bot ai ที่ช่วยสรุปงานใช่ไหม');
  await bot.flushTaskSync(G);
  assert.equal(aiCalls.length, 0);
  assert.equal(sent.length, 0);
});

// ---------- replies & reactions on reminders ----------

async function fireOne(r) {
  db.snoozeReminder(r, nowTs() - 1);
  await bot.fireReminders();
  return sent.at(-1);
}

test('a due reminder tags the person, and "เสร็จแล้ว" in reply closes the task without the AI', async () => {
  reset();
  const id = db.addTask({ groupJid: G, title: 'ส่งแบบแก้', assigneeName: 'Somchai', assigneeJid: SOMCHAI.jid });
  const r = db.addReminder({ groupJid: G, taskId: id, text: 'ส่งแบบแก้', targetName: 'Somchai', targetJid: SOMCHAI.jid, nextAt: nowTs() + 999 });
  const m = await fireOne(r);
  assert.match(m.text, /⏰ @100000000000002 ถึงเวลาแล้ว: \*ส่งแบบแก้\* \(งาน #\d+\)/);
  assert.deepEqual(m.mentions, [SOMCHAI.jid]);
  await say(SOMCHAI, 'เสร็จแล้วครับ', { quotedId: m.id });
  assert.equal(db.getTask(id).status, 'done');
  assert.equal(db.getTask(id).done_by, 'Somchai');
  assert.match(sent.at(-1).text, /✅ ปิดงาน/);
  assert.equal(aiCalls.length, 0);
  // Closing the task stops its reminder.
  assert.equal(db.getReminder(r).active, 0);
  // Saying it again is harmless.
  await say(SOMCHAI, 'เสร็จแล้ว', { quotedId: m.id });
  assert.match(sent.at(-1).text, /ปิดไปแล้ว/);
});

test('"เสร็จแล้ว" on a reminder that has no task is acknowledged', async () => {
  reset();
  const r = db.addReminder({ groupJid: G, text: 'ประชุมลูกค้า', nextAt: nowTs() + 999 });
  const m = await fireOne(r);
  await say(NOK, 'เรียบร้อย', { quotedId: m.id });
  assert.match(sent.at(-1).text, /รับทราบ/);
  assert.equal(db.getReminder(r).active, 0);
  assert.equal(aiCalls.length, 0);
});

test('other replies to a reminder go to the AI with the reminder as context (snooze)', async () => {
  reset();
  const id = db.addTask({ groupJid: G, title: 'เช็กสต็อก', assigneeName: 'Nok', assigneeJid: NOK.jid });
  const r = db.addReminder({ groupJid: G, taskId: id, text: 'เช็กสต็อก', targetJid: NOK.jid, nextAt: nowTs() + 999 });
  const m = await fireOne(r);
  const later = nowTs() + 3600;
  aiAnswers.push((p) => {
    assert.match(p.text, new RegExp(`การเตือน R${r}`));
    return { reply: '', actions: [act({ type: 'snooze', reminder_id: null, when: localStr(later) })] };
  });
  await say(NOK, 'เลื่อน 1 ชม.', { quotedId: m.id });
  assert.match(sent.at(-1).text, /💤 เลื่อนเตือน/);
  const after = db.getReminder(r);
  assert.equal(after.active, 1);
  assert.ok(Math.abs(after.next_at - later) < 60);
});

test('✅ reaction on a task reminder closes it; other reactions and messages are ignored', async () => {
  reset();
  const id = db.addTask({ groupJid: G, title: 'ส่งไฟล์ PDF' });
  const r = db.addReminder({ groupJid: G, taskId: id, text: 'ส่งไฟล์ PDF', nextAt: nowTs() + 999 });
  const m = await fireOne(r);
  await bot.handleReactions([{ key: { id: m.id }, reaction: { text: '😂', key: { participant: SOMCHAI.jid } } }]);
  await bot.handleReactions([{ key: { id: 'not-a-bot-message' }, reaction: { text: '✅', key: { participant: SOMCHAI.jid } } }]);
  assert.equal(db.getTask(id).status, 'open');
  await bot.handleReactions([{ key: { id: m.id }, reaction: { text: '✅', key: { participant: SOMCHAI.jid } } }]);
  assert.equal(db.getTask(id).status, 'done');
  assert.match(sent.at(-1).text, /ขอบคุณครับ Somchai/);
});

// ---------- reminder scheduling ----------

test('an open task is followed up MAX_NAGS times in daytime hours, then stops', async () => {
  reset();
  const id = db.addTask({ groupJid: G, title: 'ทวงงาน' });
  const r = db.addReminder({ groupJid: G, taskId: id, text: 'ทวงงาน', nextAt: nowTs() + 999 });
  for (let i = 0; i <= config.maxNags; i++) {
    await fireOne(r);
    const row = db.getReminder(r);
    if (i < config.maxNags) {
      assert.equal(row.active, 1, `still active after send ${i + 1}`);
      const h = localHour(row.next_at);
      assert.ok(h >= 8 && h < 21, `follow-up at ${h}:00 is in daytime`);
      assert.ok(row.next_at > nowTs() + 3600, 'follow-up is hours later');
    } else {
      assert.equal(row.active, 0, 'stops after the last follow-up');
    }
  }
  assert.match(sent.at(-1).text, /ทวงอีกครั้ง/);
});

test('repeating reminders move to the next occurrence and stay active', async () => {
  reset();
  const first = nowTs() - 5;
  const r = db.addReminder({ groupJid: G, text: 'ประชุมทีม', nextAt: first, repeat: 'daily' });
  await bot.fireReminders();
  const row = db.getReminder(r);
  assert.equal(row.active, 1);
  assert.equal(row.next_at - (first - (first % 60)), 86400, 'same minute tomorrow');
  assert.equal(sent.filter((s) => /ประชุมทีม/.test(s.text)).length, 1);
});

test('reminders for closed tasks are dropped without sending', async () => {
  reset();
  const id = db.addTask({ groupJid: G, title: 'ปิดไปแล้ว' });
  const r = db.addReminder({ groupJid: G, taskId: id, text: 'ปิดไปแล้ว', nextAt: nowTs() - 5, repeat: 'daily' });
  db.setTaskStatus(id, 'done', 'x');
  await bot.fireReminders();
  assert.equal(sent.length, 0);
  assert.equal(db.getReminder(r).active, 0);
});

test('a reminder whose send fails is retried on the next tick', async () => {
  reset();
  const r = db.addReminder({ groupJid: G, text: 'ลองส่งใหม่', nextAt: nowTs() - 5 });
  const orig = fakeSock.sendMessage;
  fakeSock.sendMessage = async () => {
    throw new Error('offline');
  };
  await bot.fireReminders();
  fakeSock.sendMessage = orig;
  assert.equal(db.getReminder(r).active, 1, 'kept for retry');
  await bot.fireReminders();
  assert.equal(db.getReminder(r).active, 0);
  assert.match(sent.at(-1).text, /ลองส่งใหม่/);
});

// ---------- automatic task finding ----------

test('normal chat is checked for tasks after a quiet period; requests to the bot are left out', async () => {
  reset();
  db.setLastTaskRow(G, db.maxRow());
  aiAnswers.push({ reply: '', actions: [] }); // the request
  await say(NOK, 'บอท สวัสดี'); // request: must not be re-read as a task
  aiAnswers.push((p) => {
    assert.equal(p.name, 'task_sync');
    assert.doesNotMatch(p.text.split('<ข้อความใหม่>')[1], /บอท สวัสดี/);
    assert.match(p.text, /ฝากแก้ฟาซาดด้วยนะ/);
    return { new_tasks: [{ title: 'แก้ฟาซาด', person: 'Somchai', when: null }], completed: [], due_changes: [] };
  });
  await say(NOK, 'ชาย ฝากแก้ฟาซาดด้วยนะ');
  await say(SOMCHAI, 'ได้ครับ');
  await wait(300);
  assert.equal(aiCalls.filter((c) => c.name === 'task_sync').length, 1, 'one sync for the burst');
  const t = db.openTasks(G).find((x) => x.title === 'แก้ฟาซาด');
  assert.ok(t);
  assert.equal(t.assignee_jid, SOMCHAI.jid);
  assert.match(sent.at(-1).text, /จดงานใหม่ไว้แล้ว/);
});

test('the sync only reads new messages, and closes tasks reported done', async () => {
  reset();
  const t = db.openTasks(G).find((x) => x.title === 'แก้ฟาซาด');
  aiAnswers.push((p) => {
    assert.doesNotMatch(p.text.split('<ข้อความใหม่>')[1], /ฝากแก้ฟาซาด/, 'old messages are context only');
    return { new_tasks: [], completed: [{ task_id: t.id, by: 'Somchai' }, { task_id: 99999, by: null }], due_changes: [] };
  });
  await say(SOMCHAI, 'แก้ฟาซาดเสร็จแล้วครับพี่ ส่งในไดรฟ์แล้ว');
  await wait(300);
  assert.equal(db.getTask(t.id).status, 'done');
  assert.match(sent.at(-1).text, /✅ ปิดงาน #\d+: แก้ฟาซาด/);
});

test('nothing found means no announcement', async () => {
  reset();
  aiAnswers.push({ new_tasks: [], completed: [], due_changes: [] });
  await say(NOK, 'สวยมากเลย');
  await wait(300);
  assert.equal(sent.length, 0);
});

// ---------- briefing, list, stats, summaries ----------

test('morning briefing groups overdue, due today, today reminders and the rest', async () => {
  reset();
  for (const t of db.openTasks(G)) db.setTaskStatus(t.id, 'cancelled');
  for (const r of db.activeReminders(G)) db.deactivateReminder(r.id);
  assert.equal(tasks.briefing(G, 'TEST GROUP'), null, 'nothing to say -> no message');

  const d = new Date((nowTs() + 7 * 3600) * 1000);
  const todayAt = (h) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0) / 1000) - 7 * 3600;
  db.addTask({ groupJid: G, title: 'งานเลยกำหนด', assigneeName: 'Somchai', dueAt: todayAt(10) - 2 * 86400 });
  db.addTask({ groupJid: G, title: 'งานวันนี้', assigneeName: 'Nok', dueAt: todayAt(23) });
  db.addTask({ groupJid: G, title: 'งานไม่มีกำหนด' });
  db.addReminder({ groupJid: G, text: 'เตือนวันนี้', nextAt: todayAt(23) + 30 * 60 });
  const text = tasks.briefing(G, 'TEST GROUP');
  const section = (h) => text.split(h)[1]?.split('\n\n')[0] || '';
  assert.match(section('🔴 *เลยกำหนด*'), /งานเลยกำหนด/);
  assert.match(section('📅 *ครบกำหนดวันนี้*'), /งานวันนี้/);
  assert.match(section('⏰ *เตือนวันนี้*'), /23:30 เตือนวันนี้/);
  assert.match(section('📌 *งานค้างอื่นๆ*'), /งานไม่มีกำหนด/);

  await bot.sendBriefings();
  assert.ok(sent.some((s) => s.jid === G && /☀️/.test(s.text)));
});

test('/งาน lists open tasks by person; /เสร็จ and /ยกเลิก close them; /สถิติ counts them', async () => {
  reset();
  await say(NOK, '/งาน');
  assert.match(sent[0].text, /\*Somchai\*\n- #\d+ งานเลยกำหนด/);
  assert.match(sent[0].text, /\*ยังไม่มีคนรับ\*/);
  const [a, b] = db.openTasks(G);
  await say(NOK, `/เสร็จ ${a.id}`);
  await say(NOK, `/ยกเลิก #${b.id}`);
  assert.equal(db.getTask(a.id).status, 'done');
  assert.equal(db.getTask(b.id).status, 'cancelled');
  await say(NOK, '/สถิติ');
  assert.match(sent.at(-1).text, /📊 \*7 วันล่าสุด\*\n- งานใหม่ \d+ งาน\n- ปิดแล้ว \d+ \(\d+%\)/);
});

test('mentions are stored with names, and commands stay out of summaries', async () => {
  reset();
  await say(NOK, `@${SOMCHAI.jid.split('@')[0]} ดูแบบหน่อย`, { mentions: [SOMCHAI.jid] });
  const rows = db.getMessages(G, nowTs() - 5, nowTs() + 5);
  assert.ok(rows.some((r) => r.text === '@Somchai ดูแบบหน่อย'));
  const { buildTranscript } = await import('../src/summarize.js');
  assert.doesNotMatch(buildTranscript(db.getMessages(G, 0, nowTs() + 5)), /\/งาน|\/สถิติ/);
  await bot.flushTaskSync(G);
});
