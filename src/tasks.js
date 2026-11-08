// Phase 1: tasks, reminders and the morning briefing.
// The AI only turns chat into structured actions; this file applies them to the database
// and writes every confirmation itself, so the bot never claims something it didn't do.

import { askJSON } from './ai.js';
import { config } from './config.js';
import * as db from './db.js';
import { buildTranscript } from './summarize.js';

const OFFSET_HOURS = config.utcOffsetHours;
const DAY = 86400;

// ---------- time helpers (Asia/Bangkok has no DST, so a fixed offset is exact) ----------

const local = (ts) => new Date((ts + OFFSET_HOURS * 3600) * 1000); // read with getUTC*()
const fromLocal = (y, m, d, hh, mm) => Math.floor(Date.UTC(y, m, d, hh, mm) / 1000) - OFFSET_HOURS * 3600;

export function nowTs() {
  return Math.floor(Date.now() / 1000);
}

/** "2026-11-09 14:00" (local) -> unix seconds, or null */
export function parseLocal(s) {
  const m = (s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const year = +m[1] > 2400 ? +m[1] - 543 : +m[1]; // Buddhist Era slipped in: 2569 -> 2026
  return fromLocal(year, +m[2] - 1, +m[3], +m[4], +m[5]);
}

const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const pad = (n) => String(n).padStart(2, '0');

const dayKey = (ts) => {
  const d = local(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
};

/** Short Thai date/time, e.g. "วันนี้ 14:00", "พรุ่งนี้ 09:00", "ศ. 13 พ.ย. 10:00" */
export function fmtWhen(ts) {
  const d = local(ts);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const today = dayKey(nowTs());
  if (dayKey(ts) === today) return `วันนี้ ${time}`;
  if (dayKey(ts) === dayKey(nowTs() + DAY)) return `พรุ่งนี้ ${time}`;
  if (dayKey(ts) === dayKey(nowTs() - DAY)) return `เมื่อวาน ${time}`;
  return `${TH_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${time}`;
}

function nowForPrompt() {
  const d = local(nowTs());
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )} (วัน${TH_DAYS[d.getUTCDay()]}, เวลาไทย)`;
}

const REPEAT_LABEL = { none: '', daily: 'ทุกวัน', weekdays: 'ทุกวันจันทร์–ศุกร์', weekly: 'ทุกสัปดาห์', monthly: 'ทุกเดือน' };

/** Next time a repeating reminder fires after `ts`. */
export function nextOccurrence(ts, repeat) {
  const d = local(ts);
  const [y, m, day, hh, mm] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
  switch (repeat) {
    case 'daily':
      return fromLocal(y, m, day + 1, hh, mm);
    case 'weekly':
      return fromLocal(y, m, day + 7, hh, mm);
    case 'weekdays': {
      let n = fromLocal(y, m, day + 1, hh, mm);
      while ([0, 6].includes(local(n).getUTCDay())) n += DAY;
      return n;
    }
    case 'monthly': {
      // Keep the day of month; clamp to the month's last day (31 -> 30/28).
      const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
      return fromLocal(y, m + 1, Math.min(day, last), hh, mm);
    }
    default:
      return null;
  }
}

/** Move a follow-up out of the night (21:00–08:00) to 09:00. */
function daytime(ts) {
  const d = local(ts);
  const h = d.getUTCHours();
  if (h >= 21) return fromLocal(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 9, 0);
  if (h < 8) return fromLocal(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0);
  return ts;
}

// ---------- formatting ----------

function taskLine(t, { withOwner = true } = {}) {
  const owner = withOwner && t.assignee_name ? `${t.assignee_name}: ` : '';
  const due = t.due_at ? ` (กำหนด ${fmtWhen(t.due_at)})` : '';
  return `- #${t.id} ${owner}${t.title}${due}`;
}

