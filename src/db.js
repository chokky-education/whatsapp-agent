import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    group_jid   TEXT NOT NULL,
    group_name  TEXT,
    sender_jid  TEXT,
    sender_name TEXT,
    ts          INTEGER NOT NULL,          -- unix seconds
    kind        TEXT NOT NULL,             -- text | image | video | document | audio | sticker | other
    text        TEXT,
    file_name   TEXT,
    media_path  TEXT,
    media_desc  TEXT,                      -- Claude's description of the image / PDF
    quoted_text TEXT,
    from_bot    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_messages_group_ts ON messages (group_jid, ts);
  CREATE TABLE IF NOT EXISTS summaries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid    TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    period_end   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    text         TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contacts (
    jid  TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
`);

// Added later: messages addressed to the bot (requests), kept out of automatic task finding.
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'to_bot')) {
  db.exec('ALTER TABLE messages ADD COLUMN to_bot INTEGER NOT NULL DEFAULT 0');
}

export function markToBot(id) {
  db.prepare('UPDATE messages SET to_bot = 1 WHERE id = ?').run(id);
}

const insertMsg = db.prepare(`
  INSERT OR IGNORE INTO messages
    (id, group_jid, group_name, sender_jid, sender_name, ts, kind, text, file_name, media_path, quoted_text, from_bot)
  VALUES
    ($id, $group_jid, $group_name, $sender_jid, $sender_name, $ts, $kind, $text, $file_name, $media_path, $quoted_text, $from_bot)
`);

/** @returns {boolean} true when the row was new */
export function saveMessage(m) {
  const r = insertMsg.run({
    $id: m.id,
    $group_jid: m.groupJid,
    $group_name: m.groupName ?? null,
    $sender_jid: m.senderJid ?? null,
    $sender_name: m.senderName ?? null,
    $ts: m.ts,
    $kind: m.kind,
    $text: m.text ?? null,
    $file_name: m.fileName ?? null,
    $media_path: m.mediaPath ?? null,
    $quoted_text: m.quotedText ?? null,
    $from_bot: m.fromBot ? 1 : 0,
  });
  return r.changes > 0;
}

export function setMediaDesc(id, desc) {
  db.prepare('UPDATE messages SET media_desc = ? WHERE id = ?').run(desc, id);
}

export function setMediaPath(id, p) {
  db.prepare('UPDATE messages SET media_path = ? WHERE id = ?').run(p, id);
}

export function getMessages(groupJid, fromTs, toTs) {
  return db
    .prepare(
      // Older rows may only have a number as the name (history sync carries no names);
      // use the contact name learned later when there is one.
      `SELECT m.*,
              CASE WHEN c.name IS NOT NULL AND (m.sender_name IS NULL OR m.sender_name GLOB '[0-9]*')
                   THEN c.name ELSE m.sender_name END AS sender_name
       FROM messages m LEFT JOIN contacts c ON c.jid = m.sender_jid
       WHERE m.group_jid = ? AND m.ts >= ? AND m.ts <= ? AND m.from_bot = 0
       ORDER BY m.ts, m.rowid`,
    )
    .all(groupJid, fromTs, toTs);
}

export function lastSummaryEnd(groupJid) {
  const row = db
    .prepare('SELECT MAX(period_end) AS t FROM summaries WHERE group_jid = ?')
    .get(groupJid);
  return row?.t ?? null;
}

export function saveSummary(groupJid, start, end, text) {
  db.prepare(
    'INSERT INTO summaries (group_jid, period_start, period_end, created_at, text) VALUES (?, ?, ?, ?, ?)',
  ).run(groupJid, start, end, Math.floor(Date.now() / 1000), text);
}

export function lastSummaryText(groupJid) {
  return (
    db
      .prepare('SELECT text FROM summaries WHERE group_jid = ? ORDER BY id DESC LIMIT 1')
      .get(groupJid)?.text ?? null
  );
}

export function knownGroups() {
  return db
    .prepare(
      `SELECT group_jid, MAX(group_name) AS group_name, MAX(ts) AS last_ts
       FROM messages GROUP BY group_jid`,
    )
    .all();
}

export function rememberContact(jid, name) {
  if (!jid || !name) return;
  db.prepare(
    'INSERT INTO contacts (jid, name) VALUES (?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name',
  ).run(jid, name);
}

export function contactName(jid) {
  if (!jid) return null;
  return db.prepare('SELECT name FROM contacts WHERE jid = ?').get(jid)?.name ?? null;
}

// ---------- tasks & reminders (phase 1) ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid     TEXT NOT NULL,
    title         TEXT NOT NULL,
    assignee_name TEXT,
    assignee_jid  TEXT,
    created_by    TEXT,
    source        TEXT NOT NULL DEFAULT 'chat',   -- chat (found in conversation) | request (asked the bot)
    created_at    INTEGER NOT NULL,
    due_at        INTEGER,
    status        TEXT NOT NULL DEFAULT 'open',   -- open | done | cancelled
    done_at       INTEGER,
    done_by       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_group_status ON tasks (group_jid, status);
  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid   TEXT NOT NULL,
    task_id     INTEGER,
    text        TEXT NOT NULL,
    target_name TEXT,
    target_jid  TEXT,
    next_at     INTEGER NOT NULL,
    repeat      TEXT NOT NULL DEFAULT 'none',     -- none | daily | weekdays | weekly | monthly
    created_by  TEXT,
    created_at  INTEGER NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    sent_count  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (active, next_at);
  CREATE TABLE IF NOT EXISTS bot_messages (       -- what each message the bot sent was about
    msg_id      TEXT PRIMARY KEY,
    group_jid   TEXT NOT NULL,
    task_id     INTEGER,
    reminder_id INTEGER,
    kind        TEXT,
    sent_at     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_state (
    group_jid      TEXT PRIMARY KEY,
    last_task_sync INTEGER NOT NULL DEFAULT 0
  );
`);

