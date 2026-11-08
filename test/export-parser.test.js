import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExport } from '../src/export-parser.js';

const SAMPLE = [
  '[8/11/69 13:51:18] Team: ‎ข้อความและการโทรได้รับการเข้ารหัสจากต้นทางถึงปลายทาง',
  '[8/11/69 13:51:18] Anan: ‎Anan ได้สร้างกลุ่ม “Team”',
  '‎[8/11/69 13:52:53] Anan: ‎<แนบ: 00000001-PHOTO-2026-11-08-13-52-53.jpg>',
  '[8/11/69 13:54:25] Anan: @⁨Bee⁩ ฝาก Render ด้วย',
  'บรรทัดที่สองของข้อความเดียวกัน',
  '[8/11/69 13:55:00] Bee: ข้อความนี้ได้ถูกลบ',
  '[8/11/69 18:04:32] Bee:\r',
  '[8/11/69 19:43:47] Bee: https://drive.google.com/x',
  '[8/11/69 19:43:59] ‎คุณ: ‎คุณได้ปักหมุดข้อความ',
  '[1/2/26, 9:05:00 PM] Bee: <attached: 00000002-plan.pdf>',
].join('\n');

test('parses Thai iOS export, drops system lines, keeps multi-line text', () => {
  const msgs = parseExport(SAMPLE);
  assert.equal(msgs.length, 4);
  assert.deepEqual(msgs.map((m) => m.kind), ['image', 'text', 'text', 'document']);
  assert.equal(msgs[0].fileName, '00000001-PHOTO-2026-11-08-13-52-53.jpg');
  assert.equal(msgs[1].text, '@Bee ฝาก Render ด้วย\nบรรทัดที่สองของข้อความเดียวกัน');
  assert.equal(msgs[1].senderName, 'Anan');
});

test('converts Buddhist-era 2-digit year 69 to 2026 and handles PM', () => {
  const msgs = parseExport(SAMPLE);
  const d = new Date(msgs[0].ts * 1000);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10); // November
  assert.equal(d.getDate(), 8);
  const pm = new Date(msgs[3].ts * 1000);
  assert.equal(pm.getFullYear(), 2026);
  assert.equal(pm.getHours(), 21);
});
