import { ask } from './ai.js';
import { config } from './config.js';

const KIND_LABEL = {
  image: 'รูป',
  video: 'วิดีโอ',
  audio: 'ข้อความเสียง',
  document: 'ไฟล์',
  sticker: 'สติกเกอร์',
  other: 'ไฟล์',
};

const fmtTime = (ts) =>
  new Date(ts * 1000).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.timezone,
  });

const fmtDate = (ts) =>
  new Date(ts * 1000).toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: config.timezone,
  });

/**
 * Turns stored rows into a compact transcript Claude can read.
 * Rows use the db column names (sender_name, media_desc, ...).
 */
export function buildTranscript(rows) {
  const lines = [];
  let day = null;
  for (const r of rows) {
    const d = fmtDate(r.ts);
    if (d !== day) {
      lines.push(`\n--- ${d} ---`);
      day = d;
    }
    const who = r.sender_name || 'ไม่ทราบชื่อ';
    const quoted = r.quoted_text ? ` (ตอบกลับ: "${r.quoted_text.slice(0, 80)}")` : '';
    if (r.kind === 'text') {
      if (/^\/\S/.test(r.text || '')) continue; // bot commands like /สรุป
      lines.push(`[${fmtTime(r.ts)}] ${who}${quoted}: ${r.text}`);
    } else {
      if (r.kind === 'sticker') continue;
      const label = KIND_LABEL[r.kind] || 'ไฟล์';
      const name = r.kind === 'document' && r.file_name ? ` "${r.file_name}"` : '';
      const desc = r.media_desc ? ` — ${r.media_desc.replace(/\s+/g, ' ')}` : '';
      const cap = r.text ? ` คำบรรยาย: ${r.text}` : '';
      lines.push(`[${fmtTime(r.ts)}] ${who}${quoted}: [${label}${name}${desc}]${cap}`);
    }
  }
  return lines.join('\n').trim();
}

const SYSTEM = `คุณเป็นผู้ช่วยสรุปงานของแชทกลุ่ม WhatsApp
บริบทของทีม: ${config.groupContext}

หน้าที่: อ่านบทสนทนาแล้วสรุปให้คนที่ไม่ได้อ่านแชทรู้ทันทีว่า ตกลงอะไรกันแล้ว ใครต้องทำอะไร และอะไรยังค้าง

กติกา:
- เขียนภาษาไทย กระชับ ใช้ชื่อคนตามที่ปรากฏในแชท
- สมาชิกบางคนพิมพ์ไทยปนลาวหรือสะกดผิด ให้ตีความตามความหมาย แต่เขียนสรุปด้วยภาษาไทยที่ถูกต้อง
- ข้อความที่อยู่ใน [ ... ] คือคำอธิบายรูปหรือไฟล์ที่ส่งในกลุ่ม ใช้ประกอบความเข้าใจได้
- เอาเฉพาะเรื่องที่มีในแชทจริง ห้ามแต่งเพิ่ม ถ้าไม่มีใครระบุ deadline ก็ไม่ต้องใส่
- ถ้าหัวข้อไหนไม่มีเนื้อหา ให้ตัดหัวข้อนั้นทิ้ง
- ถ้ามีสรุปครั้งก่อนแนบมา ให้เช็กว่างานค้างเดิมเสร็จหรือยัง งานที่ยังไม่เห็นว่าเสร็จให้ยกมาไว้ใน "ยังค้าง"
- จัดรูปแบบสำหรับ WhatsApp: ตัวหนาใช้ *ข้อความ* และใช้ - นำหน้ารายการ ห้ามใช้ # หรือ ** หรือตาราง markdown

รูปแบบผลลัพธ์:
📋 *สรุปงาน: <ชื่อกลุ่ม>*
<ช่วงเวลา>

✅ *ตกลง/ตัดสินใจแล้ว*
- ...

📌 *งานที่ต้องทำ*
- <ใคร>: <ทำอะไร> (<กำหนดส่ง ถ้ามี>)

⏳ *ยังค้าง / รอคำตอบ*
- ...

🖼️ *ไฟล์และรูปสำคัญ*
- <ใครส่ง>: <ไฟล์อะไร>

🔗 *ลิงก์*
- <ลิงก์> — <คืออะไร>`;

/**
 * @param {object[]} rows messages (db column names)
 * @param {{ groupName: string, previousSummary?: string|null, focus?: 'all'|'tasks' }} opts
 */
export async function summarize(rows, { groupName, previousSummary = null, focus = 'all' }) {
  if (!rows.length) return null;
  const first = rows[0].ts;
  const last = rows[rows.length - 1].ts;
  const period =
    fmtDate(first) === fmtDate(last)
      ? `${fmtDate(first)} ${fmtTime(first)}–${fmtTime(last)}`
      : `${fmtDate(first)} ${fmtTime(first)} – ${fmtDate(last)} ${fmtTime(last)}`;

  const parts = [`ชื่อกลุ่ม: ${groupName}`, `ช่วงเวลา: ${period}`];
  if (previousSummary) parts.push(`<สรุปครั้งก่อน>\n${previousSummary}\n</สรุปครั้งก่อน>`);
  parts.push(`<บทสนทนา>\n${buildTranscript(rows)}\n</บทสนทนา>`);
  parts.push(
    focus === 'tasks'
      ? 'ตอบเฉพาะหัวข้อ "งานที่ต้องทำ" และ "ยังค้าง / รอคำตอบ" ตามรูปแบบ'
      : 'สรุปตามรูปแบบที่กำหนด',
  );

  return ask({ system: SYSTEM, text: parts.join('\n\n'), effort: 'medium' });
}