const now = () => Math.floor(Date.now() / 1000);

export function addTask(t) {
  const r = db
    .prepare(
      `INSERT INTO tasks (group_jid, title, assignee_name, assignee_jid, created_by, source, created_at, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.groupJid, t.title, t.assigneeName ?? null, t.assigneeJid ?? null, t.createdBy ?? null, t.source ?? 'chat', now(), t.dueAt ?? null);
  return Number(r.lastInsertRowid);
}

export function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) ?? null;
}

export function openTasks(groupJid) {
  return db
    .prepare(
      `SELECT * FROM tasks WHERE group_jid = ? AND status = 'open'
       ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, id`,
    )
    .all(groupJid);
}

export function setTaskStatus(id, status, by = null) {
  db.prepare('UPDATE tasks SET status = ?, done_at = ?, done_by = ? WHERE id = ?').run(
    status,
    status === 'open' ? null : now(),
    by,
    id,
  );
  if (status !== 'open') db.prepare('UPDATE reminders SET active = 0 WHERE task_id = ? AND repeat = ?').run(id, 'none');
}

export function updateTask(id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  db.prepare(`UPDATE tasks SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
}

export function addReminder(r) {
  const res = db
    .prepare(
      `INSERT INTO reminders (group_jid, task_id, text, target_name, target_jid, next_at, repeat, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.groupJid, r.taskId ?? null, r.text, r.targetName ?? null, r.targetJid ?? null, r.nextAt, r.repeat ?? 'none', r.createdBy ?? null, now());
  return Number(res.lastInsertRowid);
}

export function dueReminders(at) {
  return db.prepare('SELECT * FROM reminders WHERE active = 1 AND next_at <= ? ORDER BY next_at').all(at);
}

export function activeReminders(groupJid) {
  return db.prepare('SELECT * FROM reminders WHERE group_jid = ? AND active = 1 ORDER BY next_at').all(groupJid);
}

export function getReminder(id) {
  return db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) ?? null;
}

export function rescheduleReminder(id, nextAt) {
  db.prepare('UPDATE reminders SET next_at = ?, sent_count = sent_count + 1 WHERE id = ?').run(nextAt, id);
}

export function snoozeReminder(id, nextAt) {
  db.prepare('UPDATE reminders SET next_at = ?, active = 1 WHERE id = ?').run(nextAt, id);
}

export function deactivateReminder(id) {
  db.prepare('UPDATE reminders SET active = 0, sent_count = sent_count + 1 WHERE id = ?').run(id);
}

export function recordBotMessage(msgId, groupJid, { taskId = null, reminderId = null, kind = null } = {}) {
  if (!msgId) return;
  db.prepare(
    'INSERT OR REPLACE INTO bot_messages (msg_id, group_jid, task_id, reminder_id, kind, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(msgId, groupJid, taskId, reminderId, kind, now());
}

export function botMessage(msgId) {
  if (!msgId) return null;
  return db.prepare('SELECT * FROM bot_messages WHERE msg_id = ?').get(msgId) ?? null;
}

// Automatic task finding remembers the last message row it read (rows, not seconds:
// several messages can share one second).
if (!db.prepare('PRAGMA table_info(group_state)').all().some((c) => c.name === 'last_task_row')) {
  db.exec('ALTER TABLE group_state ADD COLUMN last_task_row INTEGER NOT NULL DEFAULT 0');
}

export function lastTaskRow(groupJid) {
  return db.prepare('SELECT last_task_row FROM group_state WHERE group_jid = ?').get(groupJid)?.last_task_row ?? 0;
}

export function setLastTaskRow(groupJid, row) {
  db.prepare(
    `INSERT INTO group_state (group_jid, last_task_row) VALUES (?, ?)
     ON CONFLICT(group_jid) DO UPDATE SET last_task_row = excluded.last_task_row`,
  ).run(groupJid, row);
}

export function maxRow() {
  return db.prepare('SELECT MAX(rowid) AS r FROM messages').get().r ?? 0;
}

/** Messages stored after a given row (bot's own messages excluded). */
export function messagesAfterRow(groupJid, row) {
  return db
    .prepare(
      `SELECT m.*, m.rowid AS row,
              CASE WHEN c.name IS NOT NULL AND (m.sender_name IS NULL OR m.sender_name GLOB '[0-9]*')
                   THEN c.name ELSE m.sender_name END AS sender_name
       FROM messages m LEFT JOIN contacts c ON c.jid = m.sender_jid
       WHERE m.group_jid = ? AND m.rowid > ? AND m.from_bot = 0
       ORDER BY m.rowid`,
    )
    .all(groupJid, row);
}

/** All jids we know for a display name (case-insensitive). */
export function jidsForName(name) {
  if (!name) return [];
  return db
    .prepare('SELECT jid FROM contacts WHERE lower(name) = lower(?)')
    .all(name.replace(/^@/, '').trim())
    .map((r) => r.jid);
}

export function knownNames() {
  return db.prepare('SELECT DISTINCT name FROM contacts ORDER BY name').all().map((r) => r.name);
}

/** Numbers for measuring whether the bot helps (tasks closed, time to close). */
export function taskStats(groupJid, sinceTs) {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS created,
         SUM(status = 'done') AS done,
         SUM(status = 'open') AS open,
         SUM(status = 'open' AND due_at IS NOT NULL AND due_at < strftime('%s','now')) AS overdue,
         AVG(CASE WHEN status = 'done' THEN done_at - created_at END) AS avg_seconds_to_done
       FROM tasks WHERE group_jid = ? AND created_at >= ?`,
    )
    .get(groupJid, sinceTs);
}
