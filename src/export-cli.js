#!/usr/bin/env node
// Summarize a WhatsApp "Export chat" .zip (or its _chat.txt) without running the bot.
//
//   npm run summarize-export -- "~/Downloads/WhatsApp Chat - X.zip"
//   npm run summarize-export -- chat.zip --no-media      # skip image descriptions
//   npm run summarize-export -- chat.zip --transcript    # print transcript only, no API calls
//   npm run summarize-export -- chat.zip --since 2026-11-08

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { config } from './config.js';
import { parseExport } from './export-parser.js';
import { describeMedia, mimeForFile, canDescribe } from './describe.js';
import { summarize, buildTranscript } from './summarize.js';
import { explainError, hasCredentials, NO_KEY_MESSAGE } from './ai.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a, i) => !a.startsWith('--') && !['--since', '--name'].includes(args[i - 1]));

if (!input) {
  console.error('ใช้งาน: npm run summarize-export -- <ไฟล์ .zip หรือ _chat.txt> [--no-media] [--transcript] [--since YYYY-MM-DD]');
  process.exit(1);
}

const src = path.resolve(input.replace(/^~/, os.homedir()));
let dir;
let chatFile;
if (src.endsWith('.zip')) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-export-'));
  new AdmZip(src).extractAllTo(dir, true);
  chatFile = fs.readdirSync(dir).find((f) => f.endsWith('.txt'));
  if (!chatFile) throw new Error('ไม่พบไฟล์ .txt ใน zip');
  chatFile = path.join(dir, chatFile);
} else {
  chatFile = src;
  dir = path.dirname(src);
}

const groupName =
  opt('--name') ||
  path.basename(src).replace(/\.(zip|txt)$/, '').replace(/^WhatsApp Chat - /, '').replace(/ \(\d+\)$/, '');

let messages = parseExport(fs.readFileSync(chatFile, 'utf8'));
const since = opt('--since');
if (since) {
  const t = new Date(since + 'T00:00:00').getTime() / 1000;
  messages = messages.filter((m) => m.ts >= t);
}
console.error(`อ่านได้ ${messages.length} ข้อความจาก "${groupName}"`);

const rows = messages.map((m) => ({
  id: m.id,
  ts: m.ts,
  sender_name: m.senderName,
  kind: m.kind,
  text: m.text,
  file_name: m.fileName,
  media_desc: null,
  quoted_text: null,
}));

if (!flag('--transcript') && !hasCredentials()) {
  console.error(NO_KEY_MESSAGE);
  process.exit(1);
}

const useMedia = !flag('--no-media') && !flag('--transcript') && config.describeMedia;
if (useMedia) {
  const todo = rows.filter((r) => r.file_name && canDescribe(mimeForFile(r.file_name)));
  console.error(`กำลังให้ AI ดู ${todo.length} รูป/ไฟล์...`);
  let done = 0;
  const worker = async () => {
    for (let r = todo.shift(); r; r = todo.shift()) {
      const file = path.join(dir, r.file_name);
      if (!fs.existsSync(file)) continue;
      const idx = rows.indexOf(r);
      const recentChat = rows
        .slice(Math.max(0, idx - 6), idx)
        .filter((x) => x.kind === 'text')
        .map((x) => `${x.sender_name}: ${x.text}`)
        .join('\n');
      try {
        r.media_desc = await describeMedia(fs.readFileSync(file), mimeForFile(r.file_name), {
          sender: r.sender_name,
          recentChat,
        });
      } catch (err) {
        console.error(`  ข้าม ${r.file_name}: ${explainError(err)}`);
      }
      process.stderr.write(`\r  เสร็จ ${++done} ไฟล์`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  process.stderr.write('\n');
}

if (flag('--transcript')) {
  console.log(buildTranscript(rows));
  process.exit(0);
}

try {
  const summary = await summarize(rows, { groupName });
  console.log('\n' + summary + '\n');
  fs.mkdirSync(config.outputDir, { recursive: true });
  const out = path.join(config.outputDir, `summary-${groupName.replace(/[^\p{L}\p{N}]+/gu, '_')}-${Date.now()}.md`);
  fs.writeFileSync(out, summary + '\n\n---\n\n## บทสนทนาที่ใช้สรุป\n\n```\n' + buildTranscript(rows) + '\n```\n');
  console.error(`บันทึกไว้ที่ ${out}`);
} catch (err) {
  console.error('สรุปไม่สำเร็จ:', explainError(err));
  process.exit(1);
}