export function formatTaskList(groupJid) {
  const tasks = db.openTasks(groupJid);
  const reminders = db.activeReminders(groupJid).filter((r) => r.repeat !== 'none' || !r.task_id);
  if (!tasks.length && !reminders.length) return '🤖 ตอนนี้ไม่มีงานค้างครับ 🎉';

  const lines = ['📌 *งานที่ยังเปิดอยู่*'];
  const byOwner = new Map();
  for (const t of tasks) {
    const k = t.assignee_name || 'ยังไม่มีคนรับ';
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(t);
  }
  for (const [owner, list] of byOwner) {
    lines.push(`\n*${owner}*`);
    for (const t of list) lines.push(taskLine(t, { withOwner: false }));
  }
  if (reminders.length) {
    lines.push('\n⏰ *การเตือนที่ตั้งไว้*');
    for (const r of reminders) {
      const rep = REPEAT_LABEL[r.repeat] ? ` (${REPEAT_LABEL[r.repeat]})` : '';
      lines.push(`- R${r.id} ${fmtWhen(r.next_at)}${rep}: ${r.target_name ? r.target_name + ' — ' : ''}${r.text}`);
    }
  }
  lines.push('\nปิดงาน: ตอบ "เสร็จ #เลข" หรือพิมพ์ /เสร็จ เลข');
  return lines.join('\n');
}

/** Morning briefing. Returns null when there is nothing to say. */
export function briefing(groupJid, groupName) {
  const now = nowTs();
  const today = dayKey(now);
  const tasks = db.openTasks(groupJid);
  const reminders = db.activeReminders(groupJid).filter((r) => dayKey(r.next_at) === today);
  if (!tasks.length && !reminders.length) return null;

  const overdue = tasks.filter((t) => t.due_at && t.due_at < now && dayKey(t.due_at) !== today);
  const dueToday = tasks.filter((t) => t.due_at && dayKey(t.due_at) === today);
  const rest = tasks.filter((t) => !overdue.includes(t) && !dueToday.includes(t));

  const d = local(now);
  const lines = [`☀️ *งานวันนี้ — ${groupName}*`, `วัน${TH_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]}`];
  if (overdue.length) lines.push('', '🔴 *เลยกำหนด*', ...overdue.map((t) => taskLine(t)));
  if (dueToday.length) lines.push('', '📅 *ครบกำหนดวันนี้*', ...dueToday.map((t) => taskLine(t)));
  if (reminders.length) {
    lines.push('', '⏰ *เตือนวันนี้*');
    for (const r of reminders) lines.push(`- ${fmtWhen(r.next_at).replace('วันนี้ ', '')} ${r.target_name ? r.target_name + ': ' : ''}${r.text}`);
  }
  if (rest.length) lines.push('', '📌 *งานค้างอื่นๆ*', ...rest.map((t) => taskLine(t)));
  lines.push('', 'ทำเสร็จแล้วตอบ "เสร็จ #เลข" ได้เลยครับ');
  return lines.join('\n');
}

export function reminderText(r, task) {
  const who = r.target_jid ? `@${r.target_jid.split('@')[0]} ` : r.target_name ? `${r.target_name} ` : '';
  const ref = task ? ` (งาน #${task.id})` : '';
  const follow = r.sent_count > 0 && r.repeat === 'none' ? ' — ทวงอีกครั้ง' : '';
  return `⏰ ${who}ถึงเวลาแล้ว${follow}: *${r.text}*${ref}\nทำแล้วตอบกลับข้อความนี้ว่า "เสร็จแล้ว" หรือกด ✅ / อยากเลื่อนตอบว่า "เลื่อน 1 ชม."`;
}

// ---------- applying actions ----------

const ACTION_TYPES = ['add_task', 'remind', 'complete', 'reopen', 'cancel', 'snooze', 'change_due'];
const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];

const REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'task_id', 'reminder_id', 'title', 'person', 'when', 'repeat'],
        properties: {
          type: { type: 'string', enum: ACTION_TYPES },
          task_id: { type: ['integer', 'null'] },
          reminder_id: { type: ['integer', 'null'] },
          title: { type: ['string', 'null'] },
          person: { type: ['string', 'null'] },
          when: { type: ['string', 'null'] },
          repeat: { type: 'string', enum: REPEATS },
        },
      },
    },
  },
};

function contextBlock(groupJid, people) {
  const tasks = db.openTasks(groupJid);
  const reminders = db.activeReminders(groupJid);
  return [
    `เวลาตอนนี้: ${nowForPrompt()}`,
    `สมาชิกในกลุ่ม: ${people.join(', ') || '(ไม่ทราบ)'}`,
    `งานที่เปิดอยู่:\n${tasks.map((t) => taskLine(t)).join('\n') || '(ไม่มี)'}`,
    `การเตือนที่ตั้งไว้:\n${
      reminders
        .map((r) => `- R${r.id} ${fmtWhen(r.next_at)} repeat=${r.repeat}${r.task_id ? ` งาน #${r.task_id}` : ''}: ${r.target_name || ''} ${r.text}`)
        .join('\n') || '(ไม่มี)'
    }`,
  ].join('\n\n');
}

