// One place that talks to the AI. AI_PROVIDER picks Claude (Anthropic) or OpenAI.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from './config.js';

let anthropic;
let openai;

export function hasCredentials() {
  if (config.provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

export const NO_KEY_MESSAGE =
  config.provider === 'openai'
    ? 'ไม่พบ OPENAI_API_KEY — สร้างไฟล์ .env ในโฟลเดอร์โปรเจกต์ (คัดลอกจาก .env.example) แล้วใส่ OPENAI_API_KEY=sk-...'
    : 'ไม่พบ ANTHROPIC_API_KEY — สร้างไฟล์ .env ในโฟลเดอร์โปรเจกต์ (คัดลอกจาก .env.example) แล้วใส่ ANTHROPIC_API_KEY=sk-ant-...';

/**
 * @param {{
 *   system: string,
 *   text: string,
 *   file?: { mime: string, base64: string, name?: string },
 *   effort?: 'low' | 'medium' | 'high',
 *   maxTokens?: number,
 * }} p
 * @returns {Promise<string>}
 */
export async function ask(p) {
  if (_stub.ask) return _stub.ask(p);
  return config.provider === 'openai' ? askOpenAI(p) : askClaude(p);
}

const TRUNCATED = '\n\n(สรุปถูกตัดเพราะยาวเกินกำหนด)';

async function askClaude({ system, text, file, effort = 'medium', maxTokens = 16000 }) {
  anthropic ??= new Anthropic();
  const content = [];
  if (file?.mime === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: file.mime, data: file.base64 } });
  } else if (file) {
    content.push({ type: 'image', source: { type: 'base64', media_type: file.mime, data: file.base64 } });
  }
  content.push({ type: 'text', text });

  // Server-side refusal fallbacks: a safety-classifier decline is retried on another model.
  const response = await anthropic.beta.messages.create({
    model: config.claudeModel,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort },
    system,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    const why = response.stop_details?.explanation || response.stop_details?.category || 'unknown';
    throw new Error(`AI ปฏิเสธคำขอ (${why})`);
  }
  const out = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return response.stop_reason === 'max_tokens' ? out + TRUNCATED : out;
}

async function askOpenAI({ system, text, file, effort = 'medium', maxTokens = 16000 }) {
  openai ??= new OpenAI();
  const content = [];
  if (file?.mime === 'application/pdf') {
    content.push({
      type: 'input_file',
      filename: file.name || 'document.pdf',
      file_data: `data:application/pdf;base64,${file.base64}`,
    });
  } else if (file) {
    content.push({ type: 'input_image', detail: 'auto', image_url: `data:${file.mime};base64,${file.base64}` });
  }
  content.push({ type: 'input_text', text });

  const response = await openai.responses.create({
    model: config.openaiModel,
    instructions: system,
    input: [{ role: 'user', content }],
    reasoning: { effort },
    max_output_tokens: maxTokens,
    store: false,
  });

  const out = (response.output_text || '').trim();
  if (response.status === 'incomplete') {
    if (response.incomplete_details?.reason === 'content_filter') throw new Error('AI ปฏิเสธคำขอ (content_filter)');
    return out + TRUNCATED;
  }
  return out;
}

export function explainError(err) {
  const name = config.provider === 'openai' ? 'OpenAI' : 'Claude';
  const status = err?.status;
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError)
    return `ต่อ ${name} API ไม่ได้ (เช็กอินเทอร์เน็ต)`;
  if (status === 401) return `API key ของ ${name} ไม่ถูกต้อง หรือถูกยกเลิกไปแล้ว`;
  if (status === 403) return `API key ของ ${name} ไม่มีสิทธิ์ใช้โมเดลนี้`;
  if (status === 404) return `ไม่พบโมเดลนี้ใน ${name} (เช็กชื่อโมเดลใน .env)`;
  if (status === 429) return `${name}: เรียกถี่เกินไป หรือเครดิตหมด (เช็กยอดเงินในบัญชี)`;
  if (status === 400) return `${name}: คำขอไม่ถูกต้อง: ${err.message}`;
  if (status) return `${name} API error ${status}: ${err.message}`;
  return err?.message || String(err);
}

/**
 * Ask for JSON that matches `schema` (structured outputs on both providers).
 * The schema must list every property in `required` and set additionalProperties: false.
 * @returns {Promise<any>}
 */
export async function askJSON({ system, text, schema, name = 'result', effort = 'low', maxTokens = 8000 }) {
  if (_stub.askJSON) return _stub.askJSON({ system, text, schema, name });
  let raw;
  if (config.provider === 'openai') {
    openai ??= new OpenAI();
    const response = await openai.responses.create({
      model: config.openaiModel,
      instructions: system,
      input: [{ role: 'user', content: [{ type: 'input_text', text }] }],
      reasoning: { effort },
      max_output_tokens: maxTokens,
      store: false,
      text: { format: { type: 'json_schema', name, schema, strict: true } },
    });
    if (response.status === 'incomplete') throw new Error(`AI ตอบไม่ครบ (${response.incomplete_details?.reason})`);
    raw = response.output_text;
  } else {
    anthropic ??= new Anthropic();
    const response = await anthropic.beta.messages.create({
      model: config.claudeModel,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: text }],
    });
    if (response.stop_reason === 'refusal') throw new Error('AI ปฏิเสธคำขอ');
    if (response.stop_reason === 'max_tokens') throw new Error('AI ตอบไม่ครบ (max_tokens)');
    raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้');
  }
}

/** Tests replace the AI with canned answers here. */
export const _stub = { ask: null, askJSON: null };
