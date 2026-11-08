import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-tasks-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');

const { parseLocal, nextOccurrence } = await import('../src/tasks.js');
const db = await import('../src/db.js');

const iso = (ts) => new Date((ts + 7 * 3600) * 1000).toISOString().slice(0, 16); // Bangkok wall clock

test('parseLocal reads Bangkok wall-clock time', () => {
  assert.equal(iso(parseLocal('2026-11-09 14:00')), '2026-11-09T14:00');
  assert.equal(parseLocal('tomorrow'), null);
});

test('nextOccurrence handles daily, weekdays, weekly and monthly', () => {
  const fri = parseLocal('2026-11-13 09:00'); // Friday
  assert.equal(iso(nextOccurrence(fri, 'daily')), '2026-11-14T09:00');
  assert.equal(iso(nextOccurrence(fri, 'weekdays')), '2026-11-16T09:00'); // skips the weekend
  assert.equal(iso(nextOccurrence(fri, 'weekly')), '2026-11-20T09:00');
  assert.equal(iso(nextOccurrence(parseLocal('2026-01-31 08:00'), 'monthly')), '2026-02-28T08:00');
  assert.equal(nextOccurrence(fri, 'none'), null);
});

test('client CRUD, alias matching, note categories, task linking, and group deletion', () => {
  const G = '120363000000000099@g.us';
  const id = db.addClient({
    groupJid: G,
    name: 'คุณสมชาย',
    aliases: 'บ้านลาดพร้าว, พี่ชาย',
    stage: 'design',
    location: 'ลาดพร้าว 71',
    budget: '8 ล้าน',
    createdBy: 'Nok',
  });
  assert.equal(db.findClient(G, 'บ้านลาดพร้าว')?.id, id);
  assert.equal(db.findClient(G, 'คุณสมชาย')?.id, id);
  assert.equal(db.findClient('other@g.us', 'บ้านลาดพร้าว'), null);

  const id2 = db.addClient({ groupJid: G, name: 'เอึ้อยดาว', aliases: 'บ้านดาว', stage: 'brief' });
  assert.equal(db.findClient(G, 'เอื้อยดาว')?.id, id2, 'matches ึ/ื spelling variant');
  assert.ok(db.clientTerms(db.getClient(id2)).includes('เอื้อยดาว'));

  const n1 = db.addClientNote({ groupJid: G, clientId: id, category: 'spec', text: 'กระเบื้องสีเทา 60x60', createdBy: 'Nok' });
  assert.equal(db.clientNotes(id).length, 1);
  assert.equal(db.clientNotes(id)[0].id, n1);

  db.addTask({ groupJid: G, title: 'แก้แปลนชั้น 2', clientId: id });
  assert.equal(db.openTasks(G)[0].client_name, 'คุณสมชาย');

  assert.equal(db.deleteClientNote(n1), true);
  assert.equal(db.clientNotes(id).length, 0);

  db.deleteGroupData(G, Math.floor(Date.now() / 1000));
  assert.equal(db.activeClients(G).length, 0);
  assert.equal(db.getClient(id), null);
});

