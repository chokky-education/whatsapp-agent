import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useAtomicAuthState } from '../src/auth-state.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('atomic write creates .bak, leaves no .tmp files, and round-trips keys', async (t) => {
  const dir = makeTempDir(t);
  const { state, saveCreds, flush } = await useAtomicAuthState(dir);

  await saveCreds();
  await state.keys.set({
    'pre-key': { 1: { priv: Buffer.from([1, 2]), pub: Buffer.from([3, 4]) } },
    'app-state-sync-key': { k1: { keyData: new Uint8Array([9, 8]) } },
  });

  state.creds.accountSyncCounter = 5;
  await saveCreds();
  await flush();

  const credsPath = path.join(dir, 'creds.json');
  const credsBakPath = path.join(dir, 'creds.json.bak');
  assert.equal(fs.existsSync(credsPath), true);
  assert.equal(fs.existsSync(credsBakPath), true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(credsPath, 'utf8')));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(credsBakPath, 'utf8')));
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')),
    [],
  );

  const preKeys = await state.keys.get('pre-key', ['1']);
  assert.equal(Buffer.isBuffer(preKeys['1'].priv), true);
  assert.deepEqual([...preKeys['1'].priv], [1, 2]);
  assert.deepEqual([...preKeys['1'].pub], [3, 4]);

  const syncKeys = await state.keys.get('app-state-sync-key', ['k1']);
  assert.deepEqual([...syncKeys.k1.keyData], [9, 8]);
});

test('recovers 0-byte truncated creds.json and key files from .bak', async (t) => {
  const dir = makeTempDir(t);
  const initial = await useAtomicAuthState(dir);
  initial.state.creds.accountSyncCounter = 5;
  await initial.saveCreds();
  initial.state.creds.accountSyncCounter = 6;
  await initial.saveCreds();

  await initial.state.keys.set({
    'pre-key': { 1: { priv: Buffer.from([1, 2]), pub: Buffer.from([3, 4]) } },
  });
  await initial.state.keys.set({
    'pre-key': { 1: { priv: Buffer.from([5, 6]), pub: Buffer.from([7, 8]) } },
  });
  await initial.flush();

  const credsPath = path.join(dir, 'creds.json');
  const preKeyPath = path.join(dir, 'pre-key-1.json');
  fs.writeFileSync(credsPath, '');
  fs.writeFileSync(preKeyPath, '');

  const recovered = await useAtomicAuthState(dir);
  assert.equal(recovered.state.creds.accountSyncCounter, 5);
  assert.ok(fs.statSync(credsPath).size > 0);

  const keys = await recovered.state.keys.get('pre-key', ['1']);
  assert.deepEqual([...keys['1'].priv], [1, 2]);
  assert.deepEqual([...keys['1'].pub], [3, 4]);
  assert.ok(fs.statSync(preKeyPath).size > 0);
});

test('cleans up unbacked 0-byte json files and leftover .tmp files on startup', async (t) => {
  const dir = makeTempDir(t);
  for (const id of [818, 819, 820, 821, 822]) {
    fs.writeFileSync(path.join(dir, `pre-key-${id}.json`), '');
  }
  fs.writeFileSync(path.join(dir, 'creds.json.123.1.tmp'), 'partial');

  const { state } = await useAtomicAuthState(dir);
  assert.deepEqual(fs.readdirSync(dir), []);

  const res = await state.keys.get('pre-key', ['818']);
  assert.deepEqual(res, {});
});

test('removing a key deletes both primary and .bak files', async (t) => {
  const dir = makeTempDir(t);
  const { state, flush } = await useAtomicAuthState(dir);

  await state.keys.set({
    'pre-key': { 1: { priv: Buffer.from([1, 2]), pub: Buffer.from([3, 4]) } },
  });
  await state.keys.set({
    'pre-key': { 1: { priv: Buffer.from([5, 6]), pub: Buffer.from([7, 8]) } },
  });
  assert.equal(fs.existsSync(path.join(dir, 'pre-key-1.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'pre-key-1.json.bak')), true);

  await state.keys.set({ 'pre-key': { 1: null } });
  await flush();

  assert.equal(fs.existsSync(path.join(dir, 'pre-key-1.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'pre-key-1.json.bak')), false);
});
