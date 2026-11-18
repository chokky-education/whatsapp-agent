#!/usr/bin/env node
// WhatsApp group summarizer bot.
// Logs in as a linked device (like WhatsApp Web), stores group messages in SQLite,
// has Claude describe images/PDFs as they arrive, and posts summaries on command or on a schedule.

import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  getContentType,
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
} from 'baileys';
import cron from 'node-cron';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { useAtomicAuthState } from './auth-state.js';
import * as db from './db.js';
import { describeMedia } from './describe.js';
import { summarize, summarizeDay } from './summarize.js';
import { explainError, hasCredentials, NO_KEY_MESSAGE, renderImage } from './ai.js';
import * as tasks from './tasks.js';
import * as render from './render.js';
import { INTRO } from './about.js';
import { telemetry, startTelemetry } from './telemetry.js';
import { createSerialQueue } from './serial-queue.js';
import { createWorkBridge, loadWorkPairing } from './work-bridge.js';


const logger = pino({ level: process.env.LOG_LEVEL || 'error' });
const log = (...a) => console.log(new Date().toLocaleTimeString('th-TH'), ...a);

fs.mkdirSync(config.mediaDir, { recursive: true });

/** @type {import('baileys').WASocket} */
let sock;
let connected = false;
let authFlush = async () => {};
let reconnectTimer = null;
let workBridge = null;
let workGroupJid = null;
const groupCache = new Map(); // jid -> metadata
const sentByBot = new Set(); // message ids the bot sent, so they never end up in a summary
// Serialize chat handlers and scheduled mutations so erasure cannot race an AI response.
const serialize = createSerialQueue({
  timeoutMs: 10 * 60_000,
  observe: () => telemetry.queue('main'),
  onStuck: async () => {
    telemetry.event('job_interrupted');
    log('งานค้างเกิน 10 นาที กำลังเริ่มบอทใหม่');
    await authFlush();
    process.exit(1); // launchd restarts; never run the next mutation concurrently
  },
});
const deletionRequests = new Map(); // one short-lived challenge per group
const pendingMedia = new Map(); // groupJid -> Set<Promise>

const HELP = `🤖 *วิธีใช้บอท*

*คุยกับบอท* — แท็ก @บอท หรือขึ้นต้นด้วย "บอท" แล้วพิมพ์เหมือนคุยกับคน เช่น
- บอท เพิ่มลูกค้า คุณสมชาย (บ้านลาดพร้าว) งบ 8 ล้าน เฟสออกแบบ
- บอท จำไว้ว่า บ้านลาดพร้าว เปลี่ยนกระเบื้องห้องน้ำเป็นสีเทาด้าน
- บอท พรุ่งนี้บ่าย 2 เตือน @Somchai ส่ง Render
- บอท ทุกวันจันทร์ 9 โมง เตือนทุกคนอัปเดตงาน
- บอท งาน #3 เสร็จแล้ว / เลื่อนงาน #3 เป็นศุกร์นี้
- บอท ลิงก์ Drive ล่าสุดอยู่ไหน / บ้านลาดพร้าวขอแก้อะไรบ้าง
- ส่งสเก็ต SketchUp พร้อมพิมพ์ "บอท เรนเดอร์ warm neutral" — ได้ภาพเหมือนจริง เฟอร์นิเจอร์ตรงตามสเก็ต
- ตอบกลับภาพเรนเดอร์ว่า "ไฟอุ่นขึ้น" — ปรับต่อจากภาพนั้น
- /ลบข้อมูล — แอดมินลบข้อมูลที่บอทเก็บของกลุ่มนี้ (ต้องยืนยัน)

*ตอบข้อความเตือน* — ตอบกลับว่า "เสร็จแล้ว" หรือกด ✅ เพื่อปิดงาน, "เลื่อน 1 ชม." เพื่อเลื่อน

*คำสั่ง*
- */ลูกค้า* — ดูรายชื่อลูกค้าทั้งหมด (สูงสุด ${config.maxClients} ราย) · */ลูกค้า ชื่อบ้าน* — ดูแฟ้มข้อมูลและงานค้างรายบ้าน
- */โน้ต 3* — ดูบันทึก #N3 (ฉบับปัจจุบัน) · */ที่มา 3* — ดูข้อความต้นทาง · */ประวัติโน้ต 3* — ดูประวัติการแก้ไข
- */แก้โน้ต 3 ข้อความใหม่* — แก้ไขบันทึก #N3 โดยเก็บประวัติเดิม
- */ลบโน้ต 3* — ลบบันทึก #N3 ในแฟ้มลูกค้า
- */งาน* — งานที่ยังเปิดอยู่ทั้งหมด
- */เสร็จ 3* — ปิดงาน #3 · */ยกเลิก 3* — ยกเลิกงาน #3
- */สรุป* — สรุปแชทตั้งแต่ครั้งล่าสุด · */สรุป 2 วัน* — ย้อนหลังตามช่วงเวลา
- */สถิติ* — งานที่ปิดได้ใน 7 วัน
- */แนะนำ* — บอทแนะนำตัว ทำอะไรได้ ข้อจำกัด และเรื่องข้อมูล
- */ช่วย* — แสดงข้อความนี้

บอทจดงานและอัปเดตแฟ้มลูกค้าจากแชทให้เอง และสรุปงานของวันนี้ให้ทุกเช้า`;

// ---------- helpers ----------

async function groupMeta(jid) {
  if (groupCache.has(jid)) return groupCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    groupCache.set(jid, meta);
    return meta;
  } catch {
    return null;
  }
}

function isWatched(name) {
  if (!config.watchGroups.length) return true;
  return config.watchGroups.some((g) => g.toLowerCase() === (name || '').toLowerCase());
}

function textOf(content, type) {
  const c = content?.[type];
  if (!c) return null;
  if (typeof c === 'string') return c;
  return c.text || c.caption || c.name || null;
}

const KIND = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  ptvMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  pollCreationMessage: 'text',
  pollCreationMessageV3: 'text',
  locationMessage: 'text',
  contactMessage: 'text',
};

// Swap "@66812345678" mentions for the person's name so Claude knows who is meant.
function resolveMentions(text, mentioned = []) {
  if (!text) return text;
  let out = text;
  for (const jid of mentioned) {
    const num = jid.split('@')[0].split(':')[0];
    const name = db.contactName(jidNormalizedUser(jid));
    if (name) out = out.replaceAll('@' + num, '@' + name);
  }
  return out;
}

function trackMedia(groupJid, promise) {
  if (!pendingMedia.has(groupJid)) pendingMedia.set(groupJid, new Set());
  const set = pendingMedia.get(groupJid);
  set.add(promise);
  promise.finally(() => set.delete(promise));
}

async function waitForMedia(groupJid, ms = 90_000) {
  const set = pendingMedia.get(groupJid);
  if (!set?.size) return;
  await Promise.race([Promise.allSettled([...set]), new Promise((r) => setTimeout(r, ms))]);
}

// Run image/PDF descriptions two at a time.
let running = 0;
const queue = [];
function enqueue(job) {
  const observation = telemetry.queue('media');
  return new Promise((resolve) => {
    queue.push(async () => {
      observation.start();
      try {
        resolve(await job());
      } catch (err) {
        log('อธิบายไฟล์ไม่สำเร็จ:', explainError(err));
        resolve(null);
      } finally { observation.end(); }
    });
    pump();
  });
}
function pump() {
  while (running < 2 && queue.length) {
    running++;
    queue.shift()().finally(() => {
      running--;
      pump();
    });
  }
}