const REQUEST_SYSTEM = `คุณคือผู้ช่วยในกลุ่ม WhatsApp ของทีม (บริบท: ${config.groupContext})
มีคนเรียกคุณในกลุ่ม แปลงคำขอให้เป็น actions ตามสคีมา

ประเภท action:
- add_task: สิ่งที่ใครสักคนต้องทำให้เสร็จครั้งเดียว รวมถึง "เตือน X ให้ทำ Y พรุ่งนี้" แบบครั้งเดียว ใส่ title สั้นๆ ขึ้นต้นด้วยคำกริยา, person = คนที่ต้องทำ และ when = กำหนดส่ง/เวลาเตือน ระบบจะเตือนตอนถึงเวลาและทวงซ้ำจนกว่าจะปิดงาน
- remind: การเตือนซ้ำเป็นประจำ (ทุกวัน/ทุกสัปดาห์/ทุกเดือน) หรือการเตือนที่ไม่ใช่งาน เช่น นัดประชุม ใส่ title = เรื่องที่เตือน, person = คนที่ต้องเตือน (หรือ null ถ้าเตือนทั้งกลุ่ม), when = เวลาเตือนครั้งแรก, repeat ตามที่ขอ ถ้าเกี่ยวกับงานที่มีอยู่ให้ใส่ task_id ด้วย
- complete / reopen / cancel: ปิดงาน เปิดงานใหม่ หรือยกเลิกงาน ต้องใส่ task_id
- snooze: เลื่อนการเตือน ใส่ reminder_id (หรือ task_id) และ when ใหม่
- change_due: เปลี่ยนกำหนดส่งของงาน ใส่ task_id และ when ใหม่

กติกา:
- when ใช้รูปแบบ "YYYY-MM-DD HH:MM" เวลาไทยเสมอ คำนวณจาก "เวลาตอนนี้" เช่น "บ่ายสาม" = 15:00, "2 ทุ่ม" = 20:00, "พรุ่งนี้เช้า" = 09:00, "ศุกร์หน้า" = วันศุกร์ของสัปดาห์หน้า ถ้าบอกแค่วันไม่บอกเวลา ใช้ 09:00 ถ้าเวลาที่ได้ผ่านไปแล้ววันนี้ ให้เป็นวันถัดไป
- "เตือนฉัน/ผม/พี่/หนู/เรา" หมายถึงคนที่ส่งข้อความ
- person ต้องเป็นชื่อที่ตรงกับรายชื่อสมาชิกเป๊ะๆ ถ้าเรียกด้วยชื่อเล่นหรือสะกดต่าง (เช่น "ชาย" = Somchai) ให้แปลงเป็นชื่อในรายชื่อ ถ้าไม่มีคนนั้นในกลุ่มให้ใช้ชื่อตามที่เขียน
- field ที่ไม่ใช้ให้เป็น null และ repeat = "none"
- ถ้าเป็นคำถาม (เช่น งานของใครค้างอยู่, ลิงก์ล่าสุดอยู่ไหน, ลูกค้าขอแก้อะไร) ให้ actions = [] และตอบใน reply โดยใช้ข้อมูลจากบทสนทนาและรายการงานเท่านั้น ถ้าไม่มีข้อมูลให้บอกตรงๆ
- ถ้าเป็นคำสั่ง ให้ reply เป็น "" ระบบจะยืนยันให้เอง ยกเว้นถ้าคำขอกำกวมจนทำไม่ได้ ให้ actions = [] และถามกลับสั้นๆ ใน reply
- reply เขียนภาษาไทยสั้นๆ จัดรูปแบบแบบ WhatsApp (*ตัวหนา*) ไม่ใช้ markdown หัวข้อ`;

/**
 * Someone addressed the bot. Turn the request into actions, apply them, and return the reply text.
 * @param {{ groupJid: string, senderName: string, senderJid: string, text: string,
 *   quoted?: { text?: string, task?: object|null, reminder?: object|null } | null,
 *   people: string[], resolve: (name: string) => string|null }} p
 * @returns {Promise<{ text: string, mentions: string[] }>}
 */
