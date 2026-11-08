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
    sent.push({
      jid,
      text: content.text || content.caption || null,
      caption: content.caption || null,
      image: content.image || null,
      mentions: content.mentions,
      quoted: opts.quoted,
      id: opts.messageId,
    });
    return { key: { id: opts.messageId, remoteJid: jid, fromMe: true } };
  },
  groupMetadata: async (jid) => meta[jid],
  updateMediaMessage: async () => {},
};

// Canned AI: tests push the next answer; every call is recorded.
let aiCalls = [];
let aiAnswers = [];
let renderCalls = [];
_stub.askJSON = async (p) => {
  aiCalls.push(p);
  const next = aiAnswers.shift();
  if (next instanceof Error) throw next;
  if (!next) throw new Error(`unexpected AI call: ${p.name}`);
  return typeof next === 'function' ? next(p) : next;
};
_stub.ask = async () => 'สรุปทดสอบ';
// Fake image model: returns a real PNG of the requested canvas size.
_stub.renderImage = async (p) => {
  renderCalls.push(p);
  const [width, height] = (p.size || '1024x1024').split('x').map(Number);
  const { default: sharp } = await import('sharp');
  return {
    buffer: await sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer(),
    mime: 'image/png',
    model: 'gpt-image-2.6-sunburst',
  };
};

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
  renderCalls = [];
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

test('a question about the bot is answered even without a tag; other talk about it is not', async () => {
  reset();
  aiAnswers.push((p) => {
    assert.match(p.system, /ข้อมูลเกี่ยวกับตัวคุณ/);
    return { reply: 'ใช่ครับ ผมเห็นเฉพาะข้อความในกลุ่มนี้ครับ', actions: [] };
  });
  await say(NOK, 'ข้อมูนที่ ai เขาสรุปวงข้อมูรมีแค่ในกุ่มนี้ใช่ไหมชาย');
  assert.equal(sent[0].text, 'ใช่ครับ ผมเห็นเฉพาะข้อความในกลุ่มนี้ครับ');
  await say(NOK, 'bot นี้เจ๋งดี');
  await bot.flushTaskSync(G);
  assert.deepEqual(aiCalls.map((c) => c.name), ['bot_request'], JSON.stringify(sent.map(x=>x.text)));
  assert.equal(sent.length, 1);
});

test('Thai without spaces: "บอทช่วยเตือน…" is a request, "บอทนี้…" / "botox" are not', async () => {
  reset();
  aiAnswers.push({ reply: 'ได้ครับ', actions: [] });
  await say(NOK, 'บอทช่วยเตือนหน่อย');
  await say(NOK, 'บอทนี้ใช้ดีนะ');
  await say(NOK, 'botox ราคาเท่าไหร่');
  await bot.flushTaskSync(G);
  assert.deepEqual(aiCalls.map((c) => c.name), ['bot_request']);
});

test('what the bot says about its own limits matches its real settings', async () => {
  const { INTRO, ABOUT_FOR_AI } = await import('../src/about.js');
  for (const text of [INTRO, ABOUT_FOR_AI]) {
    assert.match(text, new RegExp(`${config.qaContextMessages} ข้อความล่าสุดในช่วง ${config.qaContextDays} วัน`));
    assert.match(text, /สำรองข้อมูลอัตโนมัติ/);
    assert.match(text, /พับจอ/);
    assert.match(text, new RegExp(`ไม่เกิน ${config.offlineReplyHours} ชม`));
  }
  assert.match(ABOUT_FOR_AI, /2 สัปดาห์/);
  assert.match(INTRO, new RegExp(`สูงสุด ${config.maxClients} ราย`));
  assert.match(INTRO, /วิธีบันทึกข้อมูลลูกค้า/);
  assert.match(ABOUT_FOR_AI, new RegExp(`สูงสุด ${config.maxClients} ราย`));
  assert.match(ABOUT_FOR_AI, /วิธีการทำงานฟีเจอร์บันทึกข้อมูลลูกค้า/);
  assert.match(ABOUT_FOR_AI, /\/ลูกค้า/);
  assert.match(ABOUT_FOR_AI, /แอดมินกลุ่มสั่ง \/ลบข้อมูล/);

  // The Q&A really reads that many messages.
  reset();
  config.qaContextMessages = 3;
  for (let i = 1; i <= 6; i++) await say(NOK, `ข้อความทดสอบหน้าต่างที่ ${i}`);
  aiAnswers.push({ reply: 'ครับ', actions: [] });
  await say(SOMCHAI, 'บอท ขอดูข้อความล่าสุด');
  const seen = aiCalls.at(-1).text;
  config.qaContextMessages = 60;
  assert.doesNotMatch(seen, /หน้าต่างที่ 1\b/);
  assert.match(seen, /หน้าต่างที่ 6\b/);
  await bot.flushTaskSync(G);
});