async function send(jid, text, { mentions = [], taskId = null, reminderId = null, kind = null, quoted = null } = {}) {
  // Pick the id first: WhatsApp echoes our own message back before sendMessage returns,
  // and it must already be known as the bot's so it is never treated as a request.
  const messageId = generateMessageIDV2(sock.user?.id);
  sentByBot.add(messageId);
  db.recordBotMessage(messageId, jid, { taskId, reminderId, kind });
  try {
  const result = await sock.sendMessage(
    jid,
    { text, mentions: [...new Set(mentions.filter(Boolean))] },
    { messageId, ...(quoted ? { quoted } : {}) },
  );
  telemetry.sent();
  return result;
  } catch (err) { telemetry.event('send_error'); throw err; }
}

async function sendImage(jid, buffer, { caption = null, mentions = [], renderId = null, quoted = null } = {}) {
  const messageId = generateMessageIDV2(sock.user?.id);
  sentByBot.add(messageId);
  db.recordBotMessage(messageId, jid, { renderId, kind: 'render' });
  try {
  const result = await sock.sendMessage(
    jid,
    {
      image: buffer,
      caption: caption || undefined,
      mentions: [...new Set(mentions.filter(Boolean))],
    },
    { messageId, ...(quoted ? { quoted } : {}) },
  );
  telemetry.sent();
  return result;
  } catch (err) { telemetry.event('send_error'); throw err; }
}

// Background queue for architectural image generation so it never blocks chat or reminders.
let renderRunning = false;
const renderQueue = [];
// "บอท เรนเดอร์" without a sketch: wait a few minutes for that person's next image.
const renderWaits = new Map(); // `${groupJid}|${senderJid}` -> { instruction, until }
const RENDER_WAIT_MS = 10 * 60_000;
const RECENT_SKETCH_SECONDS = 30 * 60;

function enqueueRender(job) {
  job.observation = telemetry.queue('render');
  renderQueue.push(job);
  pumpRenders();
}

async function pumpRenders() {
  if (renderRunning || !renderQueue.length) return;
  renderRunning = true;
  const job = renderQueue.shift();
  job.observation.start();
  try {
    await executeRenderJob(job);
  } catch (err) {
    telemetry.event('render_error');
    log('เรนเดอร์ภาพไม่สำเร็จ:', explainError(err));
    await send(job.groupJid, `⚠️ เรนเดอร์ไม่สำเร็จ: ${explainError(err)}`, { quoted: job.quotedMsgRef || null }).catch(() => {});
  } finally {
    job.observation.end();
    renderRunning = false;
    pumpRenders();
  }
}