export async function handleRequest(p) {
  const recent = db.getMessages(p.groupJid, nowTs() - 7 * DAY, nowTs()).slice(-60);
  const quoted = p.quoted
    ? `\n\nข้อความของบอทที่ถูกตอบกลับ: "${p.quoted.text || ''}"${p.quoted.task ? ` (งาน #${p.quoted.task.id})` : ''}${
        p.quoted.reminder ? ` (การเตือน R${p.quoted.reminder.id})` : ''
      }`
    : '';

  const result = await askJSON({
    system: REQUEST_SYSTEM,
    name: 'bot_request',
    schema: REQUEST_SCHEMA,
    effort: 'low',
    text: [
      contextBlock(p.groupJid, p.people),
      `<บทสนทนาล่าสุด>\n${buildTranscript(recent)}\n</บทสนทนาล่าสุด>`,
      `คนที่เรียก: ${p.senderName}${quoted}`,
      `คำขอ: ${p.text}`,
    ].join('\n\n'),
  });

  const confirmations = [];
  const mentions = [];
  for (const a of result.actions || []) {
    try {
      const line = applyAction(a, p);
      if (line) {
        confirmations.push(line.text);
        mentions.push(...line.mentions);
      }
    } catch (err) {
      confirmations.push(`⚠️ ทำไม่ได้: ${err.message}`);
    }
  }
  const text = [result.reply?.trim(), ...confirmations].filter(Boolean).join('\n');
  return { text: text || '🤖 ไม่แน่ใจว่าต้องทำอะไร ลองพิมพ์ใหม่อีกครั้งนะครับ', mentions };
}

function mentionFor(jid, name) {
  return jid ? `@${jid.split('@')[0]}` : name || '';
}

function applyAction(a, p) {
  const by = p.senderName;
  const self = a.person && /^(ฉัน|ผม|พี่|หนู|เรา|me)$/i.test(a.person.trim());
  const asked = self ? p.senderName : a.person;
  const personJid = asked ? (asked === p.senderName ? p.senderJid : p.resolve(asked)) : null;
  // Use the person's real name once we know who it is ("som" -> "Somchai").
  const personName = (personJid && db.contactName(personJid)) || asked;
  const when = a.when ? parseLocal(a.when) : null;
  const repeat = REPEATS.includes(a.repeat) ? a.repeat : 'none';
  const task = a.task_id ? db.getTask(a.task_id) : p.quoted?.task || null;
  if (task && task.group_jid !== p.groupJid) throw new Error(`ไม่พบงาน #${a.task_id}`);

  switch (a.type) {
    case 'add_task': {
      if (!a.title) throw new Error('ไม่รู้ว่างานคืออะไร');
      const id = db.addTask({
        groupJid: p.groupJid,
        title: a.title,
        assigneeName: personName,
        assigneeJid: personJid,
        createdBy: by,
        source: 'request',
        dueAt: when,
      });
      if (when && when > nowTs()) {
        db.addReminder({ groupJid: p.groupJid, taskId: id, text: a.title, targetName: personName, targetJid: personJid, nextAt: when, createdBy: by });
      }
      const who = personName ? `${mentionFor(personJid, personName)} ` : '';
      return {
        text: `📌 บันทึกงาน #${id}: ${who}${a.title}${when ? ` — กำหนด ${fmtWhen(when)} (จะเตือนตอนนั้น)` : ''}`,
        mentions: personJid ? [personJid] : [],
      };
    }
    case 'remind': {
      if (!when) throw new Error('ไม่รู้ว่าจะให้เตือนเมื่อไหร่');
      const title = a.title || task?.title;
      if (!title) throw new Error('ไม่รู้ว่าจะให้เตือนเรื่องอะไร');
      let next = when;
      while (next <= nowTs() && repeat !== 'none') next = nextOccurrence(next, repeat);
      if (next <= nowTs()) throw new Error('เวลาที่บอกผ่านไปแล้ว');
      const id = db.addReminder({
        groupJid: p.groupJid,
        taskId: task?.id ?? null,
        text: title,
        targetName: personName,
        targetJid: personJid,
        nextAt: next,
        repeat,
        createdBy: by,
      });
      const rep = REPEAT_LABEL[repeat] ? ` (${REPEAT_LABEL[repeat]})` : '';
      return {
        text: `⏰ ตั้งเตือน R${id}: ${fmtWhen(next)}${rep} — ${personName ? mentionFor(personJid, personName) + ' ' : ''}${title}`,
        mentions: personJid ? [personJid] : [],
      };
    }
    case 'complete':
    case 'cancel':
    case 'reopen': {
      if (!task) throw new Error('ไม่รู้ว่าหมายถึงงานไหน (บอกเลขงาน เช่น #3)');
      const status = a.type === 'complete' ? 'done' : a.type === 'cancel' ? 'cancelled' : 'open';
      db.setTaskStatus(task.id, status, by);
      const label = { done: '✅ ปิดงาน', cancelled: '🗑️ ยกเลิกงาน', open: '↩️ เปิดงานใหม่' }[status];
      return { text: `${label} #${task.id}: ${task.title}`, mentions: [] };
    }
    case 'snooze': {
      if (!when) throw new Error('ไม่รู้ว่าจะเลื่อนไปเมื่อไหร่');
      const reminder =
        (a.reminder_id && db.getReminder(a.reminder_id)) ||
        p.quoted?.reminder ||
        (task && db.activeReminders(p.groupJid).find((r) => r.task_id === task.id)) ||
        null;
      if (reminder && reminder.group_jid === p.groupJid) {
        db.snoozeReminder(reminder.id, when);
        return { text: `💤 เลื่อนเตือนไป ${fmtWhen(when)}: ${reminder.text}`, mentions: [] };
      }
      if (!task) throw new Error('ไม่รู้ว่าจะเลื่อนเรื่องไหน');
      const id = db.addReminder({ groupJid: p.groupJid, taskId: task.id, text: task.title, targetName: task.assignee_name, targetJid: task.assignee_jid, nextAt: when, createdBy: by });
      return { text: `💤 จะเตือนงาน #${task.id} อีกครั้ง ${fmtWhen(when)} (R${id})`, mentions: [] };
    }
    case 'change_due': {
      if (!task || !when) throw new Error('ต้องบอกเลขงานและวันที่ใหม่');
      db.updateTask(task.id, { due_at: when });
      const r = db.activeReminders(p.groupJid).find((x) => x.task_id === task.id && x.repeat === 'none');
      if (r) db.snoozeReminder(r.id, when);
      else db.addReminder({ groupJid: p.groupJid, taskId: task.id, text: task.title, targetName: task.assignee_name, targetJid: task.assignee_jid, nextAt: when, createdBy: by });
      return { text: `📅 เปลี่ยนกำหนดงาน #${task.id} เป็น ${fmtWhen(when)}`, mentions: [] };
    }
    default:
      return null;
  }
}

