import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocal, nextOccurrence } from '../src/tasks.js';

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