async function flushRenders(groupJid = null) {
  while (renderQueue.length || renderRunning) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Queue a render and tell the group it started. Refuses (never draws from text alone) when the
 * source image is missing, and enforces MAX_RENDERS_PER_DAY when it is above 0.
 * @param {{ groupJid: string, sourceMediaPath: string, sourceMsgId?: string|null, parentId?: number|null,
 *   instruction: string, isEdit: boolean, requestedBy: string, quotedMsgRef?: object|null }} job
 */
async function startRender(job) {
  if (!job.sourceMediaPath || !fs.existsSync(job.sourceMediaPath)) {
    return send(job.groupJid, '⚠️ เปิดรูปต้นทางไม่ได้ครับ ลองส่งสเก็ตใหม่อีกครั้ง', { quoted: job.quotedMsgRef || null, kind: 'reply' });
  }
  if (config.maxRendersPerDay > 0 && db.rendersCountSince(job.groupJid, tasks.localDayStartTs()) >= config.maxRendersPerDay) {
    return send(job.groupJid, `⚠️ วันนี้เรนเดอร์ครบ ${config.maxRendersPerDay} ภาพแล้วครับ`, { quoted: job.quotedMsgRef || null, kind: 'reply' });
  }
  enqueueRender(job);
  return send(job.groupJid, render.STARTED, { quoted: job.quotedMsgRef || null, kind: 'reply' });
}

/** The newest image this person sent in the last 30 minutes. */
function recentSketchFrom(groupJid, senderJid) {
  const nowTs = Math.floor(Date.now() / 1000);
  return db
    .getMessages(groupJid, nowTs - RECENT_SKETCH_SECONDS, nowTs)
    .filter((r) => r.kind === 'image' && r.sender_jid === senderJid && r.media_path && fs.existsSync(r.media_path))
    .pop() || null;
}

async function executeRenderJob(job) {
  if (job.groupJid && db.deletedThrough(job.groupJid) >= Math.floor(Date.now() / 1000)) return;

  // Pad to the model's canvas, then crop back: the result has the reference's framing and pixel size.
  const prep = await render.prepareSource(fs.readFileSync(job.sourceMediaPath));
  const res = await renderImage({
    prompt: render.buildRenderPrompt({ instruction: job.instruction, isEdit: job.isEdit }),
    sourceImage: { buffer: prep.buffer, mime: 'image/png', name: 'source.png' },
    quality: config.imageQuality,
    size: prep.size,
  });
  const output = await render.fitToSource(res.buffer, prep);

  const dir = path.join(config.mediaDir, job.groupJid.split('@')[0]);
  fs.mkdirSync(dir, { recursive: true });
  const outputMediaPath = path.join(dir, `render_${Date.now()}.png`);
  fs.writeFileSync(outputMediaPath, output);

  const renderId = db.addRender({
    groupJid: job.groupJid,
    parentId: job.parentId ?? null,
    sourceMsgId: job.sourceMsgId ?? null,
    sourceMediaPath: job.sourceMediaPath,
    outputMediaPath,
    prompt: job.instruction,
    model: res.model || config.openaiImageModel,
    createdBy: job.requestedBy,
  });

  await sendImage(job.groupJid, output, {
    caption: render.formatRenderCaption(job),
    renderId,
    quoted: job.quotedMsgRef || null,
  });
}

// ---------- people & addressing ----------

const userPart = (jid) => (jid || '').split('@')[0].split(':')[0];

function botIds() {
  const me = sock.user || {};
  return [me.id, me.lid].filter(Boolean).map(userPart);
}

function isAddressed(text, ctx) {
  if ((ctx?.mentionedJid || []).some((j) => botIds().includes(userPart(j)))) return true;
  const t = (text || '').trim().toLowerCase();
  return config.botNames.some((n) => {
    const name = n.toLowerCase();
    const rest = t.startsWith('@' + name) ? t.slice(name.length + 1) : t.startsWith(name) ? t.slice(name.length) : null;
    // "บอท พรุ่งนี้เตือน…" talks TO the bot; "บอทนี้เจ๋งดี" / "bot ตัวนี้…" talks ABOUT it.
    return rest !== null && !/^\s*(นี้|นี่|นั้น|นั่น|ตัว|เขา|มัน|ของ)/.test(rest) && !/^[a-z0-9]/i.test(rest);
  });
}

// "ai นี้เก็บข้อมูลไว้ไหน", "บอทนี้ทำอะไรได้บ้าง" — a question about the bot, even without a tag.
const ABOUT_BOT = /(บอท|\bbot\b|\bbotty\b|เอไอ|\bai\b)/i;
const QUESTION = /(\?|ไหม|มั้ย|มัย|หรอ|เหรอ|รึเปล่า|หรือเปล่า|อะไร|ยังไง|อย่างไร|ทำไม|เท่าไหร่|กี่|ที่ไหน|ใคร)/;
function isQuestionAboutBot(text) {
  return config.answerBotQuestions && ABOUT_BOT.test(text || '') && QUESTION.test(text || '');
}

function participantIds(meta) {
  return (meta?.participants || []).flatMap((p) => [p.id, p.lid, p.phoneNumber].filter(Boolean));
}

/** Names of people in the group that we know. */
function peopleIn(meta) {
  const names = new Set();
  for (const p of meta?.participants || []) {
    if ([p.id, p.lid].some((j) => botIds().includes(userPart(j)))) continue;
    const name = [p.id, p.lid, p.phoneNumber].map((j) => j && db.contactName(jidNormalizedUser(j))).find(Boolean);
    if (name) names.add(name);
  }
  return [...names];
}

/** A display name -> the jid to @mention in this group. */
function resolvePerson(meta, name) {
  let jids = db.jidsForName(name);
  if (!jids.length && name) {
    // Nickname / partial match against people in this group, e.g. "som" -> "Somchai".
    const n = name.replace(/^@/, '').trim().toLowerCase();
    const hit = peopleIn(meta).find((p) => p.toLowerCase().startsWith(n) || n.startsWith(p.toLowerCase()));
    if (hit) jids = db.jidsForName(hit);
  }
  if (!jids.length) return null;
  for (const p of meta?.participants || []) {
    const ids = [p.id, p.lid, p.phoneNumber].filter(Boolean).map(userPart);
    if (jids.some((j) => ids.includes(userPart(j)))) return p.id;
  }
  return null;
}

// Find tasks in normal chat a few minutes after the conversation goes quiet.
const syncTimers = new Map();
function scheduleTaskSync(groupJid) {
  if (!config.autoTasks) return;
  clearTimeout(syncTimers.get(groupJid));
  syncTimers.set(
    groupJid,
    setTimeout(() => serialize(async () => {
      syncTimers.delete(groupJid);
      try {
        await waitForMedia(groupJid);
        const meta = await groupMeta(groupJid);
        const result = await tasks.syncTasks(groupJid, peopleIn(meta), (n) => resolvePerson(meta, n));
        if (!result) return;
        if (result.added.length || result.completed.length || result.notesAdded?.length)
          log(`📌 ${meta?.subject}: งานใหม่ ${result.added.length}, ปิด ${result.completed.length}, โน้ตลูกค้า ${result.notesAdded?.length || 0}`);
        const notice = config.announceTasks && tasks.syncNotice(result);
        if (notice) await send(groupJid, notice, { kind: 'sync' });
      } catch (err) {
        log('จดงานอัตโนมัติไม่สำเร็จ:', explainError(err));
      }
    }), config.autoTaskQuietMinutes * 60_000),
  );
}

const DONE_WORDS = /^(✅|✔️|☑️|👍|เสร็จ|เรียบร้อย|ทำแล้ว|ส่งแล้ว|done|ok แล้ว)/i;

/**
 * Render requests are routed by code, not by the AI, so they always do the same thing:
 * - reply to a rendered image  -> edit that render with the reply text;
 * - "บอท เรนเดอร์ ..."          -> render the attached / quoted / recently sent sketch,
 *                                 or ask for one and start when it arrives.
 * Returns the send result when handled, otherwise null.
 */
async function handleRenderRequest(m, { groupJid, senderName, senderJid, cleaned, botMsg, quotedMsgId }) {
  const quotedRender = botMsg?.render_id ? db.getRender(botMsg.render_id) : null;
  if (quotedRender) {
    const instruction = cleaned.trim();
    if (!instruction) return send(groupJid, 'อยากปรับอะไรในภาพนี้ครับ เช่น "ไฟอุ่นขึ้น"', { quoted: m, kind: 'reply' });
    return startRender({
      groupJid,
      sourceMediaPath: quotedRender.output_media_path,
      parentId: quotedRender.id,
      instruction,
      isEdit: true,
      requestedBy: senderName,
      quotedMsgRef: m,
    });
  }
  if (!render.isRenderRequest(cleaned)) return null;

  const instruction = render.renderInstruction(cleaned);
  let quotedMsg = quotedMsgId ? db.getMessage(groupJid, quotedMsgId) : null;
  if (quotedMsg?.kind === 'image' && (!quotedMsg.media_path || !fs.existsSync(quotedMsg.media_path))) {
    await waitForMedia(groupJid, 10_000);
    quotedMsg = db.getMessage(groupJid, quotedMsgId);
  }
  const currentMsg = m?.key?.id ? db.getMessage(groupJid, m.key.id) : null;
  const source = [quotedMsg, currentMsg].find((r) => r?.kind === 'image' && r.media_path && fs.existsSync(r.media_path))
    || recentSketchFrom(groupJid, senderJid);
  if (!source) {
    renderWaits.set(`${groupJid}|${senderJid}`, { instruction, until: Date.now() + RENDER_WAIT_MS });
    return send(groupJid, render.ASK_FOR_SKETCH, { quoted: m, kind: 'reply' });
  }
  renderWaits.delete(`${groupJid}|${senderJid}`);
  return startRender({
    groupJid,
    sourceMediaPath: source.media_path,
    sourceMsgId: source.id,
    instruction,
    isEdit: false,
    requestedBy: senderName,
    quotedMsgRef: m,
  });
}

/** Someone talked to the bot (mention, its name, or a reply to one of its messages). */
async function handleRequest(m, { groupJid, meta, senderName, senderJid, text, botMsg, quotedText, quotedMsgId = null }) {
  const task = botMsg?.task_id ? db.getTask(botMsg.task_id) : null;
  const reminder = botMsg?.reminder_id ? db.getReminder(botMsg.reminder_id) : null;

  // Fast path: "เสร็จแล้ว" in reply to a reminder.
  if (botMsg && DONE_WORDS.test(text.trim())) {
    if (task && task.status === 'open') {
      db.setTaskStatus(task.id, 'done', senderName);
      return send(groupJid, `✅ ปิดงาน #${task.id}: ${task.title} — ขอบคุณครับ ${senderName}`, { quoted: m, taskId: task.id });
    }
    if (task) return send(groupJid, `👍 งาน #${task.id} ปิดไปแล้วครับ`, { quoted: m });
    if (reminder) {
      if (reminder.repeat === 'none') db.deactivateReminder(reminder.id);
      return send(groupJid, `👍 รับทราบครับ ${senderName}`, { quoted: m });
    }
  }

  const cleaned = config.botNames.reduce((t, n) => t.replace(new RegExp('^@?' + n + '[\\s,:]*', 'i'), ''), text.trim());
  if (/^(?:ลบข้อมูล|ล้างข้อมูล)(?:\s|ทั้งหมด|กลุ่มนี้|$)/.test(cleaned)) {
    return handleDeletion(groupJid, senderJid, '');
  }
  const handled = await handleRenderRequest(m, { groupJid, senderName, senderJid, cleaned, botMsg, quotedMsgId });
  if (handled) return handled;

  const res = await tasks.handleRequest({
    groupJid,
    senderName,
    senderJid,
    text: cleaned || text,
    messageId: m?.key?.id || null,
    quotedMsg: quotedMsgId ? db.getMessage(groupJid, quotedMsgId) : null, // note provenance
    quoted: botMsg ? { text: quotedText, task, reminder } : quotedText ? { text: quotedText, task: null, reminder: null } : null,
    people: peopleIn(meta),
    resolve: (n) => resolvePerson(meta, n),
  });
  return send(groupJid, res.text, { mentions: res.mentions, quoted: m, kind: 'reply' });
}

// Save media file to disk immediately so requests and commands can access it right away.
async function saveIncomingMedia(m, { groupJid, kind, mime }) {
  const id = m?.key?.id;
  if (!id) return null;
  const ext = kind === 'image' ? (mime.split('/')[1] || 'jpg').split(';')[0] : 'pdf';
  const dir = path.join(config.mediaDir, groupJid.split('@')[0]);
  const defaultFile = path.join(dir, `${id}.${ext}`);
  const existing = db.getMessage(groupJid, id);
  if (existing?.media_path && fs.existsSync(existing.media_path)) return existing.media_path;
  if (fs.existsSync(defaultFile)) {
    db.setMediaPath(id, defaultFile);
    return defaultFile;
  }

  try {
    const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock?.updateMediaMessage });
    if (!buffer) return null;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(defaultFile, buffer);
    db.setMediaPath(id, defaultFile);
    return defaultFile;
  } catch (err) {
    log('ดาวน์โหลดรูป/ไฟล์ทันทีไม่สำเร็จ:', explainError(err));
    return null;
  }
}