// ---------- finding tasks in normal conversation ----------

const SYNC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['new_tasks', 'completed', 'due_changes'],
  properties: {
    new_tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'person', 'when'],
        properties: { title: { type: 'string' }, person: { type: ['string', 'null'] }, when: { type: ['string', 'null'] } },
      },
    },
    completed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task_id', 'by'],
        properties: { task_id: { type: 'integer' }, by: { type: ['string', 'null'] } },
      },
    },
    due_changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task_id', 'when'],
        properties: { task_id: { type: 'integer' }, when: { type: 'string' } },
      },
    },
  },
};

const SYNC_SYSTEM = `คุณคอยจดงานจากแชทกลุ่มของทีม (บริบท: ${config.groupContext})
อ่าน "ข้อความใหม่" แล้วหา:
1. new_tasks: งานที่มีคนมอบหมายหรือรับปากว่าจะทำ ชัดเจนว่าใครต้องทำอะไร เช่น "ฝาก Render ด้วย", "เดี๋ยวผมอัปโหลดให้", "แก้แบบแล้วเร็นเดอร์อีกทีนะ"
   - title สั้น กระชับ ขึ้นต้นด้วยคำกริยา เช่น "Render แบบใหม่หลังแก้แบบ"
   - person = ชื่อคนที่ต้องทำ ต้องตรงกับรายชื่อสมาชิกเป๊ะๆ (แปลงชื่อเล่น เช่น "ชาย" = Somchai) หรือ null ถ้าไม่ชัด
   - when = กำหนดส่ง "YYYY-MM-DD HH:MM" เวลาไทย เฉพาะถ้ามีคนพูดถึงเวลา ไม่งั้น null
   - ห้ามจดคำชม คำขอบคุณ การคุยเล่น หรือเรื่องที่ทำเสร็จไปแล้วในข้อความเดียวกัน
   - ห้ามซ้ำกับงานที่เปิดอยู่แล้ว (เทียบความหมาย ไม่ใช่ตัวอักษร)
2. completed: งานที่เปิดอยู่ซึ่งมีหลักฐานชัดเจนในข้อความใหม่ว่าทำเสร็จหรือส่งแล้ว เช่น ส่งไฟล์/ลิงก์ที่ขอ หรือบอกว่า "ส่งแล้ว" "เรียบร้อย"
3. due_changes: งานที่เปิดอยู่ซึ่งมีการตกลงกำหนดส่งใหม่
ถ้าไม่มี ให้คืน array ว่าง ระวังอย่าจดเกิน ถ้าไม่แน่ใจให้ไม่ต้องจด`;