test('Phase 1: note provenance sources, revisions, expectedRevision conflict, and tombstone dedupe', () => {
  const G = '120363000000000101@g.us';
  const G_OTHER = '120363000000000102@g.us';
  const cId = db.addClient({ groupJid: G, name: 'บ้านตัวอย่าง', aliases: 'คุณเอก', stage: 'design' });

  db.saveMessage({ id: 'MSG_REAL_1', groupJid: G, senderName: 'Nok', ts: 1700000100, kind: 'text', text: 'บ้านตัวอย่าง ใช้กระเบื้องสีขาว' });
  db.saveMessage({ id: 'MSG_REAL_2', groupJid: G, senderName: 'Somchai', ts: 1700000200, kind: 'text', text: 'บ้านตัวอย่าง เปลี่ยนเป็นสีเทาด้าน' });
  db.saveMessage({ id: 'MSG_FOREIGN', groupJid: G_OTHER, senderName: 'Nok', ts: 1700000300, kind: 'text', text: 'ข้อความกลุ่มอื่น' });

  const noteId = db.addClientNote({
    groupJid: G,
    clientId: cId,
    category: 'spec',
    text: 'กระเบื้องสีขาว',
    createdBy: 'Nok',
    source: 'chat',
    sourceMessageIds: ['MSG_REAL_1', 'MSG_FOREIGN', 'MSG_FAKE_DOES_NOT_EXIST'],
  });

  const note1 = db.getClientNote(noteId);
  assert.equal(note1.revision_count, 1);
  assert.ok(note1.current_revision_id);

  // Only valid same-group message is linked as provenance
  const sources1 = db.noteSources(noteId, G);
  assert.equal(sources1.length, 1);
  assert.equal(sources1[0].id, 'MSG_REAL_1');
  assert.equal(sources1[0].sender_name, 'Nok');
  assert.equal(db.noteSources(noteId, G_OTHER).length, 0, 'cross-group source read blocked');

  // Stale expectedRevision is rejected
  const conflict = db.editClientNote(noteId, {
    groupJid: G,
    text: 'สีครีม',
    updatedBy: 'Somchai',
    expectedRevision: 99,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'conflict');

  // Cross-group edit is rejected
  const crossEdit = db.editClientNote(noteId, {
    groupJid: G_OTHER,
    text: 'แก้ข้ามกลุ่ม',
    updatedBy: 'Somchai',
  });
  assert.equal(crossEdit.ok, false);

  // Valid edit increments revision, preserves history, and updates sources
  const edited = db.editClientNote(noteId, {
    groupJid: G,
    text: 'กระเบื้องสีเทาด้าน',
    category: 'spec',
    updatedBy: 'Somchai',
    reason: 'ลูกค้าเปลี่ยนสเปก',
    kind: 'correction',
    sourceMessageIds: ['MSG_REAL_2'],
    expectedRevision: 1,
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.note.text, 'กระเบื้องสีเทาด้าน');
  assert.equal(edited.note.revision_count, 2);

  const revs = db.noteRevisions(noteId, G);
  assert.equal(revs.length, 2);
  assert.equal(revs[0].revision_no, 1);
  assert.equal(revs[0].text, 'กระเบื้องสีขาว');
  assert.equal(revs[1].revision_no, 2);
  assert.equal(revs[1].text, 'กระเบื้องสีเทาด้าน');
  assert.equal(revs[1].created_by, 'Somchai');

  const sources2 = db.noteSources(noteId, G);
  assert.equal(sources2.length, 1);
  assert.equal(sources2[0].id, 'MSG_REAL_2');

  // Old superseded text and current text are both blocked from duplicate auto-sync
  assert.equal(db.hasClientNoteDedupe(G, cId, 'กระเบื้องสีขาว'), true);
  assert.equal(db.hasClientNoteDedupe(G, cId, 'กระเบื้องสีเทาด้าน'), true);

  // Deleting note keeps tombstone so auto-sync will not recreate it from old chat
  assert.equal(db.deleteClientNote(noteId, G_OTHER), false);
  assert.equal(db.deleteClientNote(noteId, G), true);
  assert.equal(db.getClientNote(noteId), null);
  assert.equal(db.noteRevisions(noteId, G).length, 0);
  assert.equal(db.hasClientNoteDedupe(G, cId, 'กระเบื้องสีเทาด้าน'), true);

  // Group erasure clears tombstones too
  db.deleteGroupData(G, Math.floor(Date.now() / 1000));
  assert.equal(db.hasClientNoteDedupe(G, cId, 'กระเบื้องสีเทาด้าน'), false);
});

test('renders: standalone (no client), edit depth via parent, usage count, group deletion', () => {
  const G = '120363000000000201@g.us';
  const r1 = db.addRender({
    groupJid: G,
    sourceMsgId: 'SKETCH_MSG_1',
    sourceMediaPath: '/tmp/sketch1.png',
    outputMediaPath: '/tmp/render_a.png',
    prompt: 'warm neutral',
    model: 'gpt-image-2.6-sunburst',
    createdBy: 'Nok',
  });
  const r2 = db.addRender({
    groupJid: G,
    parentId: r1,
    sourceMediaPath: '/tmp/render_a.png',
    outputMediaPath: '/tmp/render_b.png',
    prompt: 'ไฟอุ่นขึ้น',
    model: 'gpt-image-2.6-sunburst',
    createdBy: 'Somchai',
  });
  assert.equal(db.getRender(r1).client_id, null);
  assert.equal(db.getRender(r1).version_no, 1);
  assert.equal(db.getRender(r2).version_no, 2);
  assert.equal(db.getRender(r2).parent_id, r1);
  assert.equal(db.rendersCountSince(G, Math.floor(Date.now() / 1000) - 60), 2);

  db.deleteGroupData(G, Math.floor(Date.now() / 1000));
  assert.equal(db.getRender(r1), null);
  assert.equal(db.rendersCountSince(G, 0), 0);
});

test('renders: an old database where renders required a client migrates and keeps rows and ids', () => {
  const file = path.join(tmp, 'old-renders.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE client_renders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, group_jid TEXT NOT NULL, client_id INTEGER NOT NULL,
    version_no INTEGER NOT NULL, parent_version INTEGER, source_msg_id TEXT, source_media_path TEXT,
    output_media_path TEXT, prompt TEXT NOT NULL, spec_snapshot TEXT, model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'done', created_by TEXT, created_at INTEGER NOT NULL);
    INSERT INTO client_renders (id, group_jid, client_id, version_no, prompt, model, created_at)
      VALUES (7, '120363000000000202@g.us', 3, 1, 'old render', 'm', 1);`);
  old.close();
  const out = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `const db = await import(${JSON.stringify(path.resolve('src/db.js'))});
      const id = db.addRender({ groupJid: '120363000000000202@g.us', parentId: 7, outputMediaPath: '/tmp/x.png', prompt: 'new', model: 'm' });
      console.log(JSON.stringify({ old: db.getRender(7), id, row: db.getRender(id) }));`],
    { env: { ...process.env, DB_PATH: file }, encoding: 'utf8' },
  );
  assert.equal(out.status, 0, out.stderr);
  const r = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.equal(r.old.prompt, 'old render');
  assert.equal(r.old.client_id, 3);
  assert.equal(r.id, 8, 'ids continue after the old rows');
  assert.equal(r.row.client_id, null);
  assert.equal(r.row.parent_id, 7);
  assert.equal(r.row.version_no, 2);
});