// Download an image/PDF and let the AI describe it (two at a time).
function describeLater(m, { groupJid, groupName, senderName, ts, kind, mime, text }) {
  const id = m.key.id;
  const job = enqueue(async () => {
    const ext = kind === 'image' ? (mime.split('/')[1] || 'jpg').split(';')[0] : 'pdf';
    const dir = path.join(config.mediaDir, groupJid.split('@')[0]);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.${ext}`);
    let buffer;
    if (fs.existsSync(file)) {
      buffer = fs.readFileSync(file);
    } else {
      buffer = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      fs.writeFileSync(file, buffer);
      db.setMediaPath(id, file);
    }

    const recentChat = db
      .getMessages(groupJid, ts - 3600, ts)
      .filter((r) => r.kind === 'text' && r.id !== id)
      .slice(-6)
      .map((r) => `${r.sender_name}: ${r.text}`)
      .join('\n');
    const desc = await describeMedia(buffer, kind === 'image' ? mime.split(';')[0] : 'application/pdf', {
      caption: text,
      sender: senderName,
      recentChat,
    });
    db.setMediaMsg(id, null);
    if (desc) {
      db.setMediaDesc(id, desc);
      log(`🖼️  ${groupName} / ${senderName}: ${desc.slice(0, 80)}`);
    }
  });
  trackMedia(groupJid, job);
}

/**
 * Should an incoming message get a reply?
 * "notify" = arrived live. "append" = sent by this account from the phone, or delivered late
 * because the bot was offline; late ones from the last OFFLINE_REPLY_HOURS still get answered.
 */
function upsertFlags(type, m) {
  const age = Date.now() / 1000 - Number(m.messageTimestamp || 0);
  const fresh = age < 120;
  const late = type === 'append' && !m.key?.fromMe && !fresh && age < config.offlineReplyHours * 3600;
  return { live: type === 'notify' || (type === 'append' && fresh) || late, late };
}

// A command/request sent while the bot was offline: say why the answer is late.
async function handleLateNotice(m, groupJid, ts, text, ctx) {
  const botMsg = ctx?.stanzaId ? db.botMessage(ctx.stanzaId) : null;
  const forBot = text && (text.startsWith('/') || botMsg || isAddressed(text, ctx) || isQuestionAboutBot(text));
  if (!forBot) return;
  await send(groupJid, `⏳ ขอโทษที่ตอบช้าครับ ตอนที่ส่งข้อความนี้ (${tasks.fmtWhen(ts)}) บอทออฟไลน์อยู่`, { quoted: m, kind: 'late' }).catch(() => {});
}

// ---------- incoming messages ----------

function handleMessage(m, flags) {
  return serialize(() => processMessage(m, flags));
}

async function processMessage(m, { live, late = false }) {
  const groupJid = m.key?.remoteJid;
  if (!groupJid || !isJidGroup(groupJid) || !m.message) return;

  const meta = await groupMeta(groupJid);
  const groupName = meta?.subject || groupJid;
  if (!isWatched(groupName)) return;

  const content = normalizeMessageContent(m.message);
  const type = getContentType(content);
  const kind = KIND[type];
  if (!kind) return; // reactions, protocol messages, edits, etc.

  const senderJid = m.key.fromMe
    ? jidNormalizedUser(sock.user?.id)
    : jidNormalizedUser(m.key.participant || m.participant || '');
  const senderAlt = m.key.participantAlt ? jidNormalizedUser(m.key.participantAlt) : null;
  const senderName = m.key.fromMe
    ? config.myName || sock.user?.name || 'ฉัน'
    : m.pushName || db.contactName(senderJid) || db.contactName(senderAlt) || senderJid.split('@')[0];
  if (m.pushName) {
    db.rememberContact(senderJid, m.pushName);
    db.rememberContact(senderAlt, m.pushName);
  }

  const ctx = content[type]?.contextInfo;
  let text = textOf(content, type);
  if (type === 'locationMessage') text = `[ตำแหน่ง] ${content.locationMessage.name || ''} ${content.locationMessage.address || ''}`.trim();
  if (type === 'contactMessage') text = `[นามบัตร] ${content.contactMessage.displayName || ''}`;
  if (type.startsWith('pollCreation')) {
    const p = content[type];
    text = `[โพล] ${p.name}: ${(p.options || []).map((o) => o.optionName).join(' / ')}`;
  }
  text = resolveMentions(text, ctx?.mentionedJid);

  const quoted = ctx?.quotedMessage ? normalizeMessageContent(ctx.quotedMessage) : null;
  const quotedText = quoted ? textOf(quoted, getContentType(quoted)) : null;

  const id = m.key.id;
  const ts = Number(m.messageTimestamp) || Math.floor(Date.now() / 1000);
  if (ts <= db.deletedThrough(groupJid)) return;
  const fromBot =
    sentByBot.has(id) || Boolean(db.botMessage(id)) || (m.key.fromMe && /^(📋|🤖|⏰|📌|☀️|✅|💤|📅|🗑️|↩️|⚠️|🏗️|🏠|🗂️|📦)/u.test(text || ''));

  const isNew = db.saveMessage({
    id,
    groupJid,
    groupName,
    senderJid,
    senderName,
    ts,
    kind,
    text,
    fileName: content.documentMessage?.fileName || null,
    quotedText,
    fromBot,
  });

  // Images and PDFs: download, keep a copy, and let Claude describe them.
  const mime = content[type]?.mimetype || '';
  const describable = kind === 'image' || (kind === 'document' && mime === 'application/pdf');
  const recent = ts > Date.now() / 1000 - 3 * 86400; // don't burn tokens on old history
  if (isNew && describable && recent) {
    await saveIncomingMedia(m, { groupJid, kind, mime });
    if (config.describeMedia) {
      db.setMediaMsg(id, JSON.stringify(m, BufferJSON.replacer)); // lets a restart retry it
      describeLater(m, { groupJid, groupName, senderName, ts, kind, mime, text });
    }
  }

  if (!live || fromBot || !isNew) return;
  if (late) await handleLateNotice(m, groupJid, ts, text, ctx);

  // The sketch someone was asked for after "บอท เรนเดอร์" with nothing attached.
  const waitKey = `${groupJid}|${senderJid}`;
  const wait = kind === 'image' ? renderWaits.get(waitKey) : null;
  if (wait) {
    renderWaits.delete(waitKey);
    if (wait.until > Date.now() && !(text && isAddressed(text, ctx))) {
      return startRender({
        groupJid,
        sourceMediaPath: db.getMessage(groupJid, id)?.media_path,
        sourceMsgId: id,
        instruction: [wait.instruction, text].filter(Boolean).join(' '),
        isEdit: false,
        requestedBy: senderName,
        quotedMsgRef: m,
      });
    }
  }

  if (text?.startsWith('/')) {
    await handleCommand(groupJid, groupName, text.trim(), { m, meta, senderName, senderJid }).catch((err) =>
      send(groupJid, `🤖 ทำไม่สำเร็จ: ${explainError(err)}`),
    );
    return;
  }

  const botMsg = ctx?.stanzaId ? db.botMessage(ctx.stanzaId) : null;
  if (text && (botMsg || isAddressed(text, ctx) || isQuestionAboutBot(text))) {
    db.markToBot(id);
    await handleRequest(m, { groupJid, meta, senderName, senderJid, text, botMsg, quotedText, quotedMsgId: ctx?.stanzaId || null }).catch((err) =>
      send(groupJid, `🤖 ทำไม่สำเร็จ: ${explainError(err)}`),
    );
    return;
  }

  scheduleTaskSync(groupJid);
}

// ✅ on a bot message about a task closes the task.
async function handleReactions(events) {
  for (const { key, reaction } of events) {
    try {
      const botMsg = db.botMessage(key?.id);
      if (!/^(✅|✔️|☑️|👍)/u.test(reaction?.text || '')) continue;
      const task = botMsg?.task_id ? db.getTask(botMsg.task_id) : null;
      if (!task || task.status !== 'open') continue;
      const who = db.contactName(jidNormalizedUser(reaction.key?.participant || '')) || 'ทีม';
      db.setTaskStatus(task.id, 'done', who);
      await send(botMsg.group_jid, `✅ ปิดงาน #${task.id}: ${task.title} — ขอบคุณครับ ${who}`, { taskId: task.id });
    } catch (err) {
      log('อ่านรีแอ็กชันไม่สำเร็จ:', err.message);
    }
  }
}

