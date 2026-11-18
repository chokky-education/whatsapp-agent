import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue } from '../src/serial-queue.js';

test('stuck job triggers recovery without starting the next mutation', async () => {
  let recover;
  const stuck = new Promise((resolve) => { recover = resolve; });
  const queue = createSerialQueue({ timeoutMs: 20, onStuck: recover });
  let release;
  const first = queue(() => new Promise((resolve) => { release = resolve; }));
  let secondStarted = false;
  const second = queue(() => { secondStarted = true; });
  await Promise.race([stuck, new Promise((_, reject) => setTimeout(() => reject(new Error('watchdog did not fire')), 500))]);
  assert.equal(secondStarted, false);
  release();
  await Promise.all([first, second]);
  assert.equal(secondStarted, true);
});

test('completed and failed jobs do not trigger recovery', async () => {
  let fired = false;
  const queue = createSerialQueue({ timeoutMs: 20, onStuck: () => { fired = true; } });
  await assert.rejects(queue(() => { throw new Error('example'); }));
  await queue(() => {});
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(fired, false);
});
