#!/usr/bin/env node
// Local search index for AI agents (Codex, Antigravity, Claude Code — any agent that can run a shell).
// Plain Node, no dependencies. Every command refreshes changed files first, so results stay current.
//
//   node scripts/index.mjs files "tasks"                  find files by name, with their exports
//   node scripts/index.mjs search "reminder snooze"       full-text search over code and docs
//   node scripts/index.mjs show <id> --around nag         open one result
//   node scripts/index.mjs refresh                        rebuild + regenerate INDEX.md
//   node scripts/index.mjs status | help
//
// Privacy: chat data never enters the index. data/ (messages, WhatsApp login keys, media), output/
// (summaries of real chats) and .env* are skipped. From data/messages.db only the table schema is read.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, '.local-index');
const APP_DB = join(ROOT, 'data', 'messages.db');
const VERSION = '2'; // bump when chunking/summary logic changes, to force a full rebuild

const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.sh', '.yml', '.yaml', '.mdc']);
const IGNORED_DIRS = new Set(['node_modules', '.git', '.local-index', 'data', 'output', 'coverage', 'dist']);
const IGNORED_FILES = new Set(['INDEX.md', 'package-lock.json']);
const MAX_FILE_BYTES = 512 * 1024;
const CHUNK_CHARS = 2000;
const CHUNK_LINES = 40;

// ---------- arguments ----------