// ---------- commands ----------

function parseRange(arg) {
  const m = arg.match(/(\d+)\s*(ชม|ชั่วโมง|h|hr|hour|วัน|d|day)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const hours = /^(วัน|d|day)/i.test(m[2]) ? n * 24 : n;
  return hours * 3600;
}

async function handleCommand(groupJid, groupName, text, { m, meta, senderName, senderJid } = {}) {
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  const now = Math.floor(Date.now() / 1000);

  if (cmd === '/ลบข้อมูล') return handleDeletion(groupJid, senderJid, arg);

  if (['/ช่วย', '/help'].includes(cmd)) return send(groupJid, HELP);

  if (['/แนะนำ', '/about', '/intro'].includes(cmd)) return send(groupJid, INTRO, { kind: 'intro' });

  if (['/ลูกค้า', '/client', '/clients'].includes(cmd)) {
    if (!arg) return send(groupJid, tasks.formatClientList(groupJid), { kind: 'clients' });
    if (/^(เพิ่ม|add)\s+/i.test(arg)) {
      return handleRequest(m, {
        groupJid,
        meta,
        senderName,
        senderJid,
        text: 'เพิ่มลูกค้า ' + arg.replace(/^(เพิ่ม|add)\s+/i, ''),
        botMsg: null,
        quotedText: null,
      });
    }
    return send(groupJid, tasks.formatClientDossier(groupJid, arg), { kind: 'client' });
  }

  if (['/โน้ต', '/note'].includes(cmd)) {
    const id = Number((arg.match(/\d+/) || [])[0]);
    return send(groupJid, tasks.formatClientNote(groupJid, id), { kind: 'note' });
  }

  if (['/ที่มา', '/source'].includes(cmd)) {
    const id = Number((arg.match(/\d+/) || [])[0]);
    return send(groupJid, tasks.formatNoteSources(groupJid, id), { kind: 'source' });
  }

  if (['/ประวัติโน้ต', '/history'].includes(cmd)) {
    const id = Number((arg.match(/\d+/) || [])[0]);
    return send(groupJid, tasks.formatNoteHistory(groupJid, id), { kind: 'history' });
  }

  if (['/แก้โน้ต', '/editnote'].includes(cmd)) {
    const mArg = arg.match(/^#?n?(\d+)\s+(.+)$/is);
    if (!mArg) return send(groupJid, '🤖 พิมพ์เลขโน้ตตามด้วยข้อความใหม่ เช่น /แก้โน้ต 12 กระเบื้องสีเทาด้าน');
    const noteId = Number(mArg[1]);
    const res = db.editClientNote(noteId, {
      groupJid,
      text: mArg[2].trim(),
      updatedBy: senderName,
      kind: 'correction',
      sourceMessageIds: [m?.key?.id].filter(Boolean),
    });
    if (!res.ok) return send(groupJid, '🤖 ไม่พบบันทึกเลขนี้ ดูเลข #N ได้ด้วย /ลูกค้า ชื่อบ้าน');
    const c = db.getClient(res.note.client_id);
    return send(
      groupJid,
      `✏️ แก้ไขบันทึก #N${res.note.id} (ฉบับที่ ${res.revisionNo}) ของ *${c?.name || '-'}* [${tasks.CATEGORY_LABEL[res.note.category] || res.note.category}]: ${res.note.text}`,
    );
  }

  if (['/ลบโน้ต', '/delnote'].includes(cmd)) {
    const id = Number((arg.match(/\d+/) || [])[0]);
    const note = id ? db.getClientNote(id) : null;
    if (!note || note.group_jid !== groupJid) return send(groupJid, '🤖 ไม่พบบันทึกเลขนี้ ดูเลข #N ได้ด้วย /ลูกค้า ชื่อบ้าน');
    db.deleteClientNote(note.id, groupJid);
    return send(groupJid, `🗑️ ลบบันทึก #N${note.id}: ${note.text}`);
  }

  if (['/เรนเดอร์', '/render', '/renders'].includes(cmd)) {
    const today = db.rendersCountSince(groupJid, tasks.localDayStartTs());
    const week = db.rendersCountSince(groupJid, now - 7 * 86400);
    return send(
      groupJid,
      `🎨 *เรนเดอร์ภาพ*\nส่งสเก็ตพร้อมพิมพ์ "บอท เรนเดอร์ [สไตล์]" แล้วตอบกลับภาพที่ได้เพื่อสั่งปรับ\nใช้ไปแล้ว: วันนี้ ${today} ภาพ · 7 วัน ${week} ภาพ`,
      { kind: 'renders' },
    );
  }

  if (['/งาน', '/task'].includes(cmd)) return send(groupJid, tasks.formatTaskList(groupJid), { kind: 'list' });

  if (['/เสร็จ', '/done', '/ยกเลิก', '/cancel'].includes(cmd)) {
    if (['/ยกเลิก', '/cancel'].includes(cmd) && /^#?n\d+/i.test(arg.trim())) {
      const noteId = Number(arg.match(/\d+/)[0]);
      const note = noteId ? db.getClientNote(noteId) : null;
      if (!note || note.group_jid !== groupJid) return send(groupJid, '🤖 ไม่พบบันทึกเลขนี้ ดูเลข #N ได้ด้วย /ลูกค้า ชื่อบ้าน');
      db.deleteClientNote(note.id);
      return send(groupJid, `🗑️ ลบบันทึก #N${note.id}: ${note.text}`);
    }
    const id = Number((arg.match(/\d+/) || [])[0]);
    const task = id ? db.getTask(id) : null;
    if (!task || task.group_jid !== groupJid) return send(groupJid, '🤖 ไม่พบงานเลขนี้ ดูเลขงานได้ด้วย /งาน');
    const done = ['/เสร็จ', '/done'].includes(cmd);
    db.setTaskStatus(task.id, done ? 'done' : 'cancelled', senderName);
    return send(groupJid, `${done ? '✅ ปิดงาน' : '🗑️ ยกเลิกงาน'} #${task.id}: ${task.title}`, { taskId: task.id });
  }

  if (['/เตือน', '/remind'].includes(cmd)) {
    if (!arg) return send(groupJid, '🤖 พิมพ์ต่อท้ายว่าจะให้เตือนอะไร เมื่อไหร่ เช่น /เตือน พรุ่งนี้ 9 โมง @Somchai ส่งแบบ');
    return handleRequest(m, { groupJid, meta, senderName, senderJid, text: 'เตือน ' + arg, botMsg: null, quotedText: null });
  }

  if (['/สถิติ', '/stats'].includes(cmd)) {
    const s = db.taskStats(groupJid, now - 7 * 86400);
    const avgH = s.avg_seconds_to_done ? (s.avg_seconds_to_done / 3600).toFixed(1) : '-';
    const pct = s.created ? Math.round(((s.done || 0) / s.created) * 100) : 0;
    return send(
      groupJid,
      `📊 *7 วันล่าสุด*\n- งานใหม่ ${s.created} งาน\n- ปิดแล้ว ${s.done || 0} (${pct}%)\n- ยังเปิด ${s.open || 0} · เลยกำหนด ${s.overdue || 0}\n- เวลาเฉลี่ยจากเปิดถึงปิด ${avgH} ชม.`,
    );
  }

  if (['/สรุป', '/summary', '/sum'].includes(cmd)) {
    const range = parseRange(arg);
    const from = range ? now - range : db.lastSummaryEnd(groupJid) ?? now - 86400;
    await send(groupJid, '🤖 กำลังสรุป...');
    await waitForMedia(groupJid);
    const rows = db.getMessages(groupJid, from + (range ? 0 : 1), now);
    if (!rows.length) return send(groupJid, '🤖 ยังไม่มีข้อความใหม่ให้สรุป');
    const summary = await summarize(rows, {
      groupName,
      previousSummary: range ? null : db.lastSummaryText(groupJid),
    });
    if (!range) db.saveSummary(groupJid, from, rows[rows.length - 1].ts, summary);
    return send(groupJid, summary);
  }

  if (['/งานค้าง', '/tasks', '/todo'].includes(cmd)) {
    await send(groupJid, '🤖 กำลังดูงานค้าง...');
    await waitForMedia(groupJid);
    const rows = db.getMessages(groupJid, now - 7 * 86400, now);
    if (!rows.length) return send(groupJid, '🤖 ไม่มีข้อความใน 7 วันล่าสุด');
    const summary = await summarize(rows, {
      groupName,
      previousSummary: db.lastSummaryText(groupJid),
      focus: 'tasks',
    });
    return send(groupJid, summary);
  }
}


// Deletion never goes through AI. Re-fetch membership at BOTH challenge and confirmation.
async function handleDeletion(groupJid, senderJid, arg) {
  let meta;
  try { meta = await sock.groupMetadata(groupJid); } catch {}
  const member = meta?.participants?.find((p) => [p.id, p.lid, p.phoneNumber]
    .filter(Boolean).some((j) => jidNormalizedUser(j) === senderJid));
  if (!member || !['admin', 'superadmin'].includes(member.admin)) {
    return send(groupJid, '🤖 เฉพาะแอดมินกลุ่มเท่านั้นที่สั่งลบข้อมูลได้ครับ');
  }
  if (arg === 'ยกเลิก') {
    if (deletionRequests.get(groupJid)?.senderJid === senderJid) deletionRequests.delete(groupJid);
    return send(groupJid, '🤖 ยกเลิกคำขอลบข้อมูลแล้วครับ');
  }
  if (!arg) {
    const token = randomBytes(4).toString('hex');
    deletionRequests.set(groupJid, { senderJid, token, expires: Date.now() + 5 * 60_000 });
    const workNote = groupJid === workGroupJid ? '\nจะล้างรายการงานที่ซิงก์ไว้ใน Warroom ด้วยครับ' : '';
    return send(groupJid, `🗑️ จะลบแชท สรุป งาน การเตือน แฟ้มลูกค้า และไฟล์รูป/PDF ที่บอทเก็บของกลุ่มนี้ ย้อนคืนไม่ได้ครับ${workNote}\nไม่ได้ลบข้อความใน WhatsApp หรือไฟล์บน Drive และไม่รวมไฟล์ export/สำเนาภายนอก\nแอดมินคนเดิมพิมพ์ /ลบข้อมูล ยืนยัน ${token} ภายใน 5 นาที หรือ /ลบข้อมูล ยกเลิก\nหลังลบ บอทยังเก็บข้อความใหม่ตามปกติครับ`);
  }
  const pending = deletionRequests.get(groupJid);
  if (!pending || pending.senderJid !== senderJid || pending.expires < Date.now() || arg !== `ยืนยัน ${pending.token}`) {
    return send(groupJid, '🤖 รหัสยืนยันไม่ถูกต้องหรือหมดอายุ ให้เริ่มด้วย /ลบข้อมูล ใหม่ครับ');
  }
  clearTimeout(syncTimers.get(groupJid));
  syncTimers.delete(groupJid);
  // Drain downloads too: otherwise a queued download could recreate an erased file.
  await Promise.allSettled([...(pendingMedia.get(groupJid) || [])]);
  await flushRenders(groupJid);
  const dir = path.resolve(config.mediaDir, groupJid.split('@')[0]);
  if (path.dirname(dir) !== path.resolve(config.mediaDir)) throw new Error('โฟลเดอร์ไฟล์ไม่ถูกต้อง');
  fs.rmSync(dir, { recursive: true, force: true });
  const count = db.deleteGroupData(groupJid, Math.floor(Date.now() / 1000));
  deletionRequests.delete(groupJid);
  const purged = await workBridge?.purge(groupJid);
  const workNote = purged === true
    ? '\nล้างรายการงานบน Warroom แล้วครับ'
    : purged === false ? '\nลบจากเครื่องแล้ว รายการงานบน Warroom ยังรอล้าง บอทจะลองส่งคำขอล้างอีกครั้งครับ' : '';
  return send(groupJid, `🗑️ ลบข้อมูลที่บอทเก็บของกลุ่มนี้แล้วครับ (${count} ข้อความ พร้อมสรุป งาน การเตือน แฟ้มลูกค้า และรูป/PDF)${workNote}\nข้อความใหม่หลังจากนี้ยังเก็บตามปกติครับ`);
}

// ---------- scheduled summary ----------

async function scheduledSummary(now = tasks.nowTs()) {
  if (!connected) return;
  const today = tasks.localDay(now);
  const from = tasks.localDayStartTs(now);
  for (const g of db.knownGroups()) {
    const name = groupCache.get(g.group_jid)?.subject || g.group_name;
    if (!connected) return;
    if (!isWatched(name) || db.dayMarker(g.group_jid, 'last_summary_day') === today) continue;
    try {
      await waitForMedia(g.group_jid);
      const rows = db.getMessages(g.group_jid, from, now);
      const taskRows = [...db.openTasks(g.group_jid), ...db.closedTasksBetween(g.group_jid, from, now)];
      const summary = await summarizeDay(rows, { groupName: name, from, to: now, taskRows });
      const target =
        config.summaryTarget === 'owner' && config.ownerNumber
          ? `${config.ownerNumber}@s.whatsapp.net`
          : g.group_jid;
      if (!connected) return;
      const sent = await send(target, summary, { kind: 'daily_summary' });
      if (!sent?.key?.id) throw new Error('WhatsApp ไม่ส่งสถานะตอบกลับ');
      db.recordDailySummary(g.group_jid, today, from, rows.at(-1)?.ts ?? null, summary);
      log(`📋 ส่งรายงานประจำวันแล้ว (${rows.length} ข้อความ)`);
    } catch (err) {
      log('ส่งรายงานประจำวันไม่สำเร็จ:', explainError(err));
    }
  }
}

// ---------- connection ----------

async function start() {
  connected = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close();
    } catch {}
  }
  telemetry.connection('starting');
  // A socket that never reaches open or close must not leave a live but inert bot.
  const connectTimer = setTimeout(async () => {
    log('เชื่อมต่อ WhatsApp ค้างเกิน 2 นาที กำลังเริ่มบอทใหม่');
    await authFlush();
    process.exit(1);
  }, 2 * 60_000);
  connectTimer.unref();
  const { state, saveCreds, flush } = await useAtomicAuthState(config.authDir);
  authFlush = flush;
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  let pairingRequested = false;

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    cachedGroupMetadata: async (jid) => groupCache.get(jid),
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  // Learn people's names (history messages only carry a number).
  const learnContacts = (contacts = []) => {
    for (const c of contacts) {
      const name = c.notify || c.name || c.verifiedName;
      if (!name) continue;
      for (const jid of [c.id, c.lid, c.phoneNumber]) if (jid) db.rememberContact(jidNormalizedUser(jid), name);
    }
  };
  sock.ev.on('contacts.upsert', learnContacts);
  sock.ev.on('contacts.update', learnContacts);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      telemetry.connection('pairing');
      clearTimeout(connectTimer); // pairing needs a person, not repeated restarts
      if (config.pairingNumber && !pairingRequested) {
        pairingRequested = true;
        const code = await sock.requestPairingCode(config.pairingNumber);
        log(`\nรหัสจับคู่: ${code}\nเปิด WhatsApp บนมือถือ > อุปกรณ์ที่ลิงก์ > ลิงก์อุปกรณ์ > ลิงก์ด้วยหมายเลขโทรศัพท์แทน แล้วใส่รหัสนี้\n`);
      } else if (!config.pairingNumber) {
        log('สแกน QR นี้ด้วย WhatsApp บนมือถือ (อุปกรณ์ที่ลิงก์ > ลิงก์อุปกรณ์):');
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === 'open') {
      connected = true;
      workBridge?.invalidate();
      void workBridge?.tick();
      telemetry.connection('connected');
      clearTimeout(connectTimer);
      log(`✅ เชื่อมต่อแล้วในชื่อ ${sock.user?.name || sock.user?.id}`);
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) groupCache.set(jid, meta);
        const names = Object.values(groups).map((g) => g.subject);
        log(`กลุ่มที่บอทอยู่: ${names.join(', ') || '(ยังไม่มี)'}`);
        if (config.watchGroups.length) {
          const missing = config.watchGroups.filter((w) => !names.some((n) => n.toLowerCase() === w.toLowerCase()));
          if (missing.length) log(`⚠️  ไม่พบกลุ่มใน WATCH_GROUPS: ${missing.join(', ')}`);
        }
      } catch (err) {
        log('ดึงรายชื่อกลุ่มไม่ได้:', err.message);
      }
      setTimeout(() => serialize(catchUp).catch((e) => log(e.message)), 15_000);
    }
    if (connection === 'close') {
      connected = false;
      workBridge?.invalidate();
      void workBridge?.tick();
      telemetry.connection('disconnected');
      clearTimeout(connectTimer);
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.connectionReplaced) {
        telemetry.connection('replaced');
        log('❌ มีบอทอีกตัวใช้เบอร์นี้อยู่ (เปิดซ้ำ 2 ที่) ตัวนี้จะหยุดทำงาน');
        process.exit(1);
      }
      if (code === DisconnectReason.loggedOut) {
        telemetry.connection('logged_out');
        log('❌ ถูกออกจากระบบ ลบโฟลเดอร์ data/auth แล้วรันใหม่เพื่อสแกน QR อีกครั้ง');
        process.exit(1);
      }
      log(`การเชื่อมต่อหลุด (${code ?? 'unknown'}) กำลังต่อใหม่...`);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => start().catch((err) => {
        log('เริ่มการเชื่อมต่อใหม่ไม่สำเร็จ:', err.message);
        process.exit(1);
      }), code === DisconnectReason.restartRequired ? 0 : 3000);
    }
  });

  sock.ev.on('groups.update', async (updates) => {
    if (updates.some(({ id }) => id === workGroupJid)) {
      workBridge?.invalidate();
      void workBridge?.tick();
    }
    for (const u of updates) {
      groupCache.delete(u.id);
      await groupMeta(u.id);
    }
  });
  sock.ev.on('group-participants.update', async (e) => {
    workBridge?.participantsChanged(e);
    groupCache.delete(e.id);
    await groupMeta(e.id);
  });

  sock.ev.on('messages.update', updates => {
    for (const { key, update } of updates) {
      // Baileys delivery/read ACKs; do not transmit message IDs or recipients.
      if (key?.fromMe && db.botMessage(key.id) && [3, 4, 5].includes(update?.status)) telemetry.delivered();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      if (type === 'notify' && !m.key?.fromMe && isJidGroup(m.key?.remoteJid || '') && m.message) telemetry.inbound();
      await handleMessage(m, upsertFlags(type, m)).catch((err) => log('อ่านข้อความไม่สำเร็จ:', err.message));
    }
  });

  sock.ev.on('messages.reaction', (events) => serialize(() => handleReactions(events)).catch((e) => log(e.message)));

  sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
    learnContacts(contacts);
    for (const m of messages || []) {
      await handleMessage(m, { live: false }).catch(() => {});
    }
  });
}

