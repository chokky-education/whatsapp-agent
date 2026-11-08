// Parses a WhatsApp "Export chat" _chat.txt (iOS format, Thai or English UI).
//   [8/11/69 13:54:25] Nok: @⁨Somchai⁩ พี่ฝากRenderด้วยชาย
//   ‎[8/11/69 13:52:53] Nok: ‎<แนบ: 00003004-PHOTO-2026-11-08-13-52-53.jpg>
// Android exports ("8/11/69 13:54 - Nok: ...") are handled too.

const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;

const IOS_LINE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\] ([^:]+?):\s?([\s\S]*)$/i;
const ANDROID_LINE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})\s*([AP]M)? - ([^:]+?):\s?([\s\S]*)$/i;

const ATTACH = /^<(?:แนบ|attached):\s*(.+?)>$/i;
const ANDROID_ATTACH = /^(.+?\.\w{2,5}) \((?:file attached|ไฟล์แนบ)\)$/i;

// System notices we never want in a summary.
const SYSTEM_PATTERNS = [
  /เข้ารหัสจากต้นทางถึงปลายทาง/,
  /end-to-end encrypted/i,
  /ได้สร้างกลุ่ม/,
  /created group/i,
  /^.{0,60}ได้เพิ่ม.{0,60}เข้ากลุ่ม$/,
  /^.{0,60} added .{0,60}$/i,
  /joined using this group's invite link/i,
  /เข้าร่วมโดยใช้ลิงก์เชิญ/,
  /ได้ปักหมุดข้อความ/,
  /pinned a message/i,
  /ข้อความนี้ได้ถูกลบ/,
  /This message was deleted/i,
  /You deleted this message/i,
];

function toYear(y) {
  const n = Number(y);
  const thisYear = new Date().getFullYear();
  if (n >= 2400) return n - 543; // Buddhist Era, 4 digits: 2569 -> 2026
  if (n >= 100) return n;
  // Two digits: "26" is 2026, but a Thai phone writes "69" for BE 2569 = 2026.
  if (2000 + n <= thisYear + 1) return 2000 + n;
  return 2500 + n - 543;
}

function toTs(d, m, y, hh, mm, ss, ampm, dayFirst) {
  let h = Number(hh);
  if (ampm) {
    const pm = ampm.toUpperCase() === 'PM';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  const day = dayFirst ? Number(d) : Number(m);
  const month = dayFirst ? Number(m) : Number(d);
  // Exports are in the phone's local time; we treat that as the machine's local time.
  return Math.floor(new Date(toYear(y), month - 1, day, h, Number(mm), Number(ss || 0)).getTime() / 1000);
}

function kindFromFile(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'].includes(ext)) return /STICKER/i.test(name) ? 'sticker' : 'image';
  if (['mp4', 'mov', '3gp', 'mkv'].includes(ext)) return 'video';
  if (['opus', 'ogg', 'm4a', 'mp3', 'aac', 'wav'].includes(ext)) return 'audio';
  return 'document';
}

/**
 * @param {string} raw contents of _chat.txt
 * @param {{ dayFirst?: boolean }} [opts] dates are d/m/y unless dayFirst is false
 * @returns {{ id: string, ts: number, senderName: string, kind: string, text: string|null, fileName: string|null }[]}
 */
export function parseExport(raw, opts = {}) {
  const dayFirst = opts.dayFirst ?? true;
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let cur = null;

  for (const original of lines) {
    const line = original.replace(INVISIBLE, '');
    const ios = line.match(IOS_LINE);
    const android = !ios && line.match(ANDROID_LINE);

    if (ios || android) {
      if (cur) out.push(cur);
      const [d, mo, y, hh, mi, ss, ampm, sender, body] = ios
        ? ios.slice(1)
        : [android[1], android[2], android[3], android[4], android[5], null, android[6], android[7], android[8]];
      cur = {
        ts: toTs(d, mo, y, hh, mi, ss, ampm, dayFirst),
        senderName: sender.trim(),
        body: body.trim(),
      };
    } else if (cur) {
      cur.body += '\n' + line;
    }
  }
  if (cur) out.push(cur);

  const messages = [];
  out.forEach((m, i) => {
    const body = m.body.trim();
    if (!body) return;
    if (SYSTEM_PATTERNS.some((re) => re.test(body))) return;

    const attach = body.match(ATTACH) || body.match(ANDROID_ATTACH);
    const fileName = attach ? attach[1].trim() : null;
    messages.push({
      id: `export-${m.ts}-${i}`,
      ts: m.ts,
      senderName: m.senderName,
      kind: fileName ? kindFromFile(fileName) : 'text',
      text: fileName ? null : body,
      fileName,
    });
  });

  return messages;
}