const FLAGS = new Set(['json', 'brief', 'no-refresh']);
function parseArgs(argv) {
  const command = argv.shift() ?? 'status';
  const options = {};
  const words = [];
  while (argv.length) {
    const arg = argv.shift();
    if (!arg.startsWith('--')) { words.push(arg); continue; }
    const name = arg.slice(2);
    if (FLAGS.has(name)) options[name] = true;
    else if (argv.length) options[name] = argv.shift();
    else fail(`Missing value for --${name}`);
  }
  return { command, options, query: words.join(' ').trim() };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { command, options, query } = parseArgs(process.argv.slice(2));
const COMMANDS = ['files', 'search', 'show', 'refresh', 'status', 'help'];
if (!COMMANDS.includes(command)) fail(`Unknown command "${command}". Use: ${COMMANDS.join(', ')}`);

const cap = clamp(Number(options['max-chars'] ?? (command === 'show' ? 6000 : 3000)), 500, 20000);
const limit = clamp(Number(options.limit ?? 8), 1, 30);
if (options.kind && !['code', 'doc', 'test', 'schema'].includes(options.kind)) fail('--kind must be code | doc | test | schema');
const pathFilter = options.path?.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
if (options.path && (!pathFilter || pathFilter.startsWith('/') || pathFilter.split('/').includes('..'))) {
  fail('--path must be a project-relative file or directory, e.g. src/ or src/tasks.js');
}

if (command === 'help') {
  console.log(`node scripts/index.mjs files [name words] [--path src/] [--kind code|doc|test]
node scripts/index.mjs search "words" [--kind code|doc|test|schema] [--path src/] [--limit 8] [--brief] [--json]
node scripts/index.mjs show <id> [--around word] [--context 4] [--max-chars 6000]
node scripts/index.mjs refresh   rebuild changed entries and regenerate INDEX.md
node scripts/index.mjs status
Search matches every word (any order); words under 3 letters use a slower substring match.
Output is capped at --max-chars (default 3000). Chat content and secrets are never indexed.`);
  process.exit(0);
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) fail('Numeric option expected');
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// ---------- store ----------

mkdirSync(STORE, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(STORE, 'index.sqlite'));
db.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sources (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, symbols TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, ref TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source);
  CREATE VIRTUAL TABLE IF NOT EXISTS lookup USING fts5(id UNINDEXED, title, ref, body, tokenize = 'trigram');
`);
if (db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value !== VERSION) {
  db.exec('DELETE FROM sources; DELETE FROM chunks; DELETE FROM lookup;');
  db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('version', VERSION);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

const stats = { changed: 0, removed: 0, unchanged: 0 };
const seen = new Set();

function removeSource(key) {
  for (const { id } of db.prepare('SELECT id FROM chunks WHERE source = ?').all(key)) {
    db.prepare('DELETE FROM lookup WHERE id = ?').run(id);
  }
  db.prepare('DELETE FROM chunks WHERE source = ?').run(key);
  db.prepare('DELETE FROM sources WHERE key = ?').run(key);
}

function isChanged(key, fingerprint) {
  seen.add(key);
  if (db.prepare('SELECT fingerprint FROM sources WHERE key = ?').get(key)?.fingerprint === fingerprint) {
    stats.unchanged++;
    return false;
  }
  return true;
}

function upsert(key, fingerprint, parts, { symbols = '', summary = '' } = {}) {
  removeSource(key);
  parts.forEach((part, i) => {
    const id = sha(`${key}:${i}`).slice(0, 12);
    db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)').run(id, key, part.kind, part.title, part.ref, part.body);
    db.prepare('INSERT INTO lookup VALUES (?, ?, ?, ?)').run(id, part.title, part.ref, part.body);
  });
  db.prepare('INSERT INTO sources VALUES (?, ?, ?, ?)').run(key, fingerprint, symbols, summary);
  stats.changed++;
}

// Split text into line-ranged chunks; the ref records the first line number (file:line).
function chunk(text, kind, title, ref) {
  const parts = [];
  const lines = text.split('\n');
  let body = '';
  let start = 1;
  lines.forEach((line, i) => {
    if (body && (body.length + line.length > CHUNK_CHARS || i + 1 - start >= CHUNK_LINES)) {
      parts.push({ kind, title, ref: `${ref}:${start}`, body });
      body = '';
      start = i + 1;
    }
    body += line.slice(0, CHUNK_CHARS * 2) + '\n';
  });
  if (body.trim() || !parts.length) parts.push({ kind, title, ref: `${ref}:${start}`, body });
  return parts;
}

// ---------- what each file is ----------

function kindOf(rel) {
  if (/^tests?\//.test(rel) || /\.test\.[cm]?js$/.test(rel)) return 'test';
  if (['.md', '.mdc'].includes(extname(rel))) return 'doc';
  return 'code';
}

// Exported names and top-level functions, with line numbers, for the map and `files`.
function symbolsOf(text, rel) {
  const ext = extname(rel);
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    let m;
    if (['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
      if ((m = line.match(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/))) out.push(`${m[1]}:${i + 1}`);
      else if ((m = line.match(/^(?:async\s+)?function\*?\s+([\w$]+)/))) out.push(`_${m[1]}:${i + 1}`);
      else if ((m = line.match(/^\s*test\(\s*['"`](.+?)['"`]/))) out.push(`test "${clip(m[1], 50)}":${i + 1}`);
    } else if (ext === '.md') {
      if ((m = line.match(/^(#{1,3})\s+(.+)/))) out.push(`${m[2].trim()}:${i + 1}`);
    } else if (ext === '.sh') {
      if ((m = line.match(/^([\w-]+)\s*\(\)\s*\{/))) out.push(`${m[1]}:${i + 1}`);
    }
  });
  return out.join(', ');
}

// First comment block (code) or first paragraph (docs): a one-line "what is this file".
function summaryOf(text, rel) {
  const lines = text.split('\n');
  if (['.md', '.mdc'].includes(extname(rel))) {
    const para = lines.filter((l) => l.trim() && !/^(---|\w+:\s)/.test(l) && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('|'))[0] ?? '';
    return clip(oneLine(para), 140);
  }
  const comments = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#!') || (!t && !comments.length)) continue;
    const m = t.match(/^(?:\/\/|#)\s?(.*)$/);
    if (!m) break;
    if ((!m[1] || /^\s{2,}/.test(m[1])) && comments.length) break; // blank or indented example ends the summary
    comments.push(m[1]);
  }
  return clip(oneLine(comments.join(' ')), 160);
}

// ---------- refresh ----------

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.env')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(full);
      continue;
    }
    if (!entry.isFile() || IGNORED_FILES.has(entry.name) || !EXTENSIONS.has(extname(entry.name))) continue;
    const rel = relative(ROOT, full).replaceAll('\\', '/');
    const st = statSync(full);
    if (st.size > MAX_FILE_BYTES) continue;
    const key = `file:${rel}`;
    const fingerprint = `${st.mtimeMs}:${st.size}`;
    if (!isChanged(key, fingerprint)) continue;
    const text = readFileSync(full, 'utf8');
    const kind = kindOf(rel);
    const title = kind === 'doc' ? text.match(/^#\s+(.+)$/m)?.[1] ?? rel : rel;
    upsert(key, fingerprint, chunk(text, kind, title, rel), { symbols: symbolsOf(text, rel), summary: summaryOf(text, rel) });
  }
}

// Table definitions only. Row values (messages, names, phone JIDs) are private and never read.
function refreshSchema() {
  if (!existsSync(APP_DB)) return;
  let app;
  try {
    app = new DatabaseSync(APP_DB, { readOnly: true });
    const tables = app.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    for (const { name, sql } of tables) {
      const key = `schema:${name}`;
      const text = sql ?? '';
      if (!isChanged(key, sha(text))) continue;
      const columns = app.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all().map((c) => c.name).join(', ');
      upsert(key, sha(text), chunk(text, 'schema', `table ${name}`, `data/messages.db#${name}`), { symbols: columns, summary: `SQLite table ${name}` });
    }
  } catch (err) {
    console.error(`Schema skipped: ${err.message}`);
  } finally {
    app?.close();
  }
}

// ---------- INDEX.md (generated) ----------

// Hand-written task → file routing. Edit this table, then run `refresh`; never edit INDEX.md directly.
const ROUTES = [
  ['เชื่อม WhatsApp / รับข้อความ / คำสั่งในกลุ่ม (/สรุป, /งาน…) / ตั้งเวลา cron', 'src/bot.js'],
  ['ค่าตั้งค่าจาก .env (ชื่อตัวแปร ค่าเริ่มต้น)', 'src/config.js; .env.example'],
  ['เรียก AI (Claude / OpenAI), เลือก provider, JSON output', 'src/ai.js'],
  ['รูปแบบสรุป / prompt สรุป / transcript', 'src/summarize.js'],
  ['อธิบายรูปและ PDF', 'src/describe.js'],
  ['งาน / การเตือน / ทวงซ้ำ / สรุปเช้า / เวลา Bangkok', 'src/tasks.js'],
  ['ฐานข้อมูล SQLite (ตาราง + query)', 'src/db.js'],
  ['อ่านไฟล์ Export chat (.zip / _chat.txt)', 'src/export-parser.js; src/export-cli.js'],
  ['ตั้ง API key แบบไม่โชว์บนจอ', 'scripts/set-key.sh'],
  ['Tests', 'test/*.test.js (npm test)'],
  ['วิธีติดตั้ง / ใช้งาน / คำสั่งสำหรับผู้ใช้', 'README.md'],
  ['สถานะงานล่าสุด / งานถัดไป / บันทึกส่งต่อ', 'HANDOFF.md'],
  ['กติกาสำหรับ AI agent', 'AGENTS.md'],
  ['ระบบ index นี้', 'scripts/index.mjs'],
];

function writeMap() {
  const files = db.prepare("SELECT key, symbols, summary FROM sources WHERE key LIKE 'file:%' ORDER BY key").all();
  const tables = db.prepare("SELECT key, symbols FROM sources WHERE key LIKE 'schema:%' ORDER BY key").all();
  const fileRows = files.map(({ key, symbols, summary }) => {
    const rel = key.slice(5);
    const syms = symbols ? clip(symbols.split(', ').filter((s) => !s.startsWith('_') || symbols.length < 400).join(', '), 600) : '';
    return `| ${rel} | ${(summary || '').replaceAll('|', '\\|')} | ${syms.replaceAll('|', '\\|')} |`;
  });
  const text = `# Project index

> Generated by \`node scripts/index.mjs refresh\` — do not edit by hand. To change routing, edit \`ROUTES\` in scripts/index.mjs.

WhatsApp group bot (Node ≥ 22.5, ESM, Baileys + SQLite) that stores group chat, describes images/PDFs with AI,
posts Thai summaries, and tracks tasks and reminders. Rules for agents: AGENTS.md. Current status: HANDOFF.md.

## Search

\`\`\`bash
node scripts/index.mjs files "tasks"                 # file names + exported symbols
node scripts/index.mjs search "snooze reminder"      # content (every word must match)
node scripts/index.mjs search "เตือน" --path src/ --brief
node scripts/index.mjs show <id> --around nag --context 4
\`\`\`

## Where to look

| Task | Source |
| --- | --- |
${ROUTES.map(([task, src]) => `| ${task} | ${src} |`).join('\n')}

## Files

Symbols are \`name:line\`; a leading \`_\` means not exported.

| File | What it is | Symbols |
| --- | --- | --- |
${fileRows.join('\n')}

## Database (data/messages.db — schema only)

${tables.map(({ key, symbols }) => `- **${key.slice(7)}**: ${symbols}`).join('\n') || '- (database not created yet — run the bot once)'}

Not indexed on purpose: \`data/\` rows, \`data/auth/\` (WhatsApp login keys), \`data/media/\`, \`output/\` (real chat summaries), \`.env\`.
`;
  const path = join(ROOT, 'INDEX.md');
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
}

const started = Date.now();
if (!options['no-refresh']) {
  db.exec('BEGIN IMMEDIATE');
  try {
    walk(ROOT);
    refreshSchema();
    for (const { key } of db.prepare('SELECT key FROM sources').all()) {
      if (!seen.has(key)) { removeSource(key); stats.removed++; }
    }
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('updated', new Date().toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  writeMap();
}

// ---------- output ----------

function emit(value, text) {
  if (!options.json) { console.log(clip(text, cap)); return; }
  let out = JSON.stringify(value);
  if (out.length > cap && Array.isArray(value.results)) {
    value.truncated = true;
    while (value.results.length && JSON.stringify(value).length > cap) value.results.pop();
    out = JSON.stringify(value);
  }
  if (out.length > cap && typeof value.body === 'string') {
    value.truncated = true;
    value.body = clip(value.body, Math.max(0, value.body.length - (out.length - cap) - 1));
    out = JSON.stringify(value);
  }
  console.log(out);
}

const scope = pathFilter ? { sql: ' AND (c.source = ? OR instr(c.source, ?) = 1)', args: [`file:${pathFilter}`, `file:${pathFilter}/`] } : { sql: '', args: [] };
const kindSql = options.kind ? ' AND c.kind = ?' : '';
const kindArgs = options.kind ? [options.kind] : [];

if (command === 'status' || command === 'refresh') {
  const kinds = db.prepare('SELECT kind, COUNT(DISTINCT source) AS sources, COUNT(*) AS chunks FROM chunks GROUP BY kind').all();
  const value = { project: ROOT, updated: db.prepare("SELECT value FROM meta WHERE key = 'updated'").get()?.value, kinds, refresh: stats, ms: Date.now() - started };
  emit(value, JSON.stringify(value, null, 2));
}

if (command === 'files') {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = db.prepare(`SELECT key, symbols, summary FROM sources ORDER BY key`).all()
    .filter(({ key }) => !pathFilter || key === `file:${pathFilter}` || key.startsWith(`file:${pathFilter}/`))
    .filter(({ key }) => !options.kind || (key.startsWith('schema:') ? options.kind === 'schema' : kindOf(key.slice(5)) === options.kind))
    .filter(({ key, symbols }) => words.every((w) => key.toLowerCase().includes(w) || symbols.toLowerCase().includes(w)))
    .slice(0, Math.max(limit, 30));
  const results = rows.map(({ key, symbols, summary }) => ({ path: key.replace(/^(file|schema):/, (m) => (m === 'schema:' ? 'table ' : '')), summary, symbols }));
  emit({ results }, results.length
    ? results.map((r) => `${r.path}${r.summary ? ` — ${r.summary}` : ''}${r.symbols ? `\n  ${clip(r.symbols, 300)}` : ''}`).join('\n')
    : 'No files match. Try fewer words or `search` for content.');
}

if (command === 'search') {
  if (!query) fail('search needs words, e.g. search "reminder snooze"');
  if (query.length > 300) fail('Keep the query under 300 characters');
  const words = query.split(/\s+/).filter(Boolean);
  const long = words.filter((w) => [...w].length >= 3);
  const short = words.filter((w) => [...w].length < 3);
  let rows;
  const likeSql = short.map(() => ' AND instr(lower(c.body || c.title || c.ref), lower(?)) > 0').join('');
  if (long.length) {
    const match = long.map((w) => `"${w.replaceAll('"', '""')}"`).join(' AND ');
    rows = db.prepare(`SELECT c.id, c.kind, c.ref, c.title, c.body, bm25(lookup) AS score FROM lookup JOIN chunks c ON c.id = lookup.id
      WHERE lookup MATCH ?${kindSql}${scope.sql}${likeSql} ORDER BY score LIMIT ?`).all(match, ...kindArgs, ...scope.args, ...short, limit);
  } else {
    rows = db.prepare(`SELECT c.id, c.kind, c.ref, c.title, c.body, 0 AS score FROM chunks c WHERE 1 = 1${kindSql}${scope.sql}${likeSql} LIMIT ?`)
      .all(...kindArgs, ...scope.args, ...short, limit);
  }
  const needle = words[0].toLowerCase();
  const results = rows.map((r) => {
    const lines = r.body.split('\n');
    const at = Math.max(0, lines.findIndex((l) => l.toLowerCase().includes(needle)));
    const line = Number(r.ref.split(':').pop()) + at;
    const snippet = clip(oneLine(lines.slice(at, at + 3).join(' ')), 220);
    return { id: r.id, kind: r.kind, ref: r.ref.replace(/:\d+$/, `:${line}`), title: r.title, snippet };
  });
  const text = results.length
    ? results.map((r) => (options.brief ? `${r.id}  ${r.ref}` : `${r.id}  [${r.kind}] ${r.ref}\n  ${r.snippet}`)).join('\n') +
      '\n\nOpen one: node scripts/index.mjs show <id> --around <word>'
    : 'No matches. Use fewer or different words (Thai and English both work), or grep inside the mapped file.';
  emit({ query, results }, text);
}

if (command === 'show') {
  if (!query) fail('show needs a result id from search');
  const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(query);
  if (!row) fail('That id no longer exists (file changed). Search again.');
  let body = row.body;
  let ref = row.ref;
  if (options.around) {
    const context = clamp(Number(options.context ?? 4), 0, 20);
    const lines = body.split('\n');
    const hit = lines.findIndex((l) => l.toLowerCase().includes(options.around.toLowerCase()));
    if (hit >= 0) {
      const from = Math.max(0, hit - context);
      const firstLine = Number(ref.split(':').pop());
      body = lines.slice(from, hit + context + 1).map((l, i) => `${firstLine + from + i}: ${l}`).join('\n');
      ref = ref.replace(/:\d+$/, `:${firstLine + hit}`);
    }
  } else {
    const firstLine = Number(ref.split(':').pop());
    if (Number.isFinite(firstLine)) body = body.split('\n').map((l, i) => `${firstLine + i}: ${l}`).join('\n');
  }
  emit({ id: row.id, kind: row.kind, ref, title: row.title, body }, `${ref}\n${body}`);
}
