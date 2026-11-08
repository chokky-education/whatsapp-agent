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
  CREATE TABLE IF NOT EXISTS group_privacy (
    group_jid TEXT PRIMARY KEY, deleted_through INTEGER NOT NULL
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
  if (m.ts <= deletedThrough(m.groupJid)) return false;
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

// ---------- client dossiers (Phase 1: up to config.maxClients per group) ----------

export const CLIENT_STAGES = ['brief', 'design', 'boq', 'construction', 'handover'];
export const NOTE_CATEGORIES = ['brief', 'spec', 'change', 'site', 'link'];

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid  TEXT NOT NULL,
    name       TEXT NOT NULL,
    aliases    TEXT NOT NULL DEFAULT '',
    stage      TEXT NOT NULL DEFAULT 'brief',     -- brief | design | boq | construction | handover
    location   TEXT,
    budget     TEXT,
    status     TEXT NOT NULL DEFAULT 'active',    -- active | archived
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clients_group_status ON clients (group_jid, status);
  CREATE TABLE IF NOT EXISTS client_notes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid           TEXT NOT NULL,
    client_id           INTEGER NOT NULL,
    category            TEXT NOT NULL DEFAULT 'brief',     -- brief | spec | change | site | link
    text                TEXT NOT NULL,
    created_by          TEXT,
    source              TEXT NOT NULL DEFAULT 'request',   -- request | chat
    created_at          INTEGER NOT NULL,
    current_revision_id INTEGER,
    revision_count      INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'active',    -- active | needs_review
    updated_by          TEXT,
    updated_at          INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_client_notes_client ON client_notes (client_id, category, id);
  CREATE TABLE IF NOT EXISTS client_note_revisions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id          INTEGER NOT NULL,
    group_jid        TEXT NOT NULL,
    client_id        INTEGER NOT NULL,
    revision_no      INTEGER NOT NULL,
    category         TEXT NOT NULL,
    text             TEXT NOT NULL,
    kind             TEXT NOT NULL DEFAULT 'capture',      -- capture | correction | change
    reason           TEXT,
    prev_revision_id INTEGER,
    created_by       TEXT,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_note_revisions_note ON client_note_revisions (note_id, revision_no);
  CREATE TABLE IF NOT EXISTS client_note_sources (
    revision_id INTEGER NOT NULL,
    note_id     INTEGER NOT NULL,
    group_jid   TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    PRIMARY KEY (revision_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_note_sources_note ON client_note_sources (note_id);
  CREATE TABLE IF NOT EXISTS client_note_tombstones (
    group_jid  TEXT NOT NULL,
    client_id  INTEGER NOT NULL,
    dedupe_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (group_jid, client_id, dedupe_key)
  );
  CREATE TABLE IF NOT EXISTS client_renders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid         TEXT NOT NULL,
    client_id         INTEGER,
    version_no        INTEGER NOT NULL,
    parent_version    INTEGER,
    parent_id         INTEGER,
    source_msg_id     TEXT,
    source_media_path TEXT,
    output_media_path TEXT,
    prompt            TEXT NOT NULL,
    spec_snapshot     TEXT,
    model             TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'done',
    created_by        TEXT,
    created_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_client_renders_group_ts ON client_renders (group_jid, created_at);
`);

// Renders used to require a client; they are now standalone (client_id optional, parent_id = the
// render that was edited). Rebuild once, keeping ids so old bot_messages.render_id links still work.
if (db.prepare('PRAGMA table_info(client_renders)').all().some((c) => c.name === 'client_id' && c.notnull)) {
  db.exec(`
    BEGIN;
    CREATE TABLE client_renders_new (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      group_jid         TEXT NOT NULL,
      client_id         INTEGER,
      version_no        INTEGER NOT NULL,
      parent_version    INTEGER,
      parent_id         INTEGER,
      source_msg_id     TEXT,
      source_media_path TEXT,
      output_media_path TEXT,
      prompt            TEXT NOT NULL,
      spec_snapshot     TEXT,
      model             TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'done',
      created_by        TEXT,
      created_at        INTEGER NOT NULL
    );
    INSERT INTO client_renders_new
      (id, group_jid, client_id, version_no, parent_version, source_msg_id, source_media_path, output_media_path, prompt, spec_snapshot, model, status, created_by, created_at)
      SELECT id, group_jid, client_id, version_no, parent_version, source_msg_id, source_media_path, output_media_path, prompt, spec_snapshot, model, status, created_by, created_at
      FROM client_renders;
    DROP TABLE client_renders;
    ALTER TABLE client_renders_new RENAME TO client_renders;
    CREATE INDEX IF NOT EXISTS idx_client_renders_group_ts ON client_renders (group_jid, created_at);
    COMMIT;
  `);
}

if (!db.prepare('PRAGMA table_info(bot_messages)').all().some((c) => c.name === 'render_id')) {
  db.exec('ALTER TABLE bot_messages ADD COLUMN render_id INTEGER');
}

const noteCols = new Set(db.prepare('PRAGMA table_info(client_notes)').all().map((c) => c.name));
if (!noteCols.has('current_revision_id')) db.exec('ALTER TABLE client_notes ADD COLUMN current_revision_id INTEGER');
if (!noteCols.has('revision_count')) db.exec('ALTER TABLE client_notes ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 1');
if (!noteCols.has('status')) db.exec("ALTER TABLE client_notes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
if (!noteCols.has('updated_by')) db.exec('ALTER TABLE client_notes ADD COLUMN updated_by TEXT');
if (!noteCols.has('updated_at')) db.exec('ALTER TABLE client_notes ADD COLUMN updated_at INTEGER');

// Migrate legacy notes without revision rows as revision 1 (with no fabricated source links).
for (const legacy of db.prepare('SELECT * FROM client_notes WHERE current_revision_id IS NULL').all()) {
  const rev = db
    .prepare(
      `INSERT INTO client_note_revisions
        (note_id, group_jid, client_id, revision_no, category, text, kind, reason, prev_revision_id, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, ?, 'capture', NULL, NULL, ?, ?)`,
    )
    .run(legacy.id, legacy.group_jid, legacy.client_id, legacy.category, legacy.text, legacy.created_by, legacy.created_at);
  db.prepare('UPDATE client_notes SET current_revision_id = ?, revision_count = 1, updated_at = ? WHERE id = ?').run(
    Number(rev.lastInsertRowid),
    legacy.created_at,
    legacy.id,
  );
}

if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'client_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN client_id INTEGER');
}

export function addClient(c) {
  const ts = now();
  const stage = CLIENT_STAGES.includes(c.stage) ? c.stage : 'brief';
  const r = db
    .prepare(
      `INSERT INTO clients (group_jid, name, aliases, stage, location, budget, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      c.groupJid,
      c.name.trim(),
      (c.aliases || '').trim(),
      stage,
      c.location ?? null,
      c.budget ?? null,
      c.createdBy ?? null,
      ts,
      ts,
    );
  return Number(r.lastInsertRowid);
}

export function getClient(id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id) ?? null;
}

export function activeClients(groupJid) {
  return db
    .prepare("SELECT * FROM clients WHERE group_jid = ? AND status = 'active' ORDER BY id")
    .all(groupJid);
}

const splitAliases = (s) =>
  (s || '')
    .split(/[,/·|]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const expandVowelVariants = (s) => {
  const out = [s];
  if (s.includes('\u0e36')) out.push(s.replaceAll('\u0e36', '\u0e37'));
  if (s.includes('\u0e37')) out.push(s.replaceAll('\u0e37', '\u0e36'));
  return out;
};

export function clientTerms(c) {
  if (!c) return [];
  const raw = [c.name, ...splitAliases(c.aliases)].map((x) => x.trim()).filter(Boolean);
  return [...new Set(raw.flatMap(expandVowelVariants))];
}

const normClientStr = (s) => String(s || '').trim().toLowerCase().replaceAll('\u0e36', '\u0e37');

/** Find an active client in this group by #id, list index, name, or alias (case-insensitive, ึ/ื tolerant). */
export function findClient(groupJid, query) {
  if (!groupJid || !query) return null;
  const q = String(query).replace(/^[#C]/i, '').trim().toLowerCase();
  if (!q) return null;
  const list = activeClients(groupJid);
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const byId = list.find((c) => c.id === n) || (n >= 1 && n <= list.length ? list[n - 1] : null);
    if (byId) return byId;
  }
  const raw = normClientStr(query);
  // Exact match on name or alias first, then substring match (>= 2 chars).
  for (const c of list) {
    const terms = clientTerms(c).map(normClientStr);
    if (terms.includes(raw)) return c;
  }
  if (raw.length >= 2) {
    for (const c of list) {
      const terms = clientTerms(c).map(normClientStr);
      if (terms.some((t) => t.includes(raw) || (t.length >= 2 && raw.includes(t)))) return c;
    }
  }
  return null;
}

export function updateClient(id, fields) {
  const next = { ...fields, updated_at: now() };
  if (next.stage && !CLIENT_STAGES.includes(next.stage)) delete next.stage;
  const cols = Object.keys(next);
  if (!cols.length) return;
  db.prepare(`UPDATE clients SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    ...cols.map((c) => next[c]),
    id,
  );
}

const normNoteKey = (text) =>
  String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replaceAll('\u0e36', '\u0e37');

function validGroupMessageIds(groupJid, ids = []) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = [];
  for (const id of unique) {
    const row = db
      .prepare('SELECT id FROM messages WHERE id = ? AND group_jid = ? AND from_bot = 0')
      .get(id, groupJid);
    if (row) out.push(row.id);
  }
  return out;
}

export function getMessage(groupJid, id) {
  if (!groupJid || !id) return null;
  return (
    db
      .prepare(
        `SELECT m.*,
                CASE WHEN c.name IS NOT NULL AND (m.sender_name IS NULL OR m.sender_name GLOB '[0-9]*')
                     THEN c.name ELSE m.sender_name END AS sender_name
         FROM messages m LEFT JOIN contacts c ON c.jid = m.sender_jid
         WHERE m.id = ? AND m.group_jid = ?`,
      )
      .get(id, groupJid) ?? null
  );
}

function recordNoteTombstone(groupJid, clientId, text, ts = now()) {
  const key = normNoteKey(text);
  if (!key) return;
  db.prepare(
    'INSERT OR IGNORE INTO client_note_tombstones (group_jid, client_id, dedupe_key, created_at) VALUES (?, ?, ?, ?)',
  ).run(groupJid, clientId, key, ts);
}

export function hasClientNoteDedupe(groupJid, clientId, text) {
  const key = normNoteKey(text);
  if (!key) return false;
  const tomb = db
    .prepare('SELECT 1 FROM client_note_tombstones WHERE group_jid = ? AND client_id = ? AND dedupe_key = ?')
    .get(groupJid, clientId, key);
  if (tomb) return true;
  return clientNotes(clientId).some((n) => normNoteKey(n.text) === key);
}

export function addClientNote(n) {
  const ts = now();
  const cat = NOTE_CATEGORIES.includes(n.category) ? n.category : 'brief';
  const cleanText = n.text.trim();
  const status = n.status === 'needs_review' ? 'needs_review' : 'active';
  const validSources = validGroupMessageIds(n.groupJid, n.sourceMessageIds);
  const r = db
    .prepare(
      `INSERT INTO client_notes (group_jid, client_id, category, text, created_by, source, created_at, revision_count, status, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(n.groupJid, n.clientId, cat, cleanText, n.createdBy ?? null, n.source ?? 'request', ts, status, n.createdBy ?? null, ts);
  const noteId = Number(r.lastInsertRowid);
  const rev = db
    .prepare(
      `INSERT INTO client_note_revisions
        (note_id, group_jid, client_id, revision_no, category, text, kind, reason, prev_revision_id, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, ?, 'capture', NULL, NULL, ?, ?)`,
    )
    .run(noteId, n.groupJid, n.clientId, cat, cleanText, n.createdBy ?? null, ts);
  const revId = Number(rev.lastInsertRowid);
  db.prepare('UPDATE client_notes SET current_revision_id = ? WHERE id = ?').run(revId, noteId);
  for (const msgId of validSources) {
    db.prepare('INSERT OR IGNORE INTO client_note_sources (revision_id, note_id, group_jid, message_id) VALUES (?, ?, ?, ?)').run(
      revId,
      noteId,
      n.groupJid,
      msgId,
    );
  }
  recordNoteTombstone(n.groupJid, n.clientId, cleanText, ts);
  db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(ts, n.clientId);
  return noteId;
}

export function getClientNote(id) {
  return db.prepare('SELECT * FROM client_notes WHERE id = ?').get(id) ?? null;
}

export function clientNotes(clientId) {
  return db.prepare('SELECT * FROM client_notes WHERE client_id = ? ORDER BY id').all(clientId);
}

export function editClientNote(
  id,
  { groupJid, text, category = null, updatedBy = null, reason = null, kind = 'correction', sourceMessageIds = [], expectedRevision = null } = {},
) {
  const note = getClientNote(id);
  if (!note || (groupJid && note.group_jid !== groupJid)) return { ok: false, reason: 'not_found', note: null };
  if (expectedRevision != null && Number(note.revision_count || 1) !== Number(expectedRevision)) {
    return { ok: false, reason: 'conflict', note };
  }
  const cleanText = String(text || '').trim();
  if (!cleanText) return { ok: false, reason: 'empty', note };
  const ts = now();
  const nextCat = category && NOTE_CATEGORIES.includes(category) ? category : note.category;
  const nextRevNo = Number(note.revision_count || 1) + 1;
  const revKind = ['capture', 'correction', 'change'].includes(kind) ? kind : 'correction';
  const validSources = validGroupMessageIds(note.group_jid, sourceMessageIds);

  const rev = db
    .prepare(
      `INSERT INTO client_note_revisions
        (note_id, group_jid, client_id, revision_no, category, text, kind, reason, prev_revision_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      note.id,
      note.group_jid,
      note.client_id,
      nextRevNo,
      nextCat,
      cleanText,
      revKind,
      reason ?? null,
      note.current_revision_id ?? null,
      updatedBy ?? null,
      ts,
    );
  const revId = Number(rev.lastInsertRowid);
  for (const msgId of validSources) {
    db.prepare('INSERT OR IGNORE INTO client_note_sources (revision_id, note_id, group_jid, message_id) VALUES (?, ?, ?, ?)').run(
      revId,
      note.id,
      note.group_jid,
      msgId,
    );
  }
  db.prepare(
    `UPDATE client_notes
     SET category = ?, text = ?, current_revision_id = ?, revision_count = ?, status = 'active', updated_by = ?, updated_at = ?
     WHERE id = ?`,
  ).run(nextCat, cleanText, revId, nextRevNo, updatedBy ?? null, ts, note.id);
  recordNoteTombstone(note.group_jid, note.client_id, note.text, ts);
  recordNoteTombstone(note.group_jid, note.client_id, cleanText, ts);
  db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(ts, note.client_id);
  return { ok: true, note: getClientNote(note.id), revisionNo: nextRevNo };
}

export function noteRevisions(noteId, groupJid = null) {
  const note = getClientNote(noteId);
  if (!note || (groupJid && note.group_jid !== groupJid)) return [];
  return db
    .prepare('SELECT * FROM client_note_revisions WHERE note_id = ? ORDER BY revision_no ASC, id ASC')
    .all(noteId);
}

export function noteSources(noteId, groupJid = null, revisionId = null) {
  const note = getClientNote(noteId);
  if (!note || (groupJid && note.group_jid !== groupJid)) return [];
  const revId = revisionId ?? note.current_revision_id;
  if (!revId) return [];
  return db
    .prepare(
      `SELECT m.*,
              CASE WHEN c.name IS NOT NULL AND (m.sender_name IS NULL OR m.sender_name GLOB '[0-9]*')
                   THEN c.name ELSE m.sender_name END AS sender_name
       FROM client_note_sources s
       JOIN messages m ON m.id = s.message_id AND m.group_jid = s.group_jid
       LEFT JOIN contacts c ON c.jid = m.sender_jid
       WHERE s.note_id = ? AND s.revision_id = ? AND s.group_jid = ?
       ORDER BY m.ts, m.rowid`,
    )
    .all(noteId, revId, note.group_jid);
}

export function deleteClientNote(id, groupJid = null) {
  const note = getClientNote(id);
  if (!note || (groupJid && note.group_jid !== groupJid)) return false;
  recordNoteTombstone(note.group_jid, note.client_id, note.text);
  db.prepare('DELETE FROM client_note_sources WHERE note_id = ?').run(id);
  db.prepare('DELETE FROM client_note_revisions WHERE note_id = ?').run(id);
  const r = db.prepare('DELETE FROM client_notes WHERE id = ?').run(id);
  return r.changes > 0;
}

/**
 * Record a finished render. Renders are not tied to a client. `version_no` is the edit depth
 * (1 = rendered from a sketch, 2 = first edit of that render, ...).
 */
export function addRender(r) {
  const parent = r.parentId ? getRender(r.parentId) : null;
  const res = db
    .prepare(
      `INSERT INTO client_renders
        (group_jid, client_id, version_no, parent_id, source_msg_id, source_media_path, output_media_path, prompt, model, status, created_by, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?)`,
    )
    .run(
      r.groupJid,
      (parent?.version_no ?? 0) + 1,
      parent?.id ?? null,
      r.sourceMsgId ?? null,
      r.sourceMediaPath ?? null,
      r.outputMediaPath ?? null,
      String(r.prompt || '').trim(),
      r.model || 'unknown',
      r.createdBy ?? null,
      now(),
    );
  return Number(res.lastInsertRowid);
}

export function getRender(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM client_renders WHERE id = ?').get(id) ?? null;
}

export function rendersCountSince(groupJid, sinceTs) {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM client_renders WHERE group_jid = ? AND created_at >= ? AND status = 'done'")
      .get(groupJid, sinceTs)?.n ?? 0
  );
}

export function addTask(t) {
  const r = db
    .prepare(
      `INSERT INTO tasks (group_jid, title, assignee_name, assignee_jid, created_by, source, created_at, due_at, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.groupJid, t.title, t.assigneeName ?? null, t.assigneeJid ?? null, t.createdBy ?? null, t.source ?? 'chat', now(), t.dueAt ?? null, t.clientId ?? null);
  return Number(r.lastInsertRowid);
}

export function getTask(id) {
  return (
    db
      .prepare(
        `SELECT t.*, c.name AS client_name
         FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
         WHERE t.id = ?`,
      )
      .get(id) ?? null
  );
}

export function openTasks(groupJid) {
  return db
    .prepare(
      `SELECT t.*, c.name AS client_name
       FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.group_jid = ? AND t.status = 'open'
       ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at, t.id`,
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

export function recordBotMessage(msgId, groupJid, { taskId = null, reminderId = null, renderId = null, kind = null } = {}) {
  if (!msgId) return;
  db.prepare(
    'INSERT OR REPLACE INTO bot_messages (msg_id, group_jid, task_id, reminder_id, render_id, kind, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(msgId, groupJid, taskId, reminderId, renderId, kind, now());
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

// Restart safety: raw WhatsApp message kept until its image/PDF is described,
// so a description interrupted by a shutdown is retried on the next start.
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'media_msg')) {
  db.exec('ALTER TABLE messages ADD COLUMN media_msg TEXT');
}
for (const col of ['last_briefing_day', 'last_summary_day']) {
  if (!db.prepare('PRAGMA table_info(group_state)').all().some((c) => c.name === col)) {
    db.exec(`ALTER TABLE group_state ADD COLUMN ${col} TEXT`);
  }
}

export function setMediaMsg(id, json) {
  db.prepare('UPDATE messages SET media_msg = ? WHERE id = ?').run(json, id);
}

/** Images/PDFs that still wait for a description (newest first, last `days` days). */
export function pendingMedia(days = 3) {
  return db
    .prepare(
      `SELECT id, group_jid, group_name, sender_name, ts, kind, text, media_msg FROM messages
       WHERE media_msg IS NOT NULL AND media_desc IS NULL AND ts > strftime('%s','now') - ?
       ORDER BY ts DESC`,
    )
    .all(days * 86400);
}

export function dayMarker(groupJid, col) {
  return db.prepare(`SELECT ${col} AS d FROM group_state WHERE group_jid = ?`).get(groupJid)?.d ?? null;
}

export function setDayMarker(groupJid, col, day) {
  db.prepare(
    `INSERT INTO group_state (group_jid, ${col}) VALUES (?, ?)
     ON CONFLICT(group_jid) DO UPDATE SET ${col} = excluded.${col}`,
  ).run(groupJid, day);
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

/** Privacy cutoff prevents WhatsApp history from restoring erased chat on reconnect. */
export function deletedThrough(groupJid) {
  return db.prepare('SELECT deleted_through FROM group_privacy WHERE group_jid = ?').get(groupJid)?.deleted_through ?? 0;
}

/** Bounded keyword search over stored chat, never across groups or bot requests. */
export function searchMessages(groupJid, terms, limit = 40) {
  terms = terms.filter(Boolean).slice(0, 12);
  if (!terms.length) return [];
  const field = "lower(coalesce(text,'') || ' ' || coalesce(media_desc,'') || ' ' || coalesce(file_name,''))";
  const matches = terms.map(() => `instr(${field}, lower(?)) > 0`).join(' OR ');
  return db.prepare(`SELECT * FROM messages WHERE group_jid = ? AND from_bot = 0 AND to_bot = 0
    AND coalesce(text,'') NOT LIKE '/%' AND (${matches}) ORDER BY ts DESC, rowid DESC LIMIT ?`)
    .all(groupJid, ...terms, limit).reverse();
}

/** Caller drains background work and removes group media before committing the deletion. */
export function deleteGroupData(groupJid, through) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare('SELECT count(*) AS n FROM messages WHERE group_jid = ?').get(groupJid).n;
    for (const table of [
      'messages',
      'summaries',
      'reminders',
      'tasks',
      'clients',
      'client_notes',
      'client_note_revisions',
      'client_note_sources',
      'client_note_tombstones',
      'client_renders',
      'bot_messages',
      'group_state',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE group_jid = ?`).run(groupJid);
    }
    db.prepare(`INSERT INTO group_privacy VALUES (?, ?) ON CONFLICT(group_jid)
      DO UPDATE SET deleted_through = max(deleted_through, excluded.deleted_through)`).run(groupJid, through);
    db.exec('COMMIT');
    return count;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
