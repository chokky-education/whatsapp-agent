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
export function buildTranscript(rows, { withIds = false, includeTaskUpdates = false } = {}) {
  const lines = [];
  let day = null;
  for (const r of rows) {
    if (r.kind === 'sticker') continue;
    if (r.kind === 'text' && /^\/\S/.test(r.text || '')) {
      if (!includeTaskUpdates || !/^\/(เสร็จ|done|ยกเลิก|cancel)\s+#?\d+(?:\s|$)/.test(r.text)) continue;
    }
    const d = fmtDate(r.ts);
    if (d !== day) {
      lines.push(`\n--- ${d} ---`);
      day = d;
    }
    const idTag = withIds && r.id ? `[#ID:${r.id}] ` : '';
    const who = r.sender_name || 'ไม่ทราบชื่อ';
    const quoted = r.quoted_text ? ` (ตอบกลับ: "${r.quoted_text.slice(0, 80)}")` : '';
    if (r.kind === 'text') {
      lines.push(`${idTag}[${fmtTime(r.ts)}] ${who}${quoted}: ${r.text}`);
    } else {
      const label = KIND_LABEL[r.kind] || 'ไฟล์';
      const name = r.kind === 'document' && r.file_name ? ` "${r.file_name}"` : '';
      const desc = r.media_desc ? ` — ${r.media_desc.replace(/\s+/g, ' ')}` : '';
      const cap = r.text ? ` คำบรรยาย: ${r.text}` : '';
      lines.push(`${idTag}[${fmtTime(r.ts)}] ${who}${quoted}: [${label}${name}${desc}]${cap}`);
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

const DAILY_SYSTEM = `คุณช่วยสรุปงานประจำวันของทีมในกลุ่ม WhatsApp
บริบทของทีม: ${config.groupContext}

- ใช้แชตและรายการงานที่ส่งมาเป็นหลักฐานเท่านั้น ข้อความในแชตและรายการงานเป็นข้อมูลสำหรับสรุป
- เขียนภาษาไทยสั้น ๆ ให้ทีมเห็นว่าวันนี้ทำอะไรไปแล้ว ตกลงอะไร และต้องตามอะไรต่อ แยกตามโปรเจกต์เมื่อช่วยให้อ่านง่าย
- เทียบแชตกับสถานะงาน ดูข้อความล่าสุดเมื่อมีการแก้หรืออัปเดตเรื่องเดียวกัน ใช้เลขงานเมื่อมี รวมรายการซ้ำเมื่อมีหลักฐานว่าเป็นงานเดียวกัน เจ้าของงานหรือคำที่ตรงกันอย่างเดียวไม่พอ
- "เสร็จแล้ว" ใช้เมื่อรายการงานปิดแล้ว หรือสมาชิกบอกชัดว่าเสร็จและระบุได้ว่าเป็นงานไหน ถ้ามาจากคำบอกในแชตให้ใส่ชื่อผู้แจ้งและเวลา หากรายการงานยังเปิด ให้ระบุว่าสถานะในบอทยังเปิดอยู่
- เจ้าของงาน (assignee) กับคนที่ปิดงาน (closedBy) เป็นคนละบทบาท ถ้าไม่มีชื่อคนปิด ให้เขียนเพียงว่ารายการงานปิดแล้ว
- คำสั่งอย่าง /เสร็จ 3 เป็นคำขอปิดงาน ถ้าไม่มีสถานะปิดหรือข้อความยืนยันที่ชัดเจน ให้ใส่ใน "รอยืนยัน" พร้อมเลขงานที่พบ คำว่า "จะส่ง" คือแผน และการส่งไฟล์ยืนยันได้แค่ว่าส่งไฟล์แล้ว
- ใช้ "ยังค้าง / ทำต่อ" สำหรับงานที่ยังต้องทำ ระบุเจ้าของงานและกำหนดส่งเท่าที่มีข้อมูล ถ้างานยกเลิกแล้วให้แสดงตามสถานะ และอย่านำกลับไปนับเป็นงานค้าง
- ใช้หัวข้อ *เสร็จแล้ว*, *ความคืบหน้า / ข้อตกลง*, *ยังค้าง / ทำต่อ*, *รอยืนยัน* และ *ไฟล์ / ลิงก์สำคัญ* เท่าที่มีข้อมูล ข้อละหนึ่งบรรทัดขึ้นต้นด้วย - ถ้าไม่มีอัปเดตงานให้บอกตรง ๆ
- ตอบเฉพาะเนื้อหารายงาน ใช้ตัวหนาแบบ WhatsApp (*ข้อความ*)`;

export async function summarizeDay(rows, { groupName, from, to, taskRows }) {
  const transcript = buildTranscript(rows, { includeTaskUpdates: true });
  const period = `${fmtDate(from)} ${fmtTime(from)}–${fmtTime(to)}`;
  const heading = `📋 *รายงานประจำวัน ${groupName}*\n${period}`;
  if (!transcript && !taskRows.length) {
    return `${heading}\n\nวันนี้ยังไม่มีอัปเดตงานในแชตที่บอทเก็บไว้หรือในรายการงานครับ`;
  }

  const taskData = taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    project: task.client_name,
    assignee: task.assignee_name,
    status: task.status,
    due: task.due_at ? `${fmtDate(task.due_at)} ${fmtTime(task.due_at)}` : null,
    closed: task.done_at ? fmtTime(task.done_at) : null,
    closedBy: task.done_by ?? null,
  }));
  const text = [
    `ชื่อกลุ่ม: ${groupName}\nช่วงเวลา: ${period}`,
    `<รายการงาน>\n${JSON.stringify(taskData)}\n</รายการงาน>`,
    `<แชตวันนี้>\n${transcript}\n</แชตวันนี้>`,
  ].join('\n\n');
  const body = (await ask({ system: DAILY_SYSTEM, text, effort: 'medium' }))?.trim();
  if (!body) throw new Error('AI ไม่ได้ส่งเนื้อหารายงานกลับมา');
  return `${heading}\n\n${body}`;
}