/**
 * Look at messages since the last sync and record tasks found in normal conversation.
 * @returns {Promise<{ added: object[], completed: object[] } | null>}
 */
export async function syncTasks(groupJid, people, resolve) {
  const all = db.messagesAfterRow(groupJid, db.lastTaskRow(groupJid));
  if (!all.length) return null;
  const lastRow = all[all.length - 1].row;
  // Leave out bot commands and requests to the bot: those are handled as requests already.
  const fresh = all.filter((r) => !r.to_bot && !(r.kind === 'text' && /^\/\S/.test(r.text || '')));
  if (!fresh.length) {
    db.setLastTaskRow(groupJid, lastRow);
    return null;
  }
  const before = db
    .getMessages(groupJid, fresh[0].ts - DAY, fresh[0].ts)
    .filter((r) => !fresh.some((f) => f.id === r.id))
    .slice(-10);

  const result = await askJSON({
    system: SYNC_SYSTEM,
    name: 'task_sync',
    schema: SYNC_SCHEMA,
    effort: 'low',
    text: [
      contextBlock(groupJid, people),
      before.length ? `<ข้อความก่อนหน้า (ไว้ดูบริบท ห้ามจดจากส่วนนี้)>\n${buildTranscript(before)}\n</ข้อความก่อนหน้า>` : '',
      `<ข้อความใหม่>\n${buildTranscript(fresh)}\n</ข้อความใหม่>`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  db.setLastTaskRow(groupJid, lastRow);

  const added = [];
  for (const t of result.new_tasks || []) {
    const due = t.when ? parseLocal(t.when) : null;
    const jid = t.person ? resolve(t.person) : null;
    const who = (jid && db.contactName(jid)) || t.person;
    const id = db.addTask({ groupJid, title: t.title, assigneeName: who, assigneeJid: jid, source: 'chat', dueAt: due });
    if (due && due > nowTs()) db.addReminder({ groupJid, taskId: id, text: t.title, targetName: who, targetJid: jid, nextAt: due });
    added.push(db.getTask(id));
  }
  const completed = [];
  for (const c of result.completed || []) {
    const task = db.getTask(c.task_id);
    if (task?.group_jid === groupJid && task.status === 'open') {
      db.setTaskStatus(task.id, 'done', c.by);
      completed.push(task);
    }
  }
  for (const c of result.due_changes || []) {
    const task = db.getTask(c.task_id);
    const due = parseLocal(c.when);
    if (task?.group_jid === groupJid && task.status === 'open' && due) db.updateTask(task.id, { due_at: due });
  }
  return { added, completed };
}

/** One-line notice after a sync, or null when nothing changed. */
export function syncNotice({ added, completed }) {
  const lines = [];
  if (added.length) lines.push('📌 *จดงานใหม่ไว้แล้ว*', ...added.map((t) => taskLine(t)));
  if (completed.length) lines.push(...completed.map((t) => `✅ ปิดงาน #${t.id}: ${t.title}`));
  if (!lines.length) return null;
  lines.push('ถ้าจดผิด ตอบกลับข้อความนี้ได้เลย เช่น "ยกเลิก #3"');
  return lines.join('\n');
}

// ---------- reminders firing ----------

/**
 * Reminders that are due now. Calls send(reminder, task) for each, then schedules the next one.
 * One-off reminders on an open task follow up up to config.maxNags times.
 */
export async function fireDueReminders(send) {
  for (const r of db.dueReminders(nowTs())) {
    const task = r.task_id ? db.getTask(r.task_id) : null;
    if (task && task.status !== 'open') {
      db.deactivateReminder(r.id);
      continue;
    }
    try {
      await send(r, task);
    } catch (err) {
      console.error('ส่งเตือนไม่สำเร็จ:', err.message);
      continue; // try again next tick
    }
    if (r.repeat !== 'none') {
      let next = nextOccurrence(r.next_at, r.repeat);
      while (next <= nowTs()) next = nextOccurrence(next, r.repeat);
      db.rescheduleReminder(r.id, next);
    } else if (task && r.sent_count < config.maxNags) {
      db.rescheduleReminder(r.id, daytime(nowTs() + config.nagHours * 3600));
    } else {
      db.deactivateReminder(r.id);
    }
  }
}