function fireReminders() {
  return tasks.fireDueReminders(async (r, task) => {
      await send(r.group_jid, tasks.reminderText(r, task), {
        mentions: r.target_jid ? [r.target_jid] : [],
        taskId: task?.id ?? null,
        reminderId: r.id,
        kind: 'reminder',
      });
      log(`⏰ เตือน R${r.id}: ${r.text}`);
  });
}

async function sendBriefings() {
  for (const g of db.knownGroups()) {
    const name = groupCache.get(g.group_jid)?.subject || g.group_name;
    if (!isWatched(name)) continue;
    const text = tasks.briefing(g.group_jid, name);
    if (text) await send(g.group_jid, text, { kind: 'briefing' }).catch((e) => log('ส่งสรุปเช้าไม่สำเร็จ:', e.message));
    db.setDayMarker(g.group_jid, 'last_briefing_day', tasks.localDay());
  }
}

/** "M H * * *" -> minutes after midnight, or null for anything fancier. */
function dailyCronMinutes(expr) {
  const m = (expr || '').trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  return m ? Number(m[2]) * 60 + Number(m[1]) : null;
}

async function retryScheduledSummary(now = tasks.nowTs()) {
  const scheduledAt = dailyCronMinutes(config.summaryCron);
  const minutes = tasks.localMinutes(now);
  if (scheduledAt != null && minutes > scheduledAt && minutes < 23 * 60) {
    await scheduledSummary(now);
  }
}