test('/แนะนำ posts the introduction', async () => {
  reset();
  await say(SOMCHAI, '/แนะนำ');
  assert.match(sent[0].text, /ผู้ช่วย AI ของกลุ่มนี้/);
  assert.match(sent[0].text, /\*ข้อจำกัด\*/);
  assert.equal(aiCalls.length, 0);
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

// ---------- after a restart / while the bot was offline ----------

test('messages that arrived while offline: recent requests are answered with an apology, old ones are not', async () => {
  reset();
  const hourAgo = msg(NOK, 'บอท งานไหนค้างบ้าง', { ts: nowTs() - 3600 });
  const twoDaysAgo = msg(NOK, 'บอท งานไหนค้างบ้าง', { ts: nowTs() - 2 * 86400 });
  assert.deepEqual(bot.upsertFlags('append', hourAgo), { live: true, late: true });
  assert.deepEqual(bot.upsertFlags('append', twoDaysAgo), { live: false, late: false });
  assert.deepEqual(bot.upsertFlags('notify', msg(NOK, 'x')), { live: true, late: false });
  // the bot's own echo is "append" but never late
  assert.equal(bot.upsertFlags('append', msg(null, 'x', { fromMe: true, ts: nowTs() - 3600 })).late, false);

  aiAnswers.push({ reply: 'ไม่มีงานค้างครับ', actions: [] });
  await bot.handleMessage(hourAgo, bot.upsertFlags('append', hourAgo));
  assert.match(sent[0].text, /ขอโทษที่ตอบช้า/);
  assert.equal(sent[1].text, 'ไม่มีงานค้างครับ');
  // ordinary chat that arrived late gets no apology
  reset();
  const chat = msg(NOK, 'โอเคครับ', { ts: nowTs() - 3600 });
  await bot.handleMessage(chat, bot.upsertFlags('append', chat));
  await bot.flushTaskSync(G);
  assert.equal(sent.length, 0);
});

test('a reminder sent late says when it was meant for', async () => {
  reset();
  for (const r of db.activeReminders(G)) db.deactivateReminder(r.id);
  const r = db.addReminder({ groupJid: G, text: 'ส่งงานเช้า', nextAt: nowTs() - 3 * 3600 });
  await bot.fireReminders();
  assert.match(sent.at(-1).text, /ส่งช้า เพราะตอนนั้นบอทออฟไลน์/);
  reset();
  db.addReminder({ groupJid: G, text: 'ตรงเวลา', nextAt: nowTs() - 30 });
  await bot.fireReminders();
  assert.doesNotMatch(sent.at(-1).text, /ส่งช้า/);
});

test('a scheduled summary missed while off is sent once on restart', async (t) => {
  const mins = tasks.localMinutes();
  if (mins < 2 || mins > 22 * 60 + 50) return t.skip('needs a time between 00:02 and 22:50');
  reset();
  const saved = { s: config.summaryCron, b: config.briefingCron };
  const m = mins - 1;
  config.summaryCron = `${m % 60} ${Math.floor(m / 60)} * * *`; // "missed" one minute ago
  config.briefingCron = '';
  await say(NOK, 'ข้อความสำหรับสรุป');
  await bot.flushTaskSync(G);
  reset();
  await bot.catchUp();
  await bot.flushTaskSync(G);
  const summaries = sent.filter((x) => x.text === 'สรุปทดสอบ');
  assert.equal(summaries.length, 1);
  reset();
  await bot.catchUp(); // already done today
  await bot.flushTaskSync(G);
  assert.equal(sent.filter((x) => x.text === 'สรุปทดสอบ').length, 0);
  config.summaryCron = saved.s;
  config.briefingCron = saved.b;
});


// Phase 2: history retrieval and erasure use synthetic data only.
test('Drive Q&A retrieves older evidence only from this group, excluding requests', async () => {
  reset();
  const old = nowTs() - 30 * 86400;
  db.saveMessage({ id: 'OLD_DRIVE', groupJid: G, ts: old, kind: 'text', senderName: 'Nok', text: 'แบบบ้าน https://drive.google.com/file/d/FAKE-PLAN/view' });
  db.saveMessage({ id: 'FOREIGN_DRIVE', groupJid: G2, ts: old, kind: 'text', text: 'https://drive.google.com/FAKE-OTHER' });
  db.saveMessage({ id: 'REQUEST_DRIVE', groupJid: G, ts: old, kind: 'text', text: 'drive FAKE-REQUEST' });
  db.markToBot('REQUEST_DRIVE');
  aiAnswers.push({ reply: 'พบลิงก์ครับ', actions: [] });
  await say(NOK, 'บอท ลิงก์ Drive ล่าสุดอยู่ไหน');
  const prompt = aiCalls.at(-1);
  assert.match(prompt.text, /FAKE-PLAN/);
  assert.doesNotMatch(prompt.text, /FAKE-OTHER|FAKE-REQUEST/);
  assert.match(prompt.system, /วันที่\/เวลาอ้างอิง/);
});

test('client revision Q&A finds older edits and descriptions', async () => {
  reset();
  db.saveMessage({ id: 'OLD_REVISION', groupJid: G, ts: nowTs() - 20 * 86400, kind: 'text', senderName: 'Somchai', text: 'ลูกค้าขอปรับประตูเป็นสีขาว' });
  db.saveMessage({ id: 'OLD_REVISION_IMAGE', groupJid: G, ts: nowTs() - 19 * 86400, kind: 'image' });
  db.setMediaDesc('OLD_REVISION_IMAGE', 'ปรับหน้าต่างตามวงสีแดง');
  aiAnswers.push({ reply: 'ปรับประตูครับ', actions: [] });
  await say(NOK, 'บอท ลูกค้าขอแก้อะไรบ้าง');
  assert.match(aiCalls.at(-1).text, /ปรับประตูเป็นสีขาว/);
  assert.match(aiCalls.at(-1).text, /ปรับหน้าต่างตามวงสีแดง/);
});

test('search matches literal terms safely, newest first selection with bounded results', () => {
  for (let i = 0; i < 45; i++) db.saveMessage({ id: `SEARCH${i}`, groupJid: G2, ts: nowTs() - 100 + i, kind: 'text', text: 'UNIQUE_SEARCH_TOKEN' });
  const hits = db.searchMessages(G2, ['UNIQUE_SEARCH_TOKEN']);
  assert.equal(hits.length, 40);
  assert.equal(hits[0].id, 'SEARCH5');
  assert.equal(hits.at(-1).id, 'SEARCH44');
  assert.deepEqual(db.searchMessages(G2, ["' OR 1=1 --"]), []);
});

test('deletion challenges expire, can be cancelled, and cannot be confirmed by another admin', async () => {
  reset();
  meta[G2].participants[0].admin = 'admin';
  meta[G2].participants.push({ id: SOMCHAI.jid, admin: 'admin' });
  await say(NOK, '/ลบข้อมูล', { group: G2 });
  let token = sent.at(-1).text.match(/ยืนยัน ([a-f0-9]{8})/)[1];
  await say(SOMCHAI, `/ลบข้อมูล ยืนยัน ${token}`, { group: G2 });
  assert.match(sent.at(-1).text, /ไม่ถูกต้อง/);
  await say(NOK, '/ลบข้อมูล ยกเลิก', { group: G2 });
  await say(NOK, `/ลบข้อมูล ยืนยัน ${token}`, { group: G2 });
  assert.match(sent.at(-1).text, /ไม่ถูกต้อง/);
  await say(NOK, '/ลบข้อมูล', { group: G2 });
  token = sent.at(-1).text.match(/ยืนยัน ([a-f0-9]{8})/)[1];
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6 * 60_000;
    await say(NOK, `/ลบข้อมูล ยืนยัน ${token}`, { group: G2 });
    assert.match(sent.at(-1).text, /หมดอายุ/);
  } finally { Date.now = realNow; }
  assert.ok(db.getMessages(G2, 0, nowTs() + 3600).length);
  assert.equal(aiCalls.length, 0);
  meta[G2].participants[0].admin = undefined;
  meta[G2].participants.pop();
});

test('deletion requires fresh admin membership and same-sender confirmation; clears only this group', async () => {
  reset();
  await say(SOMCHAI, '/ลบข้อมูล', { group: G2 });
  assert.match(sent.at(-1).text, /เฉพาะแอดมิน/);
  assert.ok(db.getMessages(G2, 0, nowTs()).length);
  meta[G2].participants[0].admin = 'admin';
  await say(NOK, 'บอท ลบข้อมูลทั้งหมด', { group: G2 });
  const challenge = sent.at(-1).text;
  const token = challenge.match(/ยืนยัน ([a-f0-9]{8})/)[1];
  await say(NOK, '/ลบข้อมูล ยืนยัน wrong', { group: G2 });
  assert.match(sent.at(-1).text, /ไม่ถูกต้อง/);
  meta[G2].participants[0].admin = undefined;
  await say(NOK, `/ลบข้อมูล ยืนยัน ${token}`, { group: G2 });
  assert.match(sent.at(-1).text, /เฉพาะแอดมิน/);
  meta[G2].participants[0].admin = 'admin';
  const before = db.getMessages(G, 0, nowTs()).length;
  const t = db.addTask({ groupJid: G2, title: 'ตัวอย่างงาน' });
  db.addReminder({ groupJid: G2, taskId: t, text: 'ตัวอย่างเตือน', nextAt: nowTs() + 3600 });
  db.saveSummary(G2, 0, nowTs(), 'ตัวอย่างสรุป');
  const mediaDir = config.mediaDir;
  config.mediaDir = path.join(tmp, 'media');
  const dir = path.join(config.mediaDir, G2.split('@')[0]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'FAKE.pdf'), 'fake');
  try {
    await say(NOK, `/ลบข้อมูล ยืนยัน ${token}`, { group: G2 });
    assert.match(sent.at(-1).text, /ลบข้อมูลที่บอทเก็บ.*แล้ว/);
    assert.equal(fs.existsSync(dir), false);
  } finally { config.mediaDir = mediaDir; }
  assert.equal(db.getMessages(G2, 0, nowTs()).length, 0);
  assert.equal(db.getTask(t), null);
  assert.equal(db.activeReminders(G2).length, 0);
  assert.equal(db.lastSummaryText(G2), null);
  assert.equal(db.getMessages(G, 0, nowTs()).length, before);
  assert.equal(aiCalls.length, 0);
  const cutoff = db.deletedThrough(G2);
  assert.equal(db.saveMessage({ id: 'HISTORY_REPLAY', groupJid: G2, ts: cutoff - 10, kind: 'text', text: 'เก่า' }), false);
  assert.equal(db.saveMessage({ id: 'NEW_AFTER_ERASURE', groupJid: G2, ts: cutoff + 1, kind: 'text', text: 'ใหม่' }), true);
});

