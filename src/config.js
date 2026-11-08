import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  root,
  dataDir: path.join(root, 'data'),
  authDir: path.join(root, 'data', 'auth'),
  mediaDir: path.join(root, 'data', 'media'),
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'messages.db'),
  outputDir: path.join(root, 'output'),

  // AI provider: "openai" or "claude". Without AI_PROVIDER: Claude only if just an Anthropic key is set.
  provider: (
    process.env.AI_PROVIDER ||
    (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY ? 'claude' : 'openai')
  ).toLowerCase(),
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-6.1-terra',
  // Image generation/editing model (OpenAI GPT Image 2.6 Sunburst), separate from chat model.
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-sunburst',
  imageQuality: process.env.IMAGE_QUALITY || 'medium',
  // 0 = no daily limit (renders are still counted; see /เรนเดอร์).
  maxRendersPerDay: Number(process.env.MAX_RENDERS_PER_DAY ?? 0),

  // Group names to watch (comma separated). Empty = every group the bot is in.
  watchGroups: list(process.env.WATCH_GROUPS),

  // Daily summary schedule (cron syntax) and timezone. Empty SUMMARY_CRON turns it off.
  summaryCron: process.env.SUMMARY_CRON ?? '0 18 * * *',
  timezone: process.env.TZ_NAME || 'Asia/Bangkok',

  // Where scheduled summaries go: "group" posts into the group, "owner" sends a DM to OWNER_NUMBER.
  summaryTarget: process.env.SUMMARY_TARGET || 'group',
  ownerNumber: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),

  // Phase 1: tasks & reminders
  utcOffsetHours: Number(process.env.UTC_OFFSET_HOURS ?? 7),
  briefingCron: process.env.BRIEFING_CRON ?? '0 8 * * *',
  // Find tasks in normal conversation (a few minutes after the chat goes quiet).
  autoTasks: (process.env.AUTO_TASKS || 'true') !== 'false',
  autoTaskQuietMinutes: Number(process.env.AUTO_TASK_QUIET_MINUTES ?? 3),
  // Post a short note when tasks are found/closed automatically.
  announceTasks: (process.env.ANNOUNCE_TASKS || 'true') !== 'false',
  // Follow-ups on a one-off task reminder while the task is still open.
  maxNags: Number(process.env.MAX_NAGS ?? 2),
  nagHours: Number(process.env.NAG_HOURS ?? 3),
  // Recent chat context for answers; keyword retrieval adds up to 40 older matching messages.
  qaContextMessages: 60,
  qaContextDays: 7,
  // Phase 1 client dossier limit per group.
  maxClients: Number(process.env.MAX_CLIENTS ?? 10),

  // After the bot was offline: answer commands/requests sent up to this many hours ago.
  offlineReplyHours: Number(process.env.OFFLINE_REPLY_HOURS ?? 12),

  // How the bot introduces itself, and who people contact about it.
  botDisplayName: process.env.BOT_DISPLAY_NAME || 'BOTTY',
  botAdmin: process.env.BOT_ADMIN || '',
  // Answer questions about the bot (e.g. "ai นี้เก็บข้อมูลไหม") even when it isn't tagged.
  answerBotQuestions: (process.env.ANSWER_BOT_QUESTIONS || 'true') !== 'false',
  // Words that call the bot besides @mentioning it (comma separated).
  botNames: list(process.env.BOT_NAMES || 'บอท,botty,bot'),

  // Name shown in summaries for messages sent from the linked WhatsApp account itself.
  myName: process.env.MY_NAME || '',

  // Optional: log in with a pairing code instead of a QR (digits incl. country code, e.g. 66812345678).
  pairingNumber: (process.env.PAIRING_NUMBER || '').replace(/\D/g, ''),

  // Describe images / PDFs with Claude when they arrive.
  describeMedia: (process.env.DESCRIBE_MEDIA || 'true') !== 'false',
  maxPdfBytes: 15 * 1024 * 1024,

  // Free-text background about the team, given to Claude for better summaries.
  groupContext:
    process.env.GROUP_CONTEXT ||
    'ทีมออกแบบสถาปัตยกรรมขนาดเล็ก คุยเรื่องงานลูกค้า แบบบ้าน งาน Render โลโก้/แบรนด์ และไฟล์งาน',
};
