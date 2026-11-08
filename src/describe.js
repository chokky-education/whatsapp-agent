import { ask } from './ai.js';
import { config } from './config.js';

const IMAGE_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM = `คุณช่วยทีมงานจดบันทึกว่าในแชทกลุ่มมีการส่งไฟล์อะไรบ้าง
บริบทของทีม: ${config.groupContext}

อธิบายไฟล์ที่ได้รับเป็นภาษาไทย 1-3 ประโยคสั้นๆ:
- ขึ้นต้นด้วยประเภท เช่น Render 3D, แบบแปลน, รูปด้าน, สเก็ตช์มือ, ภาพอ้างอิงสไตล์, โลโก้, ภาพหน้าจอ, รูปหน้างาน, เอกสาร/ใบเสนอราคา
- บอกสิ่งสำคัญที่เห็น: สไตล์ วัสดุ สี จำนวนชั้น ห้อง ตัวเลข/ขนาด หรือข้อความที่อ่านได้
- ถ้าเป็นภาพหน้าจอที่มีข้อความ error หรือข้อความสำคัญ ให้ยกข้อความนั้นมาสั้นๆ
- อย่าเดาเกินกว่าที่เห็น ไม่ต้องมีคำนำหรือคำลงท้าย`;

export function mimeForFile(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  return IMAGE_TYPES[ext] || null;
}

/** True when the AI can read this file type. */
export function canDescribe(mime) {
  return mime === 'application/pdf' || Object.values(IMAGE_TYPES).includes(mime);
}

/**
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {{ caption?: string|null, sender?: string, recentChat?: string }} ctx
 * @returns {Promise<string|null>} description, or null when the file can't be sent
 */
export async function describeMedia(buffer, mime, ctx = {}) {
  if (!canDescribe(mime)) return null;
  if (mime === 'application/pdf' && buffer.length > config.maxPdfBytes) return null;
  if (mime !== 'application/pdf' && buffer.length > MAX_IMAGE_BYTES) return null;

  const notes = [
    ctx.sender && `ผู้ส่ง: ${ctx.sender}`,
    ctx.caption && `คำบรรยายที่แนบมา: ${ctx.caption}`,
    ctx.recentChat && `ข้อความก่อนหน้าในกลุ่ม (ไว้ดูบริบท):\n${ctx.recentChat}`,
  ]
    .filter(Boolean)
    .join('\n');

  return ask({
    system: SYSTEM,
    effort: 'low',
    maxTokens: 2000,
    file: { mime, base64: buffer.toString('base64'), name: ctx.fileName },
    text: notes || 'อธิบายไฟล์นี้',
  });
}