// ---------- client dossiers (Phase 1: up to 10 clients per group) ----------

test('client registration, 10-client quota limit, archiving, and /ลูกค้า views', async () => {
  reset();
  await say(NOK, '/ลูกค้า');
  assert.match(sent.at(-1).text, /ยังไม่มีข้อมูลลูกค้า/);

  aiAnswers.push({
    reply: '',
    actions: [
      act({
        type: 'add_client',
        client: 'คุณสมชาย',
        aliases: 'บ้านลาดพร้าว, พี่ชาย',
        stage: 'design',
        location: 'ลาดพร้าว 71',
        budget: '8 ล้าน',
      }),
      act({
        type: 'add_client_note',
        client: 'บ้านลาดพร้าว',
        category: 'brief',
        title: 'บ้านโมเดิร์น 2 ชั้น 4 ห้องนอน เน้นโปร่ง',
      }),
      act({
        type: 'add_client_note',
        client: 'บ้านลาดพร้าว',
        category: 'spec',
        title: 'กระเบื้องห้องน้ำชั้น 2 ใช้สีเทาด้าน 60x60',
      }),
      act({
        type: 'add_task',
        client: 'บ้านลาดพร้าว',
        title: 'ส่งแบบ 3D ห้องน้ำชั้น 2',
        person: 'Somchai',
      }),
    ],
  });
  await say(NOK, 'บอท เพิ่มลูกค้าคุณสมชาย บ้านลาดพร้าว งบ 8 ล้าน เฟสออกแบบ');
  assert.match(sent.at(-1).text, /เพิ่มลูกค้า.*คุณสมชาย.*บ้านลาดพร้าว/);
  assert.match(sent.at(-1).text, /สเปกวัสดุ.*#N\d+/);
  assert.match(sent.at(-1).text, /\[คุณสมชาย\]/);

  await say(NOK, '/ลูกค้า');
  assert.match(sent.at(-1).text, /\(1\/10\)/);
  assert.match(sent.at(-1).text, /คุณสมชาย.*บ้านลาดพร้าว.*ออกแบบ 3D\/แปลน.*งานค้าง 1/);

  await say(NOK, '/ลูกค้า บ้านลาดพร้าว');
  const dossier = sent.at(-1).text;
  assert.match(dossier, /คุณสมชาย/);
  assert.match(dossier, /ลาดพร้าว 71/);
  assert.match(dossier, /8 ล้าน/);
  assert.match(dossier, /บ้านโมเดิร์น 2 ชั้น/);
  assert.match(dossier, /กระเบื้องห้องน้ำชั้น 2 ใช้สีเทาด้าน 60x60/);
  assert.match(dossier, /ส่งแบบ 3D ห้องน้ำชั้น 2/);

  // Quota check: temporarily set maxClients = 1 and try adding a second client.
  const savedMax = config.maxClients;
  config.maxClients = 1;
  try {
    aiAnswers.push({
      reply: '',
      actions: [act({ type: 'add_client', client: 'คุณนิด', aliases: 'คลินิกอารีย์', stage: 'brief' })],
    });
    await say(NOK, 'บอท เพิ่มลูกค้าคุณนิด คลินิกอารีย์');
    assert.match(sent.at(-1).text, /สูงสุด 1 ราย/);

    // Archiving frees the slot.
    aiAnswers.push({
      reply: '',
      actions: [
        act({ type: 'archive_client', client: 'บ้านลาดพร้าว' }),
        act({ type: 'add_client', client: 'คุณนิด', aliases: 'คลินิกอารีย์', stage: 'brief' }),
      ],
    });
    await say(NOK, 'บอท ปิดโปรเจกต์บ้านลาดพร้าว แล้วเพิ่มคุณนิด คลินิกอารีย์');
    assert.match(sent.at(-1).text, /เก็บถาวร.*คุณสมชาย/);
    assert.match(sent.at(-1).text, /เพิ่มลูกค้า.*คุณนิด/);
  } finally {
    config.maxClients = savedMax;
  }
  // Re-activate คุณสมชาย for subsequent tests
  const somchaiClient = db.getClient(1);
  db.updateClient(somchaiClient.id, { status: 'active' });
});

test('syncTasks captures notes and links tasks only for registered clients, and /ลบโน้ต removes a note', async () => {
  reset();
  db.setLastTaskRow(G, db.maxRow());
  aiAnswers.push({
    new_tasks: [
      { title: 'ทำใบเสนอราคา VO ระเบียง', person: 'Nok', when: null, client: 'บ้านลาดพร้าว' },
      { title: 'เช็กราคาเหล็ก', person: 'Somchai', when: null, client: 'บ้านที่ยังไม่ลงทะเบียน' },
    ],
    completed: [],
    due_changes: [],
    client_notes: [
      { client: 'บ้านลาดพร้าว', category: 'change', text: 'ขยายระเบียงห้องนอนใหญ่เพิ่ม 1.5 ม.' },
      { client: 'บ้านที่ยังไม่ลงทะเบียน', category: 'spec', text: 'ห้ามบันทึกเพราะไม่มีชื่อในระบบ' },
    ],
  });
  await say(NOK, 'บ้านลาดพร้าว ลูกค้าขอขยายระเบียงห้องนอนใหญ่เพิ่ม 1.5 ม. เดี๋ยวพี่ทำใบเสนอราคา VO ให้');
  await wait(300);

  const notice = sent.at(-1).text;
  assert.match(notice, /\[คุณสมชาย\].*ทำใบเสนอราคา VO ระเบียง/);
  assert.match(notice, /อัปเดตแฟ้มลูกค้า/);
  assert.match(notice, /คุณสมชาย.*สั่งแก้\/VO #N(\d+)\]: ขยายระเบียง/);
  assert.doesNotMatch(notice, /ห้ามบันทึก/);

  const noteId = Number(notice.match(/#N(\d+)/)[1]);
  assert.ok(db.getClientNote(noteId));

  await say(NOK, `/ลบโน้ต ${noteId}`);
  assert.match(sent.at(-1).text, /ลบบันทึก #N/);
  assert.equal(db.getClientNote(noteId), null);
});

test('client Q&A includes client dossiers in context and searches by client aliases', async () => {
  reset();
  const old = nowTs() - 25 * 86400;
  db.saveMessage({
    id: 'OLD_ALIAS_MSG',
    groupJid: G,
    ts: old,
    kind: 'text',
    senderName: 'Nok',
    text: 'พี่ชาย ฝากบอกว่าอยากได้ห้องพระชั้นสอง',
  });
  aiAnswers.push({ reply: 'กระเบื้องสีเทาด้าน 60x60 และมีห้องพระชั้นสองครับ', actions: [] });
  await say(SOMCHAI, 'บอท บ้านลาดพร้าวใช้กระเบื้องอะไร');
  const prompt = aiCalls.at(-1);
  assert.match(prompt.text, /แฟ้มลูกค้าในกลุ่มนี้/);
  assert.match(prompt.text, /กระเบื้องห้องน้ำชั้น 2 ใช้สีเทาด้าน 60x60/);
  assert.match(prompt.text, /อยากได้ห้องพระชั้นสอง/, 'alias พี่ชาย expanded from บ้านลาดพร้าว matched older message');
});

test('Phase 1: note provenance (/โน้ต, /ที่มา, /ประวัติโน้ต), edit_client_note, and correction-aware Q&A', async () => {
  reset();
  db.setLastTaskRow(G, db.maxRow());

  // 1. Member sends a spec message in chat, auto-sync captures it with source_ids (and ignores fake IDs)
  aiAnswers.push((p) => {
    assert.match(p.text, /\[#ID:SPEC_MSG_1\]/);
    return {
      new_tasks: [],
      completed: [],
      due_changes: [],
      client_notes: [
        {
          client: 'บ้านลาดพร้าว',
          category: 'spec',
          text: 'พื้นห้องรับแขกใช้กระเบื้องสีขาว',
          source_ids: ['SPEC_MSG_1', 'FAKE_ID_999'],
        },
      ],
    };
  });
  await say(NOK, 'บ้านลาดพร้าว พื้นห้องรับแขกใช้กระเบื้องสีขาวนะครับ', { id: 'SPEC_MSG_1' });
  await wait(300);

  const syncMsg = sent.at(-1).text;
  const noteId = Number(syncMsg.match(/#N(\d+)/)[1]);
  assert.ok(noteId);

  // 2. Check /โน้ต and /ที่มา
  reset();
  await say(SOMCHAI, `/โน้ต ${noteId}`);
  assert.match(sent.at(-1).text, new RegExp(`#N${noteId}.*ฉบับที่ 1`));
  assert.match(sent.at(-1).text, /พื้นห้องรับแขกใช้กระเบื้องสีขาว/);

  await say(SOMCHAI, `/ที่มา ${noteId}`);
  assert.match(sent.at(-1).text, /Nok/);
  assert.match(sent.at(-1).text, /บ้านลาดพร้าว พื้นห้องรับแขกใช้กระเบื้องสีขาวนะครับ/);

  // 3. Edit note via "บอท แก้โน้ต #N... เป็น ..." replying to a correction message
  await say(NOK, 'ขอแก้ครับ เปลี่ยนเป็นกระเบื้องยางลายไม้สีโอ๊ค', { id: 'SPEC_MSG_2' });
  await bot.flushTaskSync(G);
  db.setLastTaskRow(G, db.maxRow());
  reset();

  aiAnswers.push({
    reply: '',
    actions: [
      act({
        type: 'edit_client_note',
        note_id: noteId,
        category: 'spec',
        title: 'พื้นห้องรับแขกใช้กระเบื้องยางลายไม้สีโอ๊ค',
      }),
    ],
  });
  await say(SOMCHAI, `บอท แก้โน้ต #N${noteId} เป็น พื้นห้องรับแขกใช้กระเบื้องยางลายไม้สีโอ๊ค`, {
    id: 'EDIT_REQ_1',
    quotedId: 'SPEC_MSG_2',
  });
  assert.match(sent.at(-1).text, new RegExp(`แก้ไขบันทึก #N${noteId}.*ฉบับที่ 2`));

  // 4. /ประวัติโน้ต shows both revision 1 and revision 2
  reset();
  await say(NOK, `/ประวัติโน้ต ${noteId}`);
  const hist = sent.at(-1).text;
  assert.match(hist, /ฉบับที่ 1.*พื้นห้องรับแขกใช้กระเบื้องสีขาว/);
  assert.match(hist, /ฉบับที่ 2.*พื้นห้องรับแขกใช้กระเบื้องยางลายไม้สีโอ๊ค/);

  // 5. /ที่มา now points to the correction messages (SPEC_MSG_2 and EDIT_REQ_1)
  reset();
  await say(NOK, `/ที่มา ${noteId}`);
  assert.match(sent.at(-1).text, /ขอแก้ครับ เปลี่ยนเป็นกระเบื้องยางลายไม้สีโอ๊ค/);

  // 6. Q&A context marks the current revision and what it superseded so old chat doesn't win
  reset();
  aiAnswers.push({ reply: 'ปัจจุบันใช้กระเบื้องยางลายไม้สีโอ๊คครับ (#N' + noteId + ' ฉบับที่ 2)', actions: [] });
  await say(NOK, 'บอท พื้นห้องรับแขกบ้านลาดพร้าวใช้อะไร');
  const qaPrompt = aiCalls.at(-1).text;
  assert.match(qaPrompt, /พื้นห้องรับแขกใช้กระเบื้องยางลายไม้สีโอ๊ค/);
  assert.match(qaPrompt, /แก้จากเดิม: "พื้นห้องรับแขกใช้กระเบื้องสีขาว"/);
});

// ---------- renders (src/render.js + render routing in bot.js) ----------

const { default: sharp } = await import('sharp');
const solid = (width, height, color = '#808080') =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
let lastRenderMsgId = null;

function saveImage(id, from, bytes, { ts = nowTs() - 5 } = {}) {
  const mediaPath = path.join(tmp, `${id}.png`);
  fs.writeFileSync(mediaPath, bytes);
  db.saveMessage({ id, groupJid: G, senderJid: from.jid, senderName: from.name, ts, kind: 'image', text: '', mediaPath });
  return mediaPath;
}
/** Drop earlier test images so "latest image from this person" starts clean. */
function forgetImages() {
  for (const r of db.getMessages(G, 0, nowTs() + 60)) if (r.kind === 'image') db.setMediaPath(r.id, null);
}
const rowFor = (img) => db.getRender(db.botMessage(img.id).render_id);
const dims = async (buf) => {
  const m = await sharp(buf).metadata();
  return [m.width, m.height];
};
// Image incoming as a WhatsApp image message; the bot finds the file by message id in the media folder.
async function sendImageMsg(from, id, bytes, caption) {
  const dir = path.join(config.mediaDir, G.split('@')[0]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jpeg`), bytes);
  await bot.handleMessage(
    {
      key: { remoteJid: G, id, participant: from.jid, fromMe: false },
      pushName: from.name,
      messageTimestamp: nowTs(),
      message: { imageMessage: { mimetype: 'image/jpeg', ...(caption ? { caption } : {}) } },
    },
    { live: true },
  );
}

test('render helpers: request detection, instruction cleanup, prompt rules', async () => {
  const render = await import('../src/render.js');
  assert.ok(render.isRenderRequest('เรนเดอร์ warm neutral'));
  assert.ok(render.isRenderRequest('ช่วยเรนเดอร์ภาพนี้หน่อย'));
  assert.ok(render.isRenderRequest('render ไฟล์สเก็ต'));
  assert.ok(!render.isRenderRequest('พรุ่งนี้เตือน @Somchai ส่ง Render'));
  assert.equal(render.renderInstruction('เรนเดอร์ภาพจากตัวไฟล์Sketch ตัวนี้ ให้เป็นสไตล์ Warm Neutral'), 'ให้เป็นสไตล์ Warm Neutral');
  assert.equal(render.renderInstruction('เรนเดอร์จากภาพนี้'), '');
  assert.equal(render.renderInstruction('Render ไฟล์สเก็ต ให้เป็นสไตล์ Warm Neutral Palette'), 'ให้เป็นสไตล์ Warm Neutral Palette');

  const fresh = render.buildRenderPrompt({ instruction: 'warm neutral' });
  assert.match(fresh, /every piece of furniture/);
  assert.match(fresh, /Do not add, remove, move, resize/);
  assert.match(fresh, /grey bands .* only padding/);
  assert.match(fresh, /Do not add any text/);
  assert.match(fresh, /warm neutral/);
  const edit = render.buildRenderPrompt({ instruction: 'ไฟอุ่นขึ้น', isEdit: true });
  assert.match(edit, /Apply only this change.*ไฟอุ่นขึ้น/);
});

test('render size: pad to the model canvas, then crop back to the reference size and framing', async () => {
  const render = await import('../src/render.js');
  // A wide SketchUp view (2.4:1) -> landscape canvas with grey bands top and bottom.
  const wide = await render.prepareSource(await solid(1255, 523, '#ff0000'));
  assert.equal(wide.size, '1536x1024');
  assert.deepEqual(await dims(wide.buffer), [1536, 1024]);
  assert.deepEqual(wide.box, { left: 0, top: 192, width: 1536, height: 640 });
  assert.ok(wide.padded);
  const top = await sharp(wide.buffer).extract({ left: 700, top: 10, width: 1, height: 1 }).raw().toBuffer();
  const mid = await sharp(wide.buffer).extract({ left: 700, top: 500, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...top].slice(0, 3), [128, 128, 128], 'band is grey padding');
  assert.deepEqual([...mid].slice(0, 3), [255, 0, 0], 'middle is the sketch');

  // Model output: blue where the sketch was, black in the bands -> cropped result is all blue at 1255x523.
  const out = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#000000' } })
    .composite([{ input: await solid(1536, 640, '#0000ff'), left: 0, top: 192 }])
    .png()
    .toBuffer();
  const fitted = await render.fitToSource(out, wide);
  assert.deepEqual(await dims(fitted), [1255, 523]);
  const stats = await sharp(fitted).stats();
  assert.ok(stats.channels[2].min > 200 && stats.channels[0].max < 40, 'no band pixels left after the crop');

  // Portrait and square sources pick the matching canvas; exact 3:2 needs no padding.
  assert.equal((await render.prepareSource(await solid(800, 1200))).size, '1024x1536');
  assert.equal((await render.prepareSource(await solid(900, 900))).size, '1024x1024');
  assert.equal((await render.prepareSource(await solid(1500, 1000))).padded, false);
  // A model that returns a different resolution is scaled before cropping.
  const half = await sharp(out).resize(768, 512).png().toBuffer();
  assert.deepEqual(await dims(await render.fitToSource(half, wide)), [1255, 523]);
});

test('render: reply to a sketch renders it without the AI, keeps layout rules, output matches the sketch size', async () => {
  reset();
  forgetImages();
  saveImage('SKETCH_1', NOK, await solid(1255, 523));
  await say(NOK, 'บอท เรนเดอร์ warm neutral', { quotedId: 'SKETCH_1' });
  await bot.flushRenders(G);

  assert.equal(aiCalls.length, 0, 'render requests are routed by code, not by the chat AI');
  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0].size, '1536x1024');
  assert.deepEqual(await dims(renderCalls[0].sourceImage.buffer), [1536, 1024], 'model gets the padded canvas');
  assert.match(renderCalls[0].prompt, /warm neutral/);
  assert.match(renderCalls[0].prompt, /every piece of furniture/);
  assert.doesNotMatch(renderCalls[0].prompt, /บ้านลาดพร้าว|บรีฟ|สำรวจ|แฟ้ม/, 'no client name, stage or dossier text');

  assert.match(sent[0].text, /กำลังเรนเดอร์/);
  const img = sent.find((x) => x.image);
  assert.deepEqual(await dims(img.image), [1255, 523], 'sent image has the reference size');
  assert.match(img.caption, /ภาพเรนเดอร์/);
  assert.match(img.caption, /สไตล์: warm neutral/);
  assert.match(img.caption, /ตอบกลับภาพนี้เพื่อสั่งปรับ/);
  const row = rowFor(img);
  assert.equal(row.client_id, null);
  assert.equal(row.source_msg_id, 'SKETCH_1');
  assert.equal(row.version_no, 1);
  assert.deepEqual(await dims(fs.readFileSync(row.output_media_path)), [1255, 523]);
  lastRenderMsgId = img.id;
});

test('render: replying to a rendered image edits that render', async () => {
  reset();
  assert.ok(lastRenderMsgId, 'previous test sent a render');
  const parent = db.getRender(db.botMessage(lastRenderMsgId).render_id);
  await say(SOMCHAI, 'ไฟอุ่นขึ้น', { quotedId: lastRenderMsgId });
  await bot.flushRenders(G);

  assert.equal(aiCalls.length, 0);
  assert.equal(renderCalls.length, 1);
  assert.match(renderCalls[0].prompt, /Apply only this change.*ไฟอุ่นขึ้น/);
  const img = sent.find((x) => x.image);
  assert.match(img.caption, /ภาพที่ปรับแล้ว/);
  assert.deepEqual(await dims(img.image), [1255, 523], 'edits keep the size too');
  const row = rowFor(img);
  assert.equal(row.source_media_path, parent.output_media_path, 'edits the quoted render output');
  assert.equal(row.parent_id, parent.id);
  assert.equal(row.version_no, 2);
});

test('render: image sent with the caption "บอท เรนเดอร์" uses that image', async () => {
  reset();
  forgetImages();
  await sendImageMsg(NOK, 'CAPTION_IMG_1', await solid(1200, 900), 'บอท เรนเดอร์ภาพจากตัวไฟล์Sketch ตัวนี้ ให้บ้านลาดพร้าว');
  await bot.flushRenders(G);
  assert.equal(renderCalls.length, 1);
  const img = sent.find((x) => x.image);
  assert.equal(rowFor(img).source_msg_id, 'CAPTION_IMG_1');
  assert.deepEqual(await dims(img.image), [1200, 900]);
});

test('render: no sketch -> bot asks once, then starts when that person sends an image', async () => {
  reset();
  forgetImages();
  await say(NOK, 'บอท เรนเดอร์ Warm Neutral Palette');
  await bot.flushRenders(G);
  assert.equal(renderCalls.length, 0, 'never draws from text alone');
  assert.match(sent.at(-1).text, /ส่งสเก็ตมาได้เลย/);

  // Someone else's image does not start Nok's render.
  await sendImageMsg(SOMCHAI, 'OTHER_IMG', await solid(400, 300));
  await bot.flushTaskSync(G); // a plain image schedules task capture; not under test here
  await bot.flushRenders(G);
  assert.equal(renderCalls.length, 0);

  await sendImageMsg(NOK, 'LATE_SKETCH', await solid(1000, 600));
  await bot.flushRenders(G);
  assert.equal(renderCalls.length, 1);
  assert.match(renderCalls[0].prompt, /Warm Neutral Palette/, 'keeps the style typed earlier');
  assert.equal(rowFor(sent.find((x) => x.image)).source_msg_id, 'LATE_SKETCH');
  assert.equal(aiCalls.length, 0);

  // The wait is used up: a later image does not render again.
  reset();
  await sendImageMsg(NOK, 'ANOTHER_IMG', await solid(400, 300));
  await bot.flushTaskSync(G);
  await bot.flushRenders(G);
  assert.equal(renderCalls.length, 0);
});

test('render: plain "บอท เรนเดอร์" uses this person\'s latest image from the last 30 minutes', async () => {
  reset();
  forgetImages();
  saveImage('OLD_SKETCH', SOMCHAI, await solid(400, 300), { ts: nowTs() - 3600 });
  saveImage('NOK_SKETCH', NOK, await solid(400, 300), { ts: nowTs() - 30 });
  saveImage('SOMCHAI_SKETCH', SOMCHAI, await solid(640, 480), { ts: nowTs() - 60 });
  await say(SOMCHAI, 'บอท เรนเดอร์');
  await bot.flushRenders(G);
  assert.equal(renderCalls.length, 1);
  assert.equal(rowFor(sent.find((x) => x.image)).source_msg_id, 'SOMCHAI_SKETCH');
  assert.match(renderCalls[0].prompt, /No style was given/);
});

test('render: no daily limit by default; MAX_RENDERS_PER_DAY > 0 caps it; /เรนเดอร์ shows usage', async () => {
  reset();
  assert.equal(config.maxRendersPerDay, 0);
  const saved = config.maxRendersPerDay;
  config.maxRendersPerDay = 1;
  try {
    saveImage('CAP_SKETCH', NOK, await solid(400, 300));
    await say(NOK, 'บอท เรนเดอร์', { quotedId: 'CAP_SKETCH' });
    await bot.flushRenders(G);
    assert.equal(renderCalls.length, 0);
    assert.match(sent.at(-1).text, /วันนี้เรนเดอร์ครบ 1 ภาพแล้ว/);
  } finally {
    config.maxRendersPerDay = saved;
  }
  reset();
  await say(NOK, '/เรนเดอร์');
  assert.match(sent.at(-1).text, /วันนี้ \d+ ภาพ · 7 วัน \d+ ภาพ/);
  assert.match(sent.at(-1).text, /บอท เรนเดอร์/);
});

test('isNetworkError survives dropped connections only', () => {
  const terminated = Object.assign(new TypeError('terminated'), { cause: { code: 'ECONNRESET' } });
  assert.ok(bot.isNetworkError(terminated));
  assert.ok(bot.isNetworkError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })));
  assert.ok(!bot.isNetworkError(new TypeError('Cannot read properties of undefined')));
});