// After a restart: do what was missed while the bot was off.
let catchingUp = false;
async function catchUp() {
  if (catchingUp) return;
  catchingUp = true;
  try {
    const today = tasks.localDay();
    const nowMin = tasks.localMinutes();
    const groups = db.knownGroups().filter((g) => isWatched(groupCache.get(g.group_jid)?.subject || g.group_name));

    // Morning briefing missed today (only until noon, after that it's stale).
    const bMin = dailyCronMinutes(config.briefingCron);
    if (bMin != null && nowMin > bMin && nowMin < 12 * 60 && groups.some((g) => db.dayMarker(g.group_jid, 'last_briefing_day') !== today)) {
      log('☀️ ส่งสรุปเช้าที่พลาดไป');
      await sendBriefings();
    }
    // Evening report missed today (until 23:00).
    await retryScheduledSummary();
    // Overdue reminders go out now (marked as late).
    await fireReminders();
    // Images/PDFs whose description was cut off.
    for (const row of db.pendingMedia()) {
      try {
        const m = JSON.parse(row.media_msg, BufferJSON.reviver);
        const content = normalizeMessageContent(m.message);
        const type = getContentType(content);
        describeLater(m, {
          groupJid: row.group_jid,
          groupName: row.group_name,
          senderName: row.sender_name,
          ts: row.ts,
          kind: row.kind,
          mime: content?.[type]?.mimetype || (row.kind === 'image' ? 'image/jpeg' : 'application/pdf'),
          text: row.text,
        });
      } catch (err) {
        db.setMediaMsg(row.id, null);
      }
    }
    // Messages that arrived while off still need to be checked for tasks.
    for (const g of groups) if (db.messagesAfterRow(g.group_jid, db.lastTaskRow(g.group_jid)).length) scheduleTaskSync(g.group_jid);
  } catch (err) {
    log('ทำงานที่ค้างไม่สำเร็จ:', err.message);
  } finally {
    catchingUp = false;
  }
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']);
function isNetworkError(err) {
  const code = err?.cause?.code || err?.code;
  return NETWORK_CODES.has(code) || (err?.name === 'TypeError' && err?.message === 'terminated');
}

function main() {
  if (!hasCredentials()) {
    console.error(NO_KEY_MESSAGE);
    process.exit(1);
  }
  // Only one copy may run: two copies on one WhatsApp login knock each other off forever.
  const lock = path.join(config.dataDir, 'bot.pid');
  try {
    const other = Number(fs.readFileSync(lock, 'utf8'));
    if (other && other !== process.pid) {
      process.kill(other, 0); // throws if that process is gone
      console.error(`บอทเปิดอยู่แล้ว (PID ${other}) — ปิดตัวเดิมก่อน หรือรัน npm run autostart -- status`);
      process.exit(1);
    }
  } catch {}
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(lock, String(process.pid));
  const unlock = () => {
    try {
      if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock);
    } catch {}
  };
  process.on('exit', unlock);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  // A dropped connection inside a media/API download stream used to surface as an unhandled
  // 'error' event and kill the process, losing the message being handled (seen 2026-11-09).
  // Survive network errors only; anything else still crashes so launchd restarts us clean.
  process.on('uncaughtException', (err) => {
    if (isNetworkError(err)) return log('เครือข่ายสะดุด (ทำงานต่อ):', err.cause?.code || err.code || err.message);
    console.error(err);
    process.exit(1);
  });
  const provider = config.provider === 'openai' ? 'openai' : 'anthropic';
  const primaryModel = provider === 'openai' ? config.openaiModel : config.claudeModel;
  try { startTelemetry({ url: config.warroomUrl, token: config.warroomToken, dataDir: config.dataDir, models: {
    ...Object.fromEntries(['requests','task_sync','summary','media'].map(capability => [capability, { provider, requestedModel: primaryModel }])),
    render: {provider:'openai', requestedModel:config.openaiImageModel},
  } }); } catch { log('ส่งสถานะ Warroom ไม่พร้อม บอทยังทำงานต่อ'); }
  if (config.workToken) {
    try {
      const settings = loadWorkPairing(config.workPairingFile);
      if (!config.watchGroups.length || config.workToken === config.warroomToken) throw new Error('invalid_work_config');
      workBridge = createWorkBridge({ settings, url: config.warroomUrl, token: config.workToken,
        connection: () => connected ? sock : null, isWatched, serialize, log });
      workGroupJid = settings.groupJid;
      workBridge.start();
    } catch {
      log('ยังไม่เปิดซิงก์งาน Warroom กรุณาตรวจค่าจับคู่');
    }
  }

  // Reminders: check every 30 seconds while connected.
  setInterval(() => {
    if (!sock?.user) return;
    serialize(fireReminders).catch((e) => log('ระบบเตือนผิดพลาด:', e.message));
  }, 30_000);

  if (config.briefingCron) {
    if (!cron.validate(config.briefingCron)) {
      console.error(`BRIEFING_CRON ไม่ถูกต้อง: ${config.briefingCron}`);
      process.exit(1);
    }
    cron.schedule(config.briefingCron, () => serialize(sendBriefings).catch((e) => log(e.message)), { timezone: config.timezone });
    log(`☀️ สรุปงานตอนเช้าตามเวลา "${config.briefingCron}"`);
  }

  if (config.summaryCron) {
    if (!cron.validate(config.summaryCron)) {
      console.error(`SUMMARY_CRON ไม่ถูกต้อง: ${config.summaryCron}`);
      process.exit(1);
    }
    const options = { timezone: config.timezone, noOverlap: true };
    cron.schedule(config.summaryCron, () => serialize(scheduledSummary).catch((e) => log(e)), options);
    if (dailyCronMinutes(config.summaryCron) != null) {
      cron.schedule('*/5 * * * *', () => {
        if (connected) return serialize(retryScheduledSummary).catch((e) => log(e));
      }, options);
    }
    log(`⏰ รายงานประจำวันตามเวลา "${config.summaryCron}" (${config.timezone}) ส่งไปที่ ${config.summaryTarget === 'owner' ? 'แชทส่วนตัวของเจ้าของ' : 'กลุ่ม'}`);
  }

  start().catch((err) => {
    log('เริ่มการเชื่อมต่อไม่สำเร็จ:', err.message);
    process.exit(1);
  });
}

// Run only when started as a program (`npm start`); tests import the handlers instead.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

export const _test = {
  setSocket: (s) => { sock = s; connected = Boolean(s); },
  handleMessage,
  handleReactions,
  fireReminders,
  sendBriefings,
  catchUp,
  retryScheduledSummary,
  upsertFlags,
  flushTaskSync: async (groupJid) => {
    clearTimeout(syncTimers.get(groupJid));
    syncTimers.delete(groupJid);
  },
  flushRenders,
  isNetworkError,
  groupCache,
};
