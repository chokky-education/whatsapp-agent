const $ = (id) => document.getElementById(id);

const UTC_OFFSET_SEC = 7 * 3600;
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function ts(hh, mm, ss = 0, dayOffset = 0) {
  return Math.floor(Date.UTC(2026, 10, 16 + dayOffset, hh - 7, mm, ss) / 1000);
}

const ANCHOR_NOW = ts(13, 20, 0);

function toBkkDate(sec) {
  return new Date((sec + UTC_OFFSET_SEC) * 1000);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatBkkHm(sec) {
  if (typeof sec !== 'number') return '—';
  const d = toBkkDate(sec);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatBkkTime(sec) {
  if (typeof sec !== 'number') return '—';
  const d = toBkkDate(sec);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatBkkDateTime(sec) {
  if (typeof sec !== 'number') return '—';
  const d = toBkkDate(sec);
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${formatBkkTime(sec)}`;
}

function formatSec(ms) {
  if (ms === null || ms === undefined) return '—';
  return `${(ms / 1000).toFixed(1)} วิ`;
}

function formatAge(ageSec) {
  if (typeof ageSec !== 'number' || ageSec < 0) return 'ยังไม่ทราบ';
  if (ageSec < 60) return `${ageSec} วิ ที่แล้ว`;
  const mins = Math.floor(ageSec / 60);
  const secs = ageSec % 60;
  if (mins < 60) return secs ? `${mins} น. ${secs} วิ ที่แล้ว` : `${mins} น. ที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hrs} ชม. ${remMins} น. ที่แล้ว` : `${hrs} ชม. ที่แล้ว`;
}

function formatShortAge(ageSec) {
  if (typeof ageSec !== 'number' || ageSec < 0) return 'ยังไม่เรียก';
  if (ageSec < 60) return `${ageSec} วิ`;
  const mins = Math.floor(ageSec / 60);
  if (mins < 60) return `${mins} น.`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} ชม.`;
}

const ITEMS = [
  { key: 'requests', name: 'ตอบคำขอ', short: 'ตอบคำขอ', requestedModel: 'example-text-model', queueLabel: 'ข้อความและงานตามเวลา', queueKey: 'main', icon: 'comment', refMs: 6000, groupName: 'ข้อความ' },
  { key: 'task_sync', name: 'จับงานอัตโนมัติ', short: 'จับงาน', requestedModel: 'example-text-model', queueLabel: 'ข้อความและงานตามเวลา', queueKey: 'main', icon: 'list', refMs: 6000, groupName: 'ข้อความ' },
  { key: 'summary', name: 'สรุปบทสนทนา', short: 'สรุปแชท', requestedModel: 'example-text-model', queueLabel: 'ข้อความและงานตามเวลา', queueKey: 'main', icon: 'document', refMs: 6000, groupName: 'ข้อความ' },
  { key: 'media', name: 'อ่านภาพ / PDF', short: 'อ่านภาพ', requestedModel: 'example-text-model', queueLabel: 'อ่านภาพและเอกสาร', queueKey: 'media', icon: 'picture', refMs: 10000, groupName: 'เอกสาร' },
  { key: 'render', name: 'สร้างและแก้ภาพ', short: 'สร้างภาพ', requestedModel: 'example-image-model', queueLabel: 'สร้างภาพ', queueKey: 'render', icon: 'wand', refMs: 15000, groupName: 'งานภาพ' },
];

const ITEM_BY_KEY = Object.fromEntries(ITEMS.map((item, idx) => [item.key, { ...item, idx }]));

// Synthetic scenarios shaped strictly after warroom/src/protocol.js + worker.js (/api/status, /api/history)
const RAW_SCENARIOS = {
  problem: {
    title: 'WhatsApp หลุดไป 6 นาที',
    description: 'เครื่องบอทยังติดต่อได้ แต่ข้อความใหม่อาจยังไม่ถึงบอท',
    advice: 'ลองตรวจการเชื่อมต่อ WhatsApp',
    note: 'ยังบอกสาเหตุที่หลุดไม่ได้จากข้อมูลนี้',
    defaultCapability: 0,
    now: ANCHOR_NOW,
    receivedAt: ts(13, 20, 0),
    stale: false,
    incidents: [
      { key: 'whatsapp_disconnected', openedAt: ts(13, 14, 0), error: 'connection close: link check required' },
    ],
    notification: { lastSentAt: ts(13, 19, 0), pending: 0, retrying: 0 },
    snapshot: {
      at: ts(13, 20, 0),
      host: { ok: true, state: 'online' },
      whatsapp: { state: 'close', since: ts(13, 14, 0) },
      lastSend: { at: ts(13, 12, 0), status: 'server_ack' },
      queues: [
        { name: 'main', waiting: 3, running: 1, oldestAt: ts(13, 17, 20) },
        { name: 'media', waiting: 1, running: 0, oldestAt: ts(13, 18, 30) },
        { name: 'render', waiting: 0, running: 0, oldestAt: null },
      ],
      models: [
        { capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 12, 0), lastResult: 'ok' },
        { capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(12, 38, 0), lastResult: 'ok' },
        { capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 8, 0), lastResult: 'ok' },
        { capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 2, 0), lastResult: 'ok' },
        { capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, lastAt: null, lastResult: null },
      ],
    },
    events: [
      { id: 'ev-p10', type: 'connection', at: ts(13, 14, 0), capability: null, state: 'close', error: 'connection close' },
      { id: 'ev-p09', type: 'ai_ok', at: ts(13, 12, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1850 },
      { id: 'ev-p08', type: 'ai_ok', at: ts(13, 8, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2900 },
      { id: 'ev-p07', type: 'ai_ok', at: ts(13, 2, 0), capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 3400 },
      { id: 'ev-p06', type: 'ai_ok', at: ts(12, 38, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2150 },
      { id: 'ev-p05', type: 'ai_ok', at: ts(12, 25, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1700 },
      { id: 'ev-p04', type: 'ai_ok', at: ts(11, 42, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1620 },
      { id: 'ev-p03', type: 'ai_ok', at: ts(10, 18, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2050 },
      { id: 'ev-p02', type: 'connection', at: ts(9, 15, 0), capability: null, state: 'open', error: null },
      { id: 'ev-p01', type: 'ai_ok', at: ts(8, 22, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2650 },
    ],
  },
  healthy: {
    title: 'ติดต่อบอทได้',
    description: 'เครื่องบอทและ WhatsApp เชื่อมต่ออยู่',
    advice: 'ยังไม่มีเรื่องที่ต้องตรวจ',
    note: 'การเชื่อมต่อไม่ได้ยืนยันว่าจะตอบได้ทุกครั้ง',
    defaultCapability: 0,
    now: ANCHOR_NOW,
    receivedAt: ts(13, 20, 0),
    stale: false,
    incidents: [],
    notification: { lastSentAt: null, pending: 0, retrying: 0 },
    snapshot: {
      at: ts(13, 20, 0),
      host: { ok: true, state: 'online' },
      whatsapp: { state: 'open', since: ts(7, 5, 0) },
      lastSend: { at: ts(13, 18, 0), status: 'server_ack' },
      queues: [
        { name: 'main', waiting: 0, running: 0, oldestAt: null },
        { name: 'media', waiting: 0, running: 0, oldestAt: null },
        { name: 'render', waiting: 0, running: 0, oldestAt: null },
      ],
      models: [
        { capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 18, 0), lastResult: 'ok' },
        { capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 4, 0), lastResult: 'ok' },
        { capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(12, 41, 0), lastResult: 'ok' },
        { capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 10, 0), lastResult: 'ok' },
        { capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, lastAt: ts(13, 15, 0), lastResult: 'ok' },
      ],
    },
    events: [
      { id: 'ev-h11', type: 'ai_ok', at: ts(13, 18, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1350 },
      { id: 'ev-h10', type: 'ai_ok', at: ts(13, 15, 0), capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, error: null, durationMs: 11800 },
      { id: 'ev-h09', type: 'ai_ok', at: ts(13, 10, 0), capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2850 },
      { id: 'ev-h08', type: 'ai_ok', at: ts(13, 4, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1650 },
      { id: 'ev-h07', type: 'ai_ok', at: ts(12, 41, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2550 },
      { id: 'ev-h06', type: 'ai_ok', at: ts(12, 24, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1420 },
      { id: 'ev-h05', type: 'ai_ok', at: ts(11, 20, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1510 },
      { id: 'ev-h04', type: 'ai_ok', at: ts(10, 12, 0), capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 3050 },
      { id: 'ev-h03', type: 'ai_ok', at: ts(9, 25, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1720 },
      { id: 'ev-h02', type: 'ai_ok', at: ts(8, 10, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2420 },
      { id: 'ev-h01', type: 'connection', at: ts(7, 5, 0), capability: null, state: 'open', error: null },
    ],
  },
  stale: {
    title: 'ยังยืนยันสถานะตอนนี้ไม่ได้',
    description: 'ไม่ได้รับข้อมูลใหม่มา 10 นาที ข้อมูลด้านล่างเป็นข้อมูลเก่า',
    advice: 'ลองตรวจที่เครื่องบอท',
    note: 'เครื่องอาจหลับหรือขาดอินเทอร์เน็ต ยังไม่ทราบสาเหตุ',
    defaultCapability: 0,
    now: ANCHOR_NOW,
    receivedAt: ts(13, 10, 0),
    stale: true,
    incidents: [
      { key: 'telemetry_stale', openedAt: ts(13, 15, 0), error: 'no snapshot received for 10m' },
    ],
    notification: { lastSentAt: ts(13, 16, 0), pending: 0, retrying: 0 },
    snapshot: {
      at: ts(13, 10, 0),
      host: { ok: true, state: 'stale' },
      whatsapp: { state: 'open', since: ts(8, 0, 0) },
      lastSend: { at: ts(13, 8, 0), status: 'server_ack' },
      queues: [
        { name: 'main', waiting: 1, running: 0, oldestAt: ts(13, 8, 45) },
        { name: 'media', waiting: 0, running: 0, oldestAt: null },
        { name: 'render', waiting: 0, running: 0, oldestAt: null },
      ],
      models: [
        { capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 8, 0), lastResult: 'ok' },
        { capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(12, 35, 0), lastResult: 'ok' },
        { capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(12, 10, 0), lastResult: 'ok' },
        { capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(12, 55, 0), lastResult: 'ok' },
        { capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, lastAt: ts(11, 30, 0), lastResult: 'ok' },
      ],
    },
    events: [
      { id: 'ev-s07', type: 'ai_ok', at: ts(13, 8, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1900 },
      { id: 'ev-s06', type: 'ai_ok', at: ts(12, 55, 0), capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 3600 },
      { id: 'ev-s05', type: 'ai_ok', at: ts(12, 35, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2200 },
      { id: 'ev-s04', type: 'ai_ok', at: ts(12, 10, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 3100 },
      { id: 'ev-s03', type: 'ai_ok', at: ts(11, 30, 0), capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, error: null, durationMs: 12900 },
      { id: 'ev-s02', type: 'ai_ok', at: ts(10, 5, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1850 },
      { id: 'ev-s01', type: 'connection', at: ts(8, 0, 0), capability: null, state: 'open', error: null },
    ],
  },
  empty: {
    title: 'ยังรอสถานะแรกจากบอท',
    description: 'เมื่อบอทส่งข้อมูลเข้ามา เราจะเห็นสถานะและกราฟเหตุการณ์จริงที่นี่',
    advice: 'รอข้อมูลจากบอท',
    note: 'ยังไม่มีหลักฐานพอจะบอกว่าบอทพร้อมหรือไม่',
    defaultCapability: 0,
    now: ANCHOR_NOW,
    receivedAt: null,
    stale: false,
    incidents: [],
    notification: null,
    snapshot: null,
    events: [],
  },
  ai: {
    title: 'งานสรุปต้องการความช่วยเหลือ',
    description: 'เครื่องบอทและ WhatsApp เชื่อมต่ออยู่ แต่งานสรุปล่าสุดไม่สำเร็จ',
    advice: 'ตรวจบริการ AI สำหรับงานสรุป',
    note: 'ความสามารถอื่นอาจยังทำงานได้ตามปกติ',
    defaultCapability: 2,
    now: ANCHOR_NOW,
    receivedAt: ts(13, 20, 0),
    stale: false,
    incidents: [
      { key: 'ai_summary_failing', openedAt: ts(13, 12, 0), error: 'timeout waiting for model response' },
    ],
    notification: { lastSentAt: ts(13, 17, 0), pending: 0, retrying: 0 },
    snapshot: {
      at: ts(13, 20, 0),
      host: { ok: true, state: 'online' },
      whatsapp: { state: 'open', since: ts(7, 30, 0) },
      lastSend: { at: ts(13, 18, 0), status: 'server_ack' },
      queues: [
        { name: 'main', waiting: 2, running: 1, oldestAt: ts(13, 18, 0) },
        { name: 'media', waiting: 1, running: 0, oldestAt: ts(13, 19, 10) },
        { name: 'render', waiting: 1, running: 0, oldestAt: ts(13, 19, 40) },
      ],
      models: [
        { capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 18, 0), lastResult: 'ok' },
        { capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(12, 45, 0), lastResult: 'ok' },
        { capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: null, lastAt: ts(13, 16, 0), lastResult: 'error' },
        { capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', lastAt: ts(13, 6, 0), lastResult: 'ok' },
        { capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, lastAt: ts(11, 50, 0), lastResult: 'ok' },
      ],
    },
    events: [
      { id: 'ev-a11', type: 'ai_ok', at: ts(13, 18, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1520 },
      { id: 'ev-a10', type: 'ai_error', at: ts(13, 16, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: null, error: 'หมดเวลาตอบ (timeout)', durationMs: 5100 },
      { id: 'ev-a09', type: 'ai_error', at: ts(13, 12, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: null, error: 'หมดเวลาตอบ (timeout)', durationMs: 5400 },
      { id: 'ev-a08', type: 'ai_ok', at: ts(13, 6, 0), capability: 'media', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 2950 },
      { id: 'ev-a07', type: 'ai_ok', at: ts(12, 45, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1780 },
      { id: 'ev-a06', type: 'ai_ok', at: ts(12, 30, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1500 },
      { id: 'ev-a05', type: 'ai_ok', at: ts(11, 50, 0), capability: 'render', provider: 'openai', requestedModel: 'example-image-model', responseModel: null, error: null, durationMs: 12100 },
      { id: 'ev-a04', type: 'ai_ok', at: ts(10, 40, 0), capability: 'requests', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1480 },
      { id: 'ev-a03', type: 'ai_error', at: ts(9, 30, 0), capability: 'summary', provider: 'openai', requestedModel: 'example-text-model', responseModel: null, error: 'rate limit', durationMs: 4200 },
      { id: 'ev-a02', type: 'ai_ok', at: ts(8, 15, 0), capability: 'task_sync', provider: 'openai', requestedModel: 'example-text-model', responseModel: 'example-response-model', error: null, durationMs: 1820 },
      { id: 'ev-a01', type: 'connection', at: ts(7, 30, 0), capability: null, state: 'open', error: null },
    ],
  },
};

function buildMockApiPayloads(scenarioKey, role) {
  const raw = RAW_SCENARIOS[scenarioKey];
  const admin = role === 'admin';
  const aiEvents = raw.events.filter((e) => e.type.startsWith('ai_')).slice(0, 30);

  const status = {
    now: raw.now,
    receivedAt: raw.receivedAt,
    stale: raw.stale,
    snapshot: raw.snapshot,
    pause: {
      until: pauseState.minutes > 0 ? raw.now + pauseState.minutes * 60 : null,
      by: pauseState.actor,
    },
    incidents: raw.incidents.map((inc) => (
      admin ? { ...inc } : { key: inc.key, openedAt: inc.openedAt }
    )),
    calls: admin
      ? aiEvents.map(({ id, type, at, capability, provider, requestedModel, responseModel, error, durationMs }) => ({
          id, type, at, capability, provider, requestedModel, responseModel, error, durationMs,
        }))
      : undefined,
    notification: admin ? raw.notification : undefined,
  };

  const history = {
    events: raw.events.map((e) => (
      admin ? { ...e } : { type: e.type, at: e.at, capability: e.capability }
    )),
    nextBefore: null,
    nextCursor: null,
  };

  return { raw, status, history };
}

const VIEW_HEADERS = {
  overview: ['Warroom / ภาพรวม', 'สุขภาพบอทวันนี้'],
  history: ['Warroom / ประวัติ', 'ประวัติการทำงาน 30 วัน'],
  settings: ['Warroom / การแจ้งเตือน', 'การแจ้งเตือนและช่วงพัก'],
  members: ['Warroom / สมาชิก', 'สมาชิกและสิทธิ์เข้าใช้งาน'],
};

let activeView = 'overview';
let selectedCapability = 0;
let rhythmCapFilter = 'all';
let selectedPointIndex = null;
let lastScenarioRendered = null;
let historyFilter = 'all';
let searchQuery = '';
let pauseState = { minutes: 0, untilLabel: null, actor: null };
let settingsFeedback = null;
let membersFeedback = null;

const membersList = [
  { email: 'nok@example.com', name: 'Nok', role: 'admin' },
  { email: 'somchai@example.com', name: 'Somchai', role: 'member' },
  { email: 'ploy@example.com', name: 'Ploy', role: 'member' },
];

const auditLog = [
  { at: '16 พ.ย. 09:00:00', actor: 'nok@example.com', summary: 'ตั้งสิทธิ์สมาชิก · somchai@example.com' },
  { at: '15 พ.ย. 18:30:00', actor: 'nok@example.com', summary: 'พักแจ้งเตือน 30 นาที' },
  { at: '15 พ.ย. 19:00:00', actor: 'ระบบอัตโนมัติ', summary: 'ครบกำหนดพัก · กลับมาแจ้งเตือนตามปกติ' },
];

function isAdmin() {
  return $('role').value === 'admin';
}

function buildLinearPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function connStateLabel(state) {
  if (state === 'open') return ['เชื่อมต่อแล้ว', 'is-ok'];
  if (state === 'close') return ['WhatsApp หลุด', 'is-warn'];
  if (state === 'connecting') return ['กำลังเชื่อมต่อ', ''];
  return ['เปลี่ยนสถานะเชื่อมต่อ', ''];
}

function renderKpis(key, payload) {
  const { status } = payload;
  const snap = status.snapshot;

  if (!snap) {
    const emptyCards = [
      { label: 'เครื่องบอท', val: 'ยังไม่ทราบ', sub: 'รอข้อมูลแรก', tone: 'is-unknown', icon: 'comment' },
      { label: 'WhatsApp', val: 'ยังไม่ทราบ', sub: 'รอข้อมูลแรก', tone: 'is-unknown', icon: 'list' },
      { label: 'ส่งคำตอบล่าสุด', val: 'ยังไม่มีข้อมูล', sub: 'ไม่มีหลักฐานการส่ง', tone: 'is-unknown', icon: 'check' },
      { label: 'งานในคิวรอ', val: 'ยังไม่ทราบ', sub: 'รอข้อมูลแรก', tone: 'is-unknown', icon: 'picture' },
      { label: 'สถานะ AI ล่าสุด', val: 'ยังไม่ทราบ', sub: 'รอผลเรียก AI แรก', tone: 'is-unknown', icon: 'wand' },
    ];
    renderKpiGrid(emptyCards);
    return;
  }

  const stale = status.stale;
  const qMap = Object.fromEntries(snap.queues.map((q) => [q.name, q]));
  const waitingTotal = snap.queues.reduce((sum, q) => sum + q.waiting, 0);
  const runningTotal = snap.queues.reduce((sum, q) => sum + q.running, 0);
  const okModels = snap.models.filter((m) => m.lastResult === 'ok').length;
  const errModels = snap.models.filter((m) => m.lastResult === 'error').length;
  const knownModels = snap.models.filter((m) => m.lastResult !== null).length;

  const waClose = snap.whatsapp.state === 'close';
  const cards = [
    {
      label: 'เครื่องบอท',
      val: stale ? 'ยังไม่ยืนยัน' : 'ติดต่อได้',
      sub: stale ? `เก่า ${formatBkkTime(status.receivedAt)}` : `รับ ${formatBkkTime(status.receivedAt)}`,
      tone: stale ? 'is-unknown' : 'is-ok',
      icon: 'comment',
    },
    {
      label: 'WhatsApp',
      val: stale ? 'ยังไม่ยืนยัน' : waClose ? 'ขาดการเชื่อมต่อ' : 'เชื่อมต่อแล้ว',
      sub: stale ? `เก่า ${formatBkkTime(snap.at)}` : waClose ? `ตั้งแต่ ${formatBkkTime(snap.whatsapp.since)}` : `ตั้งแต่ ${formatBkkHm(snap.whatsapp.since)}`,
      tone: stale ? 'is-unknown' : waClose ? 'is-warn' : 'is-ok',
      icon: 'list',
    },
    {
      label: 'ส่งคำตอบล่าสุด',
      val: formatBkkTime(snap.lastSend.at),
      sub: stale ? 'หลักฐานเก่า' : 'ส่งสำเร็จ · รอ ACK',
      tone: stale ? 'is-unknown' : 'is-ok',
      icon: 'check',
    },
    {
      label: 'งานในคิวรอ',
      val: `${waitingTotal} รอ`,
      sub: stale
        ? 'ตัวเลขเก่า'
        : waitingTotal === 0 && runningTotal === 0
          ? 'ว่างพร้อมรับงาน'
          : `หลัก ${qMap.main?.waiting ?? 0} · ภาพ ${(qMap.media?.waiting ?? 0) + (qMap.render?.waiting ?? 0)} · ทำอยู่ ${runningTotal}`,
      tone: stale ? 'is-unknown' : waitingTotal > 0 && key === 'problem' ? 'is-warn' : 'is-ok',
      icon: 'picture',
    },
    {
      label: 'สถานะ AI ล่าสุด',
      val: stale ? 'ข้อมูลเก่า' : errModels > 0 ? `${okModels}/${knownModels} · ${errModels} พลาด` : `${okModels}/${knownModels} พร้อม`,
      sub: stale ? `${okModels}/${knownModels} ครั้งก่อนสำเร็จ` : errModels > 0 ? 'พบงานที่ไม่สำเร็จล่าสุด' : knownModels < 5 ? `ยังไม่เคยเรียก ${5 - knownModels} งาน` : 'ล่าสุดสำเร็จทุกงาน',
      tone: stale ? 'is-unknown' : errModels > 0 ? 'is-warn' : 'is-ok',
      icon: 'wand',
    },
  ];
  renderKpiGrid(cards);
}

function renderKpiGrid(cards) {
  $('kpi-grid').innerHTML = cards.map((c) => `
    <div class="kpi-card">
      <div class="kpi-icon ${c.tone}" aria-hidden="true"><i class="fi fi-${c.icon}"></i></div>
      <div class="kpi-text">
        <span class="kpi-label">${c.label}</span>
        <strong class="kpi-value">${c.val}</strong>
        <span class="kpi-sub">${c.sub}</span>
      </div>
    </div>
  `).join('');
}

function renderRhythmFilters(key, payload) {
  const filters = [['all', 'ทั้งหมด'], ...ITEMS.map((item) => [item.key, item.short])];
  $('rhythm-cap-filters').innerHTML = filters.map(([capKey, label]) => `
    <button type="button" class="pill-filter" data-rhythm-cap="${capKey}" aria-pressed="${rhythmCapFilter === capKey}">${label}</button>
  `).join('');

  $('rhythm-cap-filters').querySelectorAll('[data-rhythm-cap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rhythmCapFilter = btn.dataset.rhythmCap;
      selectedPointIndex = null;
      if (rhythmCapFilter !== 'all' && ITEM_BY_KEY[rhythmCapFilter]) {
        selectedCapability = ITEM_BY_KEY[rhythmCapFilter].idx;
      }
      renderRhythmCard(key, payload);
      syncCapabilitySelection(key, payload);
    });
  });
}

function renderConnStrip(payload) {
  const { status, history } = payload;
  const connEvents = [...history.events]
    .filter((e) => e.type === 'connection')
    .sort((a, b) => a.at - b.at);

  const pills = [];
  if (!status.snapshot && !connEvents.length) {
    pills.push('<span class="conn-pill is-stale">ยังรอสัญญาณแรก</span>');
  } else {
    if (status.snapshot) {
      const stale = status.stale;
      const [label, cls] = connStateLabel(status.snapshot.whatsapp.state);
      const pillCls = stale ? 'is-stale' : cls;
      const prefix = stale ? 'เก่า: ' : 'สถานะล่าสุด: ';
      pills.push(`<span class="conn-pill ${pillCls}">${prefix}${label}</span>`);
    }
    connEvents.forEach((ev) => {
      if (ev.state !== undefined) {
        const [label, cls] = connStateLabel(ev.state);
        pills.push(`<span class="conn-pill ${status.stale ? 'is-stale' : cls}">${formatBkkHm(ev.at)} · ${label}</span>`);
      } else {
        pills.push(`<span class="conn-pill">${formatBkkHm(ev.at)} · เปลี่ยนสถานะเชื่อมต่อ</span>`);
      }
    });
  }

  $('conn-strip').innerHTML = `<span class="conn-strip-label">เหตุการณ์เชื่อมต่อ WhatsApp (แยกจากแกนเวลา AI):</span>${pills.join('')}`;
}

function renderRhythmCard(key, payload) {
  renderRhythmFilters(key, payload);
  renderConnStrip(payload);

  const { status, history } = payload;
  const summary = $('rhythm-summary');
  const stage = $('rhythm-chart');
  const foot = $('rhythm-foot');
  const sub = $('rhythm-sub');
  const admin = Array.isArray(status.calls);
  const stale = status.stale;

  if (!status.snapshot && !history.events.length) {
    sub.textContent = 'รอข้อมูลแรกจากเครื่องบอท';
    summary.innerHTML = `
      <div class="big-num">—</div>
      <div class="sub-row"><span>ยังไม่มีบันทึกเรียก AI</span></div>
      <div class="track-badge is-unknown"><span class="track-dot">?</span>รอข้อมูลแรก</div>
    `;
    stage.innerHTML = '<div class="empty-chart-box"><div><strong>ยังไม่มีบันทึกเหตุการณ์ AI</strong><p>เมื่อบอทส่ง snapshot และ events เข้ามา กราฟแยกตามงานจริงจะปรากฏที่นี่</p></div></div>';
    foot.innerHTML = '<span>รอสัญญาณแรกจากบอท</span>';
    return;
  }

  if (admin) {
    renderAdminLatencyChart(key, payload);
  } else {
    renderTeamEventTimeline(key, payload);
  }
}

function assignTimelineX(items, padL, plotW) {
  if (!items.length) return [];
  if (items.length === 1) return [padL + plotW / 2];
  const minAt = items[0].at;
  const maxAt = items[items.length - 1].at;
  const span = Math.max(60, maxAt - minAt);
  const xs = items.map((item) => padL + ((item.at - minAt) / span) * plotW);
  // Prevent complete marker collision when two consecutive calls happen a few minutes apart in a multi-hour window
  const minGap = Math.min(24, plotW / Math.max(2, items.length));
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] < minGap) xs[i] = xs[i - 1] + minGap;
  }
  const overflow = xs[xs.length - 1] - (padL + plotW);
  if (overflow > 0) {
    const scale = plotW / (xs[xs.length - 1] - xs[0] || 1);
    return xs.map((x) => padL + (x - xs[0]) * scale);
  }
  return xs;
}

function renderAdminLatencyChart(key, payload) {
  const { status } = payload;
  const summary = $('rhythm-summary');
  const stage = $('rhythm-chart');
  const foot = $('rhythm-foot');
  const sub = $('rhythm-sub');
  const stale = status.stale;

  const allCalls = [...status.calls].sort((a, b) => a.at - b.at);
  const singleCap = rhythmCapFilter !== 'all';
  const calls = singleCap ? allCalls.filter((c) => c.capability === rhythmCapFilter) : allCalls;

  sub.textContent = singleCap
    ? `งาน "${ITEM_BY_KEY[rhythmCapFilter].name}" (${calls.length} ครั้ง) · เชื่อมเส้นเฉพาะจุดที่ห่าง ≤ 30 นาที`
    : `แสดงทุกครั้งที่เรียก AI จริงใน ${allCalls.length} ครั้งล่าสุด · ไม่เฉลี่ยรวมต่างประเภท และแยกเหตุการณ์เชื่อมต่อออก`;

  if (!calls.length) {
    const capName = singleCap ? ITEM_BY_KEY[rhythmCapFilter].name : 'AI';
    summary.innerHTML = `
      <div class="big-num">0 ครั้ง</div>
      <div class="sub-row"><span>ยังไม่ถูกเรียกในช่วงล่าสุด</span></div>
      <div class="track-badge is-unknown"><span class="track-dot">—</span>ไม่มีประวัติ</div>
    `;
    stage.innerHTML = `<div class="empty-chart-box"><div><strong>ยังไม่มีการเรียก "${capName}"</strong><p>ใน ${allCalls.length} ครั้งล่าสุดไม่มีงานประเภทนี้ (ไม่สร้างค่าแทน)</p></div></div>`;
    foot.innerHTML = '<span>ลองกดตัวกรอง "ทั้งหมด" เพื่อดูทุกงานที่ถูกเรียกจริง</span>';
    return;
  }

  const errCount = calls.filter((c) => c.type === 'ai_error').length;
  const okCount = calls.length - errCount;
  const badgeTone = stale ? 'is-unknown' : errCount > 0 ? 'is-warn' : '';
  const badgeWord = stale ? 'ข้อมูลเก่า' : errCount > 0 ? 'มีจุดต้องตรวจ' : 'ทำงานปกติ';

  if (singleCap) {
    const avgMs = calls.reduce((sum, c) => sum + c.durationMs, 0) / calls.length;
    summary.innerHTML = `
      <div class="big-num">${formatSec(avgMs)}</div>
      <div class="sub-row">
        <span>เฉลี่ยเฉพาะ ${ITEM_BY_KEY[rhythmCapFilter].short}</span>
        <span class="${errCount ? 'delta-warn' : 'delta-ok'}">${calls.length} ครั้ง</span>
      </div>
      <div class="track-badge ${badgeTone}">
        <span class="track-dot" aria-hidden="true">${errCount ? '!' : stale ? '?' : '✓'}</span>
        ${badgeWord}
      </div>
    `;
  } else {
    summary.innerHTML = `
      <div class="big-num">${calls.length} ครั้ง</div>
      <div class="sub-row">
        <span>${okCount} สำเร็จ</span>
        <span class="${errCount ? 'delta-warn' : 'delta-ok'}">${errCount ? `· ${errCount} ผิดพลาด` : '· พลาด 0'}</span>
      </div>
      <div class="track-badge ${badgeTone}">
        <span class="track-dot" aria-hidden="true">${errCount ? '!' : stale ? '?' : '✓'}</span>
        ${badgeWord}
      </div>
    `;
  }

  const W = 460;
  const H = 208;
  const padL = 48;
  const padR = 18;
  const padT = 36;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yBase = padT + plotH;

  const maxSec = Math.max(4, Math.ceil((Math.max(...calls.map((c) => c.durationMs)) * 1.18) / 1000));
  const midSec = Math.round(maxSec / 2);
  const maxMs = maxSec * 1000;

  const xs = assignTimelineX(calls, padL, plotW);
  const coords = calls.map((c, idx) => {
    const y = yBase - Math.min(1, c.durationMs / maxMs) * plotH;
    const item = ITEM_BY_KEY[c.capability];
    return { ...c, idx, x: xs[idx], y, capIndex: item ? item.idx : null, capShort: item ? item.short : c.capability };
  });

  if (selectedPointIndex === null || !coords[selectedPointIndex]) {
    const pick = coords.findLast((c) => c.type === 'ai_error') || coords[coords.length - 1];
    selectedPointIndex = pick ? pick.idx : 0;
  }

  const gridLines = [0, midSec, maxSec].map((secVal) => {
    const y = yBase - (secVal / maxSec) * plotH;
    return `
      <line class="chart-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>
      <text class="chart-axis-text" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${secVal} วิ</text>
    `;
  }).join('');

  // Only connect consecutive dots when filtered to ONE capability AND gap <= 30 min (1800s).
  // Larger gaps (> 30 min) get an honest shaded gap band.
  const gapShapes = [];
  const lineSegments = [];
  let curSeg = singleCap ? [coords[0]] : [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const hasGap = b.at - a.at > 1800;
    if (hasGap) {
      gapShapes.push(`<rect class="chart-gap-band" x="${a.x.toFixed(1)}" y="${padT}" width="${Math.max(12, b.x - a.x).toFixed(1)}" height="${plotH}" rx="6"></rect>`);
      if (singleCap) {
        if (curSeg.length > 1) lineSegments.push(curSeg);
        curSeg = [b];
      }
    } else if (singleCap) {
      curSeg.push(b);
    }
  }
  if (singleCap && curSeg.length > 1) lineSegments.push(curSeg);

  const linePaths = singleCap
    ? lineSegments.map((seg) => `<path class="chart-line" d="${buildLinearPath(seg)}"></path>`).join('')
    : '';

  const stems = coords.map((pt) => {
    const cls = ['chart-stem-bar', pt.type === 'ai_error' ? 'is-error' : stale ? 'is-stale' : ''].filter(Boolean).join(' ');
    return `<line class="${cls}" x1="${pt.x.toFixed(1)}" y1="${yBase.toFixed(1)}" x2="${pt.x.toFixed(1)}" y2="${pt.y.toFixed(1)}"></line>`;
  }).join('');

  const active = coords[selectedPointIndex];
  let floatPill = '';
  if (active) {
    const pillText = `${formatSec(active.durationMs)} · ${active.capShort}`;
    const pillW = Math.max(84, pillText.length * 6.5 + 16);
    const pillX = Math.max(padL, Math.min(W - padR - pillW, active.x - pillW / 2));
    const pillY = 3;
    const isErr = active.type === 'ai_error';
    const guideY1 = pillY + 21;
    const guideY2 = Math.max(guideY1 + 2, active.y - 7);
    floatPill = `
      <g id="rhythm-float-pill">
        <line x1="${active.x.toFixed(1)}" y1="${guideY1}" x2="${active.x.toFixed(1)}" y2="${guideY2.toFixed(1)}" stroke="${isErr ? 'var(--warning)' : 'var(--accent)'}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.7"></line>
        <rect class="hover-pill-bg ${isErr ? 'is-error' : ''}" x="${pillX.toFixed(1)}" y="${pillY}" width="${pillW}" height="21" rx="10.5"></rect>
        <text class="hover-pill-text" x="${(pillX + pillW / 2).toFixed(1)}" y="${(pillY + 14).toFixed(1)}" text-anchor="middle">${pillText}</text>
      </g>
    `;
  }

  let lastTickX = -999;
  const dots = coords.map((pt, idx) => {
    const pressed = selectedPointIndex === idx;
    const isErr = pt.type === 'ai_error';
    const cls = ['chart-point-dot', isErr ? 'is-error' : stale ? 'is-stale' : ''].filter(Boolean).join(' ');
    const aria = `${formatBkkTime(pt.at)} · ${pt.capShort} · ${formatSec(pt.durationMs)} · ${isErr ? 'ไม่สำเร็จ' : 'สำเร็จ'}`;
    let tick = '';
    if (pt.x - lastTickX >= 44 || idx === coords.length - 1) {
      if (idx === coords.length - 1 && pt.x - lastTickX < 36) {
        // Keep spaced neatly without colliding with previous tick
      } else {
        tick = `<text class="chart-axis-text" x="${pt.x.toFixed(1)}" y="${(H - 6).toFixed(1)}" text-anchor="middle">${formatBkkHm(pt.at)}</text>`;
        lastTickX = pt.x;
      }
    }
    return `
      <g class="chart-point-btn" role="button" tabindex="0" data-point="${idx}" aria-pressed="${pressed}" aria-label="${aria}">
        <circle class="chart-point-hit" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="14"></circle>
        <circle class="chart-point-ring" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="9.5"></circle>
        <circle class="${cls}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="5" style="animation-delay:${idx * 35}ms"></circle>
      </g>
      ${tick}
    `;
  }).join('');

  stage.innerHTML = `
    <svg class="rhythm-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟเวลาตอบ AI ตามจริงแยกตามงาน">
      <defs>
        <pattern id="hz-gap-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--border-strong)" stroke-width="1.5" stroke-opacity="0.45"></line>
        </pattern>
      </defs>
      ${gridLines}
      ${gapShapes.join('')}
      ${stems}
      ${linePaths}
      ${dots}
      ${floatPill}
    </svg>
  `;

  stage.querySelectorAll('.chart-line').forEach((p) => {
    const len = Math.ceil(p.getTotalLength());
    p.style.setProperty('--path-len', String(len));
    p.style.strokeDasharray = String(len);
    p.style.strokeDashoffset = String(len);
  });

  if (active) {
    const activeItem = ITEM_BY_KEY[active.capability];
    const statusStr = active.type === 'ai_error' ? `ไม่สำเร็จ (${active.error || 'error'})` : 'สำเร็จ';
    const jump = activeItem
      ? `<button type="button" class="chip-btn" id="rhythm-sync-btn">ดูงาน "${activeItem.name}" ↓</button>`
      : '';
    foot.innerHTML = `<span><strong>${formatBkkTime(active.at)} · ${activeItem ? activeItem.name : active.capability}</strong> · ${formatSec(active.durationMs)} · ${statusStr}</span>${jump}`;
    const btn = $('rhythm-sync-btn');
    if (btn && activeItem) {
      btn.addEventListener('click', () => {
        selectedCapability = activeItem.idx;
        syncCapabilitySelection(key, payload);
        $('detail-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  bindChartPointEvents(stage, coords, key, payload);
}

function renderTeamEventTimeline(key, payload) {
  const { status, history } = payload;
  const summary = $('rhythm-summary');
  const stage = $('rhythm-chart');
  const foot = $('rhythm-foot');
  const sub = $('rhythm-sub');
  const stale = status.stale;

  const singleCap = rhythmCapFilter !== 'all';
  const allEvents = [...history.events].sort((a, b) => a.at - b.at);
  const events = singleCap ? allEvents.filter((e) => e.capability === rhythmCapFilter) : allEvents;

  sub.textContent = 'ไทม์ไลน์เหตุการณ์จริงจากระบบ · รายละเอียดเวลาตอบ (วินาที) และข้อความ error ดูได้เฉพาะผู้ดูแล';

  if (!events.length) {
    const capName = singleCap ? ITEM_BY_KEY[rhythmCapFilter].name : 'AI';
    summary.innerHTML = `
      <div class="big-num">0 เหตุการณ์</div>
      <div class="sub-row"><span>ไม่พบบันทึกสำหรับงานนี้</span></div>
      <div class="track-badge is-unknown"><span class="track-dot">—</span>ไม่มีประวัติ</div>
    `;
    stage.innerHTML = `<div class="empty-chart-box"><div><strong>ยังไม่มีเหตุการณ์ "${capName}"</strong><p>สิทธิ์ทีมงานแสดงเฉพาะสถานะเหตุการณ์ที่มีอยู่จริง</p></div></div>`;
    foot.innerHTML = '<span>ลองเลือกตัวกรอง "ทั้งหมด" เพื่อดูทุกเหตุการณ์</span>';
    return;
  }

  const okCount = events.filter((e) => e.type === 'ai_ok').length;
  const errCount = events.filter((e) => e.type === 'ai_error').length;
  const badgeTone = stale ? 'is-unknown' : errCount > 0 || key === 'problem' ? 'is-warn' : '';
  const badgeWord = stale ? 'ข้อมูลเก่า' : errCount > 0 || key === 'problem' ? 'มีจุดต้องตรวจ' : 'ทำงานปกติ';

  summary.innerHTML = `
    <div class="big-num">${events.length} เหตุการณ์</div>
    <div class="sub-row">
      <span>AI สำเร็จ ${okCount}</span>
      <span class="${errCount ? 'delta-warn' : 'delta-ok'}">${errCount ? `· พลาด ${errCount}` : '· พลาด 0'}</span>
    </div>
    <div class="track-badge ${badgeTone}">
      <span class="track-dot" aria-hidden="true">${errCount ? '!' : stale ? '?' : '✓'}</span>
      ${badgeWord}
    </div>
  `;

  const W = 460;
  const H = 190;
  const padL = 94;
  const padR = 18;
  const plotW = W - padL - padR;
  const yOk = 68;
  const yErr = 122;

  const xs = assignTimelineX(events, padL, plotW);
  const coords = events.map((e, idx) => {
    const item = e.capability ? ITEM_BY_KEY[e.capability] : null;
    const isErr = e.type === 'ai_error';
    const isConn = e.type === 'connection';
    const y = e.type === 'ai_ok' ? yOk : yErr;
    return {
      ...e,
      idx,
      x: xs[idx],
      y,
      isErr,
      isConn,
      capIndex: item ? item.idx : null,
      capShort: item ? item.short : 'เชื่อมต่อ',
      capName: item ? item.name : 'เหตุการณ์เชื่อมต่อ',
    };
  });

  if (selectedPointIndex === null || !coords[selectedPointIndex]) {
    const pick = coords.findLast((c) => c.isErr || c.isConn) || coords[coords.length - 1];
    selectedPointIndex = pick ? pick.idx : 0;
  }

  const active = coords[selectedPointIndex];
  let floatPill = '';
  if (active) {
    const statusWord = active.isErr ? 'ไม่สำเร็จ' : active.isConn ? 'เชื่อมต่อ' : 'สำเร็จ';
    const pillText = `${active.capShort} · ${statusWord}`;
    const pillW = Math.max(90, pillText.length * 6.5 + 16);
    const pillX = Math.max(padL, Math.min(W - padR - pillW, active.x - pillW / 2));
    const pillY = 4;
    const guideY1 = pillY + 21;
    const guideY2 = Math.max(guideY1 + 2, active.y - 7);
    floatPill = `
      <g id="rhythm-float-pill">
        <line x1="${active.x.toFixed(1)}" y1="${guideY1}" x2="${active.x.toFixed(1)}" y2="${guideY2.toFixed(1)}" stroke="${active.isErr ? 'var(--warning)' : 'var(--accent)'}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.7"></line>
        <rect class="hover-pill-bg ${active.isErr ? 'is-error' : ''}" x="${pillX.toFixed(1)}" y="${pillY}" width="${pillW}" height="21" rx="10.5"></rect>
        <text class="hover-pill-text" x="${(pillX + pillW / 2).toFixed(1)}" y="${(pillY + 14).toFixed(1)}" text-anchor="middle">${pillText}</text>
      </g>
    `;
  }

  let lastTickX = -999;
  const dots = coords.map((pt, idx) => {
    const pressed = selectedPointIndex === idx;
    const cls = ['chart-point-dot', pt.isErr ? 'is-error' : pt.isConn || stale ? 'is-stale' : ''].filter(Boolean).join(' ');
    const statusWord = pt.isErr ? 'ไม่สำเร็จ' : pt.isConn ? 'เปลี่ยนสถานะเชื่อมต่อ' : 'สำเร็จ';
    const aria = `${formatBkkTime(pt.at)} · ${pt.capName} · ${statusWord}`;
    let tick = '';
    if (pt.x - lastTickX >= 44) {
      tick = `<text class="chart-axis-text" x="${pt.x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle">${formatBkkHm(pt.at)}</text>`;
      lastTickX = pt.x;
    }
    return `
      <line class="chart-stem" x1="${pt.x.toFixed(1)}" y1="${yOk}" x2="${pt.x.toFixed(1)}" y2="${yErr}"></line>
      <g class="chart-point-btn" role="button" tabindex="0" data-point="${idx}" aria-pressed="${pressed}" aria-label="${aria}">
        <circle class="chart-point-hit" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="14"></circle>
        <circle class="chart-point-ring" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="9.5"></circle>
        <circle class="${cls}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="5.5" style="animation-delay:${idx * 35}ms"></circle>
      </g>
      ${tick}
    `;
  }).join('');

  stage.innerHTML = `
    <svg class="rhythm-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="ไทม์ไลน์เหตุการณ์จริงสำหรับสิทธิ์ทีมงาน">
      <line class="chart-lane-line" x1="${padL}" y1="${yOk}" x2="${W - padR}" y2="${yOk}"></line>
      <line class="chart-lane-line" x1="${padL}" y1="${yErr}" x2="${W - padR}" y2="${yErr}"></line>
      <text class="chart-lane-label" x="${padL - 12}" y="${yOk + 4}" text-anchor="end">AI สำเร็จ</text>
      <text class="chart-lane-label" x="${padL - 12}" y="${yErr + 4}" text-anchor="end">พลาด/เชื่อมต่อ</text>
      ${dots}
      ${floatPill}
    </svg>
  `;

  if (active) {
    const statusWord = active.isErr ? 'ไม่สำเร็จ' : active.isConn ? 'เหตุการณ์เชื่อมต่อ' : 'สำเร็จ';
    const jump = active.capIndex !== null
      ? `<button type="button" class="chip-btn" id="rhythm-sync-btn">ดูงาน "${active.capName}" ↓</button>`
      : '';
    foot.innerHTML = `<span><strong>${formatBkkTime(active.at)} · ${active.capName}</strong> · ${statusWord} (สิทธิ์ทีมงานไม่แสดงเวลาเป็นวินาที)</span>${jump}`;
    const btn = $('rhythm-sync-btn');
    if (btn && active.capIndex !== null) {
      btn.addEventListener('click', () => {
        selectedCapability = active.capIndex;
        syncCapabilitySelection(key, payload);
        $('detail-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  bindChartPointEvents(stage, coords, key, payload);
}

function bindChartPointEvents(stage, coords, key, payload) {
  stage.querySelectorAll('.chart-point-btn').forEach((btn) => {
    const activate = () => {
      selectedPointIndex = Number(btn.dataset.point);
      const pt = coords[selectedPointIndex];
      if (pt && typeof pt.capIndex === 'number') selectedCapability = pt.capIndex;
      renderRhythmCard(key, payload);
      syncCapabilitySelection(key, payload);
      const refocused = stage.querySelector(`[data-point="${selectedPointIndex}"]`);
      if (refocused) refocused.focus();
    };
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
  });
}

function renderCapsuleBars(key, payload) {
  const el = $('capsule-chart');
  const title = $('capsule-title');
  const sub = $('capsule-sub');
  const { status } = payload;
  const admin = Array.isArray(status.calls);
  const stale = status.stale;

  if (!status.snapshot && !admin) {
    title.textContent = 'ความเร็วและสถานะ 5 งาน AI';
    sub.textContent = 'รอข้อมูลแรกจากบอท';
    el.innerHTML = '<div class="empty-chart-box" style="grid-column:1/-1"><div><strong>ยังไม่มีข้อมูลความเร็ว</strong><p>รอผลเรียกใช้ AI แรกจากบอท</p></div></div>';
    return;
  }

  if (admin) {
    const calls = status.calls;
    title.textContent = `ความเร็วเฉลี่ย 5 งาน AI (${calls.length} ครั้งล่าสุด)`;
    sub.textContent = calls.length
      ? `เฉลี่ยจาก ${calls.length} ครั้งล่าสุดที่เรียกจริง (งานที่ไม่ถูกเรียกแสดง 0 ครั้ง)`
      : 'ยังไม่มีการเรียก AI ในช่วงล่าสุด';

    if (!calls.length) {
      el.innerHTML = '<div class="empty-chart-box" style="grid-column:1/-1"><div><strong>ยังไม่มีข้อมูลความเร็ว</strong><p>รอผลเรียกใช้ AI แรกจากบอท</p></div></div>';
      return;
    }

    const byCap = ITEMS.map((item) => {
      const capCalls = calls.filter((c) => c.capability === item.key);
      if (!capCalls.length) return { item, count: 0, avgMs: null, hasErr: false };
      const avgMs = capCalls.reduce((sum, c) => sum + c.durationMs, 0) / capCalls.length;
      const latest = capCalls[0];
      return { item, count: capCalls.length, avgMs, hasErr: latest.type === 'ai_error' };
    });

    const maxAvg = Math.max(4000, ...byCap.filter((x) => x.avgMs !== null).map((x) => x.avgMs));

    el.innerHTML = byCap.map((x, i) => {
      if (x.count === 0) {
        return `
          <button type="button" class="capsule-col is-empty" data-cap-capsule="${i}" aria-pressed="${selectedCapability === i}">
            <span class="capsule-val">0 ครั้ง</span>
            <span class="capsule-track" aria-hidden="true">
              <span class="capsule-fill is-empty" style="height:0%"></span>
            </span>
            <span class="capsule-name">${x.item.short}</span>
            <span class="capsule-count">ยังไม่เรียก</span>
          </button>
        `;
      }
      const pct = Math.min(100, Math.max(18, Math.round((x.avgMs / maxAvg) * 100)));
      const fillCls = ['capsule-fill', x.hasErr ? 'is-warn' : '', stale ? 'is-stale' : ''].filter(Boolean).join(' ');
      return `
        <button type="button" class="capsule-col" data-cap-capsule="${i}" aria-pressed="${selectedCapability === i}" title="เฉลี่ย ${(x.avgMs / 1000).toFixed(1)} วิ · ${x.count} ครั้ง">
          <span class="capsule-val">${(x.avgMs / 1000).toFixed(1)} วิ</span>
          <span class="capsule-track" aria-hidden="true">
            <span class="${fillCls}" style="height:${pct}%;animation-delay:${i * 55}ms"></span>
          </span>
          <span class="capsule-name">${x.item.short}</span>
          <span class="capsule-count">${x.count} ครั้ง</span>
        </button>
      `;
    }).join('');
  } else {
    title.textContent = 'สถานะล่าสุด 5 งาน AI';
    sub.textContent = 'อ้างอิงสถานะล่าสุดที่รายงาน (สิทธิ์ทีมงานไม่แสดงเวลาเป็นวินาที)';
    const snap = status.snapshot;
    if (!snap) {
      el.innerHTML = '<div class="empty-chart-box" style="grid-column:1/-1"><div><strong>ยังไม่มีข้อมูลงาน AI</strong><p>รอผลเรียกใช้ AI แรกจากบอท</p></div></div>';
      return;
    }

    el.innerHTML = ITEMS.map((item, i) => {
      const m = snap.models.find((x) => x.capability === item.key);
      if (!m || !m.lastAt) {
        return `
          <button type="button" class="capsule-col is-empty" data-cap-capsule="${i}" aria-pressed="${selectedCapability === i}">
            <span class="capsule-val">—</span>
            <span class="capsule-track" aria-hidden="true">
              <span class="capsule-fill is-empty" style="height:0%"></span>
            </span>
            <span class="capsule-name">${item.short}</span>
            <span class="capsule-count">ยังไม่เรียก</span>
          </button>
        `;
      }
      const isErr = m.lastResult === 'error';
      const pct = isErr ? 78 : stale ? 56 : 88;
      const fillCls = ['capsule-fill', isErr ? 'is-warn' : '', stale ? 'is-stale' : ''].filter(Boolean).join(' ');
      const rel = formatShortAge(status.now - m.lastAt);
      const valText = stale ? 'เก่า' : isErr ? 'พลาด' : 'พร้อม';
      return `
        <button type="button" class="capsule-col" data-cap-capsule="${i}" aria-pressed="${selectedCapability === i}">
          <span class="capsule-val">${valText}</span>
          <span class="capsule-track" aria-hidden="true">
            <span class="${fillCls}" style="height:${pct}%;animation-delay:${i * 55}ms"></span>
          </span>
          <span class="capsule-name">${item.short}</span>
          <span class="capsule-count">${rel}</span>
        </button>
      `;
    }).join('');
  }

  el.querySelectorAll('[data-cap-capsule]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCapability = Number(btn.dataset.capCapsule);
      syncCapabilitySelection(key, payload);
    });
  });
}

function renderComplexTable(key, payload) {
  const { status } = payload;
  const snap = status.snapshot;
  const admin = Array.isArray(status.calls);
  const stale = status.stale;
  const q = searchQuery.trim().toLowerCase();

  $('table-col4-head').textContent = admin ? 'เวลาตอบล่าสุด' : 'เรียกใช้ล่าสุด';

  const visible = ITEMS.map((item, idx) => ({ item, idx })).filter(({ item }) => {
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.requestedModel.toLowerCase().includes(q) ||
      item.groupName.toLowerCase().includes(q) ||
      'openai'.includes(q)
    );
  });

  $('table-count-chip').textContent = q ? `พบ ${visible.length}/5` : '5 ความสามารถ';

  if (!visible.length) {
    $('complex-table-body').innerHTML = `<tr><td colspan="4">ไม่พบงานหรือโมเดลที่ตรงกับ "${q}"</td></tr>`;
    return;
  }

  $('complex-table-body').innerHTML = visible.map(({ item, idx }) => {
    const modelInfo = snap ? snap.models.find((m) => m.capability === item.key) : null;
    const isUnknown = !snap || !modelInfo || modelInfo.lastResult === null;
    const isErr = modelInfo?.lastResult === 'error';
    const statusDot = isUnknown || stale ? '' : isErr ? 'is-warn' : 'is-ok';
    const statusGlyph = isUnknown || stale ? '?' : isErr ? '!' : '✓';
    const statusWord = !snap ? 'รอข้อมูล' : isUnknown ? 'ยังไม่เรียก' : stale ? 'ข้อมูลเก่า' : isErr ? 'ไม่สำเร็จ' : 'สำเร็จ';

    let col4Html = '—';
    if (admin) {
      const latestCall = status.calls.find((c) => c.capability === item.key);
      if (latestCall) {
        const pct = Math.min(100, Math.max(14, Math.round((latestCall.durationMs / item.refMs) * 100)));
        const fillCls = ['prog-fill', latestCall.type === 'ai_error' ? 'is-warn' : '', stale ? 'is-stale' : ''].filter(Boolean).join(' ');
        col4Html = `
          <div class="prog-wrap">
            <span class="prog-track" aria-hidden="true">
              <span class="${fillCls}" style="width:${pct}%;animation-delay:${idx * 50}ms"></span>
            </span>
            <span>${formatSec(latestCall.durationMs)}</span>
          </div>
        `;
      } else {
        col4Html = '<span style="color:var(--muted-label)">ยังไม่ถูกเรียก</span>';
      }
    } else if (modelInfo?.lastAt) {
      col4Html = `<span>${formatBkkTime(modelInfo.lastAt)} <small style="color:var(--muted-label)">(${formatShortAge(status.now - modelInfo.lastAt)})</small></span>`;
    } else {
      col4Html = '<span style="color:var(--muted-label)">ยังไม่ถูกเรียก</span>';
    }

    return `
      <tr class="cap-row" data-row-cap="${idx}" aria-selected="${selectedCapability === idx}">
        <td>
          <button type="button" class="cap-row-btn" data-btn-cap="${idx}">
            <i class="fi fi-${item.icon}" style="color:var(--accent)" aria-hidden="true"></i>
            <span>${item.name}</span>
          </button>
        </td>
        <td>
          <span class="status-inline">
            <span class="status-badge-dot ${statusDot}" aria-hidden="true">${statusGlyph}</span>
            ${statusWord}
          </span>
        </td>
        <td>${!snap ? 'ยังไม่ทราบ' : `${modelInfo?.provider || 'openai'} · ${modelInfo?.responseModel || modelInfo?.requestedModel || item.requestedModel}`}</td>
        <td>${col4Html}</td>
      </tr>
    `;
  }).join('');

  $('complex-table-body').querySelectorAll('[data-row-cap]').forEach((row) => {
    row.addEventListener('click', () => {
      selectedCapability = Number(row.dataset.rowCap);
      syncCapabilitySelection(key, payload);
    });
  });
}

function renderDailyTraffic(key, payload) {
  const { status, history } = payload;
  const stat = $('traffic-stat');
  const bars = $('traffic-bars');
  const badge = $('traffic-badge');

  if (!status.snapshot && !history.events.length) {
    badge.textContent = 'รอข้อมูล';
    stat.innerHTML = '<strong>0</strong><span>เหตุการณ์ (7 ชม.ล่าสุด)</span>';
    bars.innerHTML = '<div class="empty-chart-box" style="grid-column:1/-1;min-height:130px">รอเหตุการณ์แรก</div>';
    return;
  }

  const anchorHour = Math.floor((ANCHOR_NOW + UTC_OFFSET_SEC) / 3600) * 3600 - UTC_OFFSET_SEC;
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const start = anchorHour - (6 - i) * 3600;
    return { start, end: start + 3600, label: formatBkkHm(start), ok: 0, err: 0 };
  });

  history.events.forEach((ev) => {
    const b = buckets.find((slot) => ev.at >= slot.start && ev.at < slot.end);
    if (!b) return;
    const isErr = ev.type === 'ai_error' || (ev.type === 'connection' && ev.state === 'close');
    if (isErr) b.err += 1;
    else b.ok += 1;
  });

  const totalInWindow = buckets.reduce((sum, b) => sum + b.ok + b.err, 0);
  const maxTotal = Math.max(1, ...buckets.map((b) => b.ok + b.err));
  const stackMaxPx = 124;

  badge.textContent = status.stale ? 'ข้อมูลเก่า' : '7 ชม.ล่าสุด';
  stat.innerHTML = `<strong>${totalInWindow}</strong><span>เหตุการณ์รวม (AI + เชื่อมต่อ)</span>`;

  bars.innerHTML = buckets.map((b, idx) => {
    const total = b.ok + b.err;
    if (total === 0) {
      return `
        <div class="t-col" title="${b.label}: 0 เหตุการณ์">
          <span class="t-count"></span>
          <div class="t-bar-stack"><span class="t-bar-empty"></span></div>
          <span class="t-time">${b.label}</span>
        </div>
      `;
    }
    const barTotalPx = Math.max(18, Math.round((total / maxTotal) * stackMaxPx));
    let errPx = b.err > 0 ? Math.max(8, Math.round((b.err / total) * barTotalPx)) : 0;
    let okPx = b.ok > 0 ? Math.max(8, barTotalPx - errPx) : 0;
    if (errPx + okPx > stackMaxPx) {
      if (errPx > okPx) errPx = stackMaxPx - okPx;
      else okPx = stackMaxPx - errPx;
    }
    return `
      <div class="t-col" title="${b.label}: ปกติ ${b.ok} · มีปัญหา/หลุด ${b.err}">
        <span class="t-count">${total}</span>
        <div class="t-bar-stack">
          ${errPx > 0 ? `<span class="t-bar-err" style="height:${errPx}px;animation-delay:${idx * 55}ms"></span>` : ''}
          ${okPx > 0 ? `<span class="t-bar-ok" style="height:${okPx}px;animation-delay:${idx * 55}ms"></span>` : ''}
        </div>
        <span class="t-time">${b.label}</span>
      </div>
    `;
  }).join('');
}

function renderPieCard(key, payload) {
  const { status } = payload;
  const ring = $('pie-ring');
  const stats = $('pie-stats');
  const badge = $('pie-badge');
  const snap = status.snapshot;

  if (!snap) {
    badge.textContent = 'รอข้อมูล';
    ring.innerHTML = `
      <svg class="pie-svg" viewBox="0 0 138 138" aria-hidden="true">
        <circle class="pie-track" cx="69" cy="69" r="50"></circle>
      </svg>
      <div class="pie-middle"><strong>—</strong><span>รอข้อมูล</span></div>
    `;
    stats.innerHTML = `
      <div class="pie-stat"><span><i class="dot-swatch" style="background:var(--wood)"></i> รอทำ</span><strong>—</strong></div>
      <div class="pie-sep" aria-hidden="true"></div>
      <div class="pie-stat"><span><i class="dot-swatch" style="background:var(--accent)"></i> กำลังทำ</span><strong>—</strong></div>
      <div class="pie-age"><span>งานค้างนานสุด</span><strong>ยังไม่มีข้อมูล</strong></div>
    `;
    return;
  }

  const qMap = Object.fromEntries(snap.queues.map((q) => [q.name, q]));
  const qMain = qMap.main || { waiting: 0, running: 0, oldestAt: null };
  const qMedia = qMap.media || { waiting: 0, running: 0, oldestAt: null };
  const qRender = qMap.render || { waiting: 0, running: 0, oldestAt: null };

  const waitingTotal = snap.queues.reduce((sum, q) => sum + q.waiting, 0);
  const runningTotal = snap.queues.reduce((sum, q) => sum + q.running, 0);
  const inFlightTotal = waitingTotal + runningTotal;
  const oldestAts = snap.queues.map((q) => q.oldestAt).filter((v) => typeof v === 'number');
  const oldestAt = oldestAts.length ? Math.min(...oldestAts) : null;
  const oldestText = oldestAt === null ? 'ไม่มีงานค้าง' : `${formatAge(Math.max(0, status.now - oldestAt))} (${formatBkkTime(oldestAt)})`;

  badge.textContent = status.stale ? 'ข้อมูลเก่า' : inFlightTotal === 0 ? 'ว่าง' : `ในคิว ${inFlightTotal}`;

  const r = 50;
  const circ = 2 * Math.PI * r;
  let segs = '';
  const waitColor = key === 'problem' ? 'var(--warning)' : 'var(--wood)';
  if (inFlightTotal === 0) {
    segs = `<circle class="pie-seg" cx="69" cy="69" r="${r}" stroke="var(--ok)" stroke-dasharray="${circ.toFixed(1)}" style="--ring-circ:${circ.toFixed(1)};--ring-offset:0"></circle>`;
  } else {
    const waitLen = (waitingTotal / inFlightTotal) * circ;
    const runLen = (runningTotal / inFlightTotal) * circ;
    if (waitingTotal > 0) {
      segs += `<circle class="pie-seg" cx="69" cy="69" r="${r}" stroke="${waitColor}" stroke-dasharray="${waitLen.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="0" style="--ring-circ:${circ.toFixed(1)};--ring-offset:0"></circle>`;
    }
    if (runningTotal > 0) {
      segs += `<circle class="pie-seg" cx="69" cy="69" r="${r}" stroke="var(--accent)" stroke-dasharray="${runLen.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-waitLen).toFixed(1)}" style="--ring-circ:${circ.toFixed(1)};--ring-offset:${(-waitLen).toFixed(1)}"></circle>`;
    }
  }

  ring.innerHTML = `
    <svg class="pie-svg" viewBox="0 0 138 138" role="img" aria-label="สัดส่วนงานที่รอและกำลังทำในคิว">
      <circle class="pie-track" cx="69" cy="69" r="${r}"></circle>
      ${segs}
    </svg>
    <div class="pie-middle"><strong>${inFlightTotal}</strong><span>${inFlightTotal === 0 ? 'คิวว่าง' : 'รอ + กำลังทำ'}</span></div>
  `;

  stats.innerHTML = `
    <div class="pie-stat">
      <span><i class="dot-swatch" style="background:${waitColor}"></i> รอทำ</span>
      <strong>${waitingTotal} งาน</strong>
      <small class="pie-sub">main ${qMain.waiting} · ภาพ ${qMedia.waiting + qRender.waiting}</small>
    </div>
    <div class="pie-sep" aria-hidden="true"></div>
    <div class="pie-stat">
      <span><i class="dot-swatch" style="background:var(--accent)"></i> กำลังทำ</span>
      <strong>${runningTotal} งาน</strong>
      <small class="pie-sub">main ${qMain.running} · ภาพ ${qMedia.running + qRender.running}</small>
    </div>
    <div class="pie-age">
      <span>งานค้างนานสุด</span>
      <strong>${oldestText}</strong>
    </div>
  `;
}

function renderDetailCard(key, payload) {
  const { raw, status } = payload;
  const snap = status.snapshot;
  const stale = status.stale;
  const admin = isAdmin();
  const item = ITEMS[selectedCapability];
  const modelInfo = snap ? snap.models.find((m) => m.capability === item.key) : null;
  const unknown = !snap || !modelInfo || modelInfo.lastResult === null;
  const isErr = modelInfo?.lastResult === 'error';

  const resultText = !snap
    ? 'ยังไม่มีข้อมูล'
    : unknown
      ? 'ยังไม่เคยถูกเรียก'
      : stale
        ? 'ครั้งก่อนสำเร็จ · ข้อมูลเก่า'
        : isErr
          ? 'ครั้งล่าสุดไม่สำเร็จ'
          : 'ครั้งล่าสุดสำเร็จ';
  const pillCls = unknown || stale ? '' : isErr ? 'is-warn' : 'is-ok';

  let queueText = 'ยังไม่ทราบ';
  if (snap) {
    const q = snap.queues.find((x) => x.name === item.queueKey);
    const qWait = q ? q.waiting : 0;
    const qRun = q ? q.running : 0;
    queueText = stale ? `เก่า: ${qWait} รอ · ${qRun} ทำ` : `${qWait} รอ · ${qRun} กำลังทำ`;
  }

  const respNote = !snap
    ? 'ยังไม่มีผลตอบกลับจากบริการ AI'
    : !modelInfo || !modelInfo.lastAt
      ? 'ยังไม่มีผลเรียกใช้สำหรับความสามารถนี้'
      : modelInfo.responseModel
        ? `โมเดลจากผลตอบกลับ: ${modelInfo.responseModel}`
        : 'ยังไม่มีชื่อโมเดลยืนยันจากผลตอบกลับ';

  const latestCall = admin && Array.isArray(status.calls)
    ? status.calls.find((c) => c.capability === item.key)
    : null;
  const adminHint = admin && latestCall && latestCall.type === 'ai_error'
    ? ` · ผู้ดูแล: ${latestCall.error} (${formatSec(latestCall.durationMs)})`
    : admin && latestCall
      ? ` · ล่าสุด ${formatSec(latestCall.durationMs)}`
      : '';

  const lastTimeText = modelInfo?.lastAt ? formatBkkDateTime(modelInfo.lastAt) : 'ยังไม่ทราบเวลา';

  $('detail-card').innerHTML = `
    <div class="card-head">
      <div>
        <h2>${item.name}</h2>
        <p>ผลการใช้ AI ล่าสุด · ${lastTimeText}</p>
      </div>
      <span class="status-pill ${pillCls}">${resultText}</span>
    </div>
    <div class="facts">
      <div class="fact-box"><span>ผู้ให้บริการ</span><strong>${!snap ? 'ยังไม่ทราบ' : modelInfo?.provider || 'openai'}</strong></div>
      <div class="fact-box"><span>โมเดลที่ขอใช้</span><strong>${!snap ? 'ยังไม่ทราบ' : modelInfo?.requestedModel || item.requestedModel}</strong></div>
      <div class="fact-box"><span>คิว ${item.queueLabel}</span><strong>${queueText}</strong></div>
      <div class="fact-box"><span>หมายเหตุหลักฐาน</span><strong>${respNote}${adminHint}</strong></div>
    </div>
    <div class="guidance-callout">
      <div>
        <strong>${raw.advice}</strong>
        <p>${raw.note}</p>
      </div>
      <button type="button" class="button" id="detail-advice-btn"${!snap || key === 'healthy' ? ' hidden' : ''}>สิ่งที่ควรตรวจ →</button>
    </div>
  `;

  const btn = $('detail-advice-btn');
  if (btn) btn.addEventListener('click', openGuidanceDialog);
}

function formatEventDisplay(ev, admin) {
  const capItem = ev.capability ? ITEM_BY_KEY[ev.capability] : null;
  const capLabel = capItem ? capItem.name : 'การเชื่อมต่อ';
  if (ev.type === 'connection') {
    const [label, cls] = ev.state !== undefined ? connStateLabel(ev.state) : ['เปลี่ยนสถานะเชื่อมต่อ', ''];
    const ok = ev.state !== 'close';
    const detail = ev.state !== undefined
      ? (ev.state === 'close' ? 'สถานะที่บอทรายงานล่าสุด' : 'ได้รับสัญญาณเชื่อมต่อ')
      : 'สิทธิ์ทีมงานแสดงเฉพาะเวลาเหตุการณ์';
    const adminHint = admin && ev.error ? `รายละเอียดผู้ดูแล: ${ev.error}` : 'บันทึกการเชื่อมต่อ WhatsApp';
    return { ok, cls, label, cap: capLabel, detail, adminHint, kind: 'connection' };
  }
  const ok = ev.type === 'ai_ok';
  const label = ok ? 'AI ทำงานสำเร็จ' : 'AI ทำงานไม่สำเร็จ';
  const detail = ev.durationMs !== undefined
    ? `ใช้เวลา ${formatSec(ev.durationMs)} · ${ev.responseModel || ev.requestedModel || ''}`.trim()
    : 'สิทธิ์ทีมงานแสดงเฉพาะสถานะผลลัพธ์';
  const adminHint = admin
    ? (ev.error ? `สาเหตุ (ผู้ดูแล): ${ev.error}` : `${ev.provider || 'openai'} · ปกติ`)
    : '';
  return { ok, cls: ok ? 'is-ok' : 'is-warn', label, cap: capLabel, detail, adminHint, kind: 'ai' };
}

function renderRecentCard(key, payload) {
  const el = $('recent-events');
  const events = payload.history.events;
  const admin = isAdmin();
  if (!events.length) {
    el.innerHTML = '<div class="empty-chart-box" style="min-height:130px">ยังไม่มีบันทึกเหตุการณ์</div>';
    return;
  }
  el.innerHTML = events.slice(0, 4).map((ev) => {
    const d = formatEventDisplay(ev, admin);
    return `
      <div class="event-row">
        <span class="status-badge-dot ${d.ok ? 'is-ok' : 'is-warn'}" aria-hidden="true">${d.ok ? '✓' : '!'}</span>
        <div>
          <strong>${d.label} · ${d.cap}</strong>
          <span>${formatBkkDateTime(ev.at)} · ${d.detail}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTeamPreview() {
  $('team-preview').innerHTML = membersList.slice(0, 3).map((m) => `
    <div class="member-mini">
      <div class="member-avatar" aria-hidden="true">${m.name.charAt(0)}</div>
      <div>
        <strong>${m.name}</strong>
        <small>${m.role === 'admin' ? 'ผู้ดูแล (Admin)' : 'ทีมงาน (Member)'} · ${m.email}</small>
      </div>
    </div>
  `).join('');
}

function syncCapabilitySelection(key, payload) {
  document.querySelectorAll('[data-cap-capsule]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.capCapsule) === selectedCapability));
  });
  document.querySelectorAll('[data-row-cap]').forEach((r) => {
    r.setAttribute('aria-selected', String(Number(r.dataset.rowCap) === selectedCapability));
  });
  renderDetailCard(key, payload);
}

function renderHistoryView(key, payload) {
  const filters = [['all', 'ทั้งหมด'], ['ai', 'งาน AI'], ['connection', 'การเชื่อมต่อ'], ['error', 'เฉพาะที่มีปัญหา']];
  $('history-filters').innerHTML = filters.map(([id, label]) => `
    <button type="button" class="pill-filter" data-filter="${id}" aria-pressed="${historyFilter === id}">${label}</button>
  `).join('');

  $('history-filters').querySelectorAll('.pill-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      historyFilter = btn.dataset.filter;
      renderHistoryView(key, payload);
    });
  });

  const admin = isAdmin();
  const q = searchQuery.trim().toLowerCase();
  const rows = payload.history.events.map((ev) => ({
    raw: ev,
    ...formatEventDisplay(ev, admin),
  })).filter((row) => {
    if (historyFilter === 'ai' && row.kind !== 'ai') return false;
    if (historyFilter === 'connection' && row.kind !== 'connection') return false;
    if (historyFilter === 'error' && row.ok) return false;
    if (!q) return true;
    return (
      row.label.toLowerCase().includes(q) ||
      row.cap.toLowerCase().includes(q) ||
      row.detail.toLowerCase().includes(q)
    );
  });

  $('history-count-chip').textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    $('history-rows').innerHTML = `<tr><td colspan="4">ไม่พบเหตุการณ์${q ? `ที่ตรงกับ "${q}"` : ''}</td></tr>`;
  } else {
    $('history-rows').innerHTML = rows.map((row) => `
      <tr>
        <td>${formatBkkDateTime(row.raw.at)}</td>
        <td><span class="status-pill ${row.ok ? 'is-ok' : 'is-warn'}">${row.label}</span></td>
        <td>${row.cap}</td>
        <td>${row.detail}${admin && row.adminHint ? `<br><small style="color:var(--secondary)">${row.adminHint}</small>` : ''}</td>
      </tr>
    `).join('');
  }

  $('history-note').textContent = admin
    ? 'ผู้ดูแลเห็นเวลาตอบ (ms), ชื่อโมเดล และสาเหตุ error ครบตาม /api/history'
    : 'มุมมองทีมงานถูกปิดข้อมูลละเอียด (ดูได้เฉพาะประเภท เวลา และความสามารถตามสิทธิ์จริง)';
}

function renderSettingsView() {
  if (!isAdmin()) {
    $('settings-content').innerHTML = `
      <section class="bento-card">
        <h2>สิทธิ์ผู้ดูแลเท่านั้น</h2>
        <p class="panel-note">บัญชีระดับทีมงานสามารถดูภาพรวมและประวัติการทำงานได้ แต่การพักอีเมลแจ้งเตือนและบันทึกผู้ดูแลสงวนไว้สำหรับผู้ดูแลเท่านั้น</p>
      </section>
    `;
    return;
  }

  const pauseMsg = pauseState.minutes > 0
    ? `กำลังพักแจ้งเตือน ${pauseState.minutes} นาที (ตัวอย่างถึง ${pauseState.untilLabel}) โดย ${pauseState.actor}`
    : 'กำลังใช้เงื่อนไขแจ้งเตือนตามปกติ';
  const fb = settingsFeedback
    ? `<div class="feedback-msg ${settingsFeedback.warn ? 'is-warn' : ''}">${settingsFeedback.text}</div>`
    : '';

  $('settings-content').innerHTML = `
    <div class="admin-grid">
      <section class="bento-card">
        <h2>พักอีเมลแจ้งเตือนชั่วคราว</h2>
        <p>${pauseMsg}</p>
        <div class="form-row">
          <select id="pause-duration" aria-label="ระยะเวลาพักแจ้งเตือน">
            <option value="30">30 นาที</option>
            <option value="60" selected>1 ชั่วโมง</option>
            <option value="240">4 ชั่วโมง</option>
          </select>
          <button type="button" class="button button-primary" id="pause-apply">พักแจ้งเตือน</button>
          <button type="button" class="button" id="pause-resume" ${pauseState.minutes === 0 ? 'disabled' : ''}>กลับมาแจ้งตอนนี้</button>
        </div>
        ${fb}
        <p class="panel-note">ขณะพัก เว็บยังแสดงปัญหาจริง เมื่อหมดเวลา หากปัญหายังเข้าเงื่อนไขจะกลับมาแจ้งเอง</p>
      </section>

      <section class="bento-card">
        <h2>สถานะการส่งอีเมลแจ้งเตือน</h2>
        <p><span class="status-pill is-ok">เปิดส่งอีเมลแล้ว</span></p>
        <p class="panel-note">รอส่ง 0 รายการ · ส่งไม่สำเร็จและรอลองใหม่ 0 รายการ</p>
        <p class="panel-note">กติกา: ปัญหาต่อเนื่องครบ 5 นาทีแจ้งครั้งแรก · เตือนซ้ำทุก 1 ชั่วโมง · เหตุที่ต้องให้คนช่วยแจ้งทันที</p>
      </section>
    </div>

    <section class="bento-card">
      <h2>ประวัติผู้ดูแล (เก็บย้อนหลัง 30 วัน)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>เวลา (Bangkok)</th><th>ผู้ดำเนินการ</th><th>รายการ</th></tr></thead>
          <tbody>
            ${auditLog.map((a) => `<tr><td>${a.at}</td><td>${a.actor}</td><td>${a.summary}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  $('pause-apply').addEventListener('click', () => {
    const mins = Number($('pause-duration').value);
    const labelMap = { 30: '13:50:00', 60: '14:20:00', 240: '17:20:00' };
    pauseState = { minutes: mins, untilLabel: labelMap[mins] || '14:20:00', actor: 'Nok' };
    auditLog.unshift({ at: '16 พ.ย. 13:20:00', actor: 'nok@example.com', summary: `พักแจ้งเตือน ${mins} นาที` });
    settingsFeedback = { text: `พักอีเมลแจ้งเตือน ${mins} นาทีเรียบร้อยแล้ว`, warn: false };
    renderAll();
  });

  $('pause-resume').addEventListener('click', () => {
    pauseState = { minutes: 0, untilLabel: null, actor: null };
    auditLog.unshift({ at: '16 พ.ย. 13:21:00', actor: 'nok@example.com', summary: 'กลับมาแจ้งเตือนตามปกติ' });
    settingsFeedback = { text: 'กลับมาเปิดอีเมลแจ้งเตือนตามปกติแล้ว', warn: false };
    renderAll();
  });
}

function renderMembersView() {
  if (!isAdmin()) {
    $('members-content').innerHTML = `
      <section class="bento-card">
        <h2>บัญชีของคุณ: ทีมงาน (Member)</h2>
        <p class="panel-note">การเพิ่ม ลบ หรือเปลี่ยนสิทธิ์บัญชีอื่นทำได้เฉพาะผู้ดูแลเท่านั้น</p>
      </section>
    `;
    return;
  }

  const fb = membersFeedback
    ? `<div class="feedback-msg ${membersFeedback.warn ? 'is-warn' : ''}">${membersFeedback.text}</div>`
    : '';

  $('members-content').innerHTML = `
    <section class="bento-card" style="margin-bottom:20px">
      <h2>เพิ่มบัญชีเข้า Warroom</h2>
      <p class="panel-note">ใช้บัญชี Google ที่อนุญาตไว้ล่วงหน้าเท่านั้น (ข้อมูลในหน้านี้เป็นชื่อและอีเมลสมมติ)</p>
      <div class="form-row">
        <input type="email" id="new-member-email" placeholder="example@example.com" aria-label="อีเมลสมาชิกใหม่">
        <select id="new-member-role" aria-label="สิทธิ์สมาชิกใหม่">
          <option value="member">ทีมงาน</option>
          <option value="admin">ผู้ดูแล</option>
        </select>
        <button type="button" class="button button-primary" id="add-member-btn">เพิ่มสมาชิก</button>
      </div>
      ${fb}
    </section>

    <section class="bento-card">
      <h2>รายชื่อสมาชิก (${membersList.length} บัญชี)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>สิทธิ์</th><th>จัดการ</th></tr></thead>
          <tbody>
            ${membersList.map((m, idx) => `
              <tr>
                <td><strong>${m.name}</strong></td>
                <td>${m.email}</td>
                <td><span class="status-pill ${m.role === 'admin' ? 'is-ok' : ''}">${m.role === 'admin' ? 'ผู้ดูแล' : 'ทีมงาน'}</span></td>
                <td>
                  <button type="button" class="button btn-small" data-toggle-member="${idx}">สลับเป็น${m.role === 'admin' ? 'ทีมงาน' : 'ผู้ดูแล'}</button>
                  <button type="button" class="button btn-small" data-remove-member="${idx}">ถอดสิทธิ์</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  $('add-member-btn').addEventListener('click', () => {
    const email = $('new-member-email').value.trim().toLowerCase();
    const role = $('new-member-role').value;
    if (!email || !email.includes('@')) {
      membersFeedback = { text: 'กรุณาใส่อีเมลให้ถูกต้อง', warn: true };
      renderMembersView();
      return;
    }
    if (membersList.some((m) => m.email === email)) {
      membersFeedback = { text: 'อีเมลนี้อยู่ในรายชื่อแล้ว', warn: true };
      renderMembersView();
      return;
    }
    const local = email.split('@')[0];
    membersList.push({ email, name: local.charAt(0).toUpperCase() + local.slice(1), role });
    auditLog.unshift({ at: '16 พ.ย. 13:22:00', actor: 'nok@example.com', summary: `ตั้งสิทธิ์สมาชิก · ${email}` });
    membersFeedback = { text: `เพิ่ม ${email} เรียบร้อยแล้ว`, warn: false };
    renderMembersView();
    renderTeamPreview();
  });

  document.querySelectorAll('[data-toggle-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = membersList[Number(btn.dataset.toggleMember)];
      const adminCount = membersList.filter((m) => m.role === 'admin').length;
      if (target.role === 'admin' && adminCount <= 1) {
        membersFeedback = { text: 'ต้องมีผู้ดูแลอย่างน้อยหนึ่งคน จึงเปลี่ยนสิทธิ์หรือลบบัญชีนี้ไม่ได้', warn: true };
        renderMembersView();
        return;
      }
      target.role = target.role === 'admin' ? 'member' : 'admin';
      membersFeedback = { text: `เปลี่ยนสิทธิ์ของ ${target.email} แล้ว`, warn: false };
      renderMembersView();
      renderTeamPreview();
    });
  });

  document.querySelectorAll('[data-remove-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.removeMember);
      const target = membersList[idx];
      const adminCount = membersList.filter((m) => m.role === 'admin').length;
      if (target.role === 'admin' && adminCount <= 1) {
        membersFeedback = { text: 'ต้องมีผู้ดูแลอย่างน้อยหนึ่งคน จึงเปลี่ยนสิทธิ์หรือลบบัญชีนี้ไม่ได้', warn: true };
        renderMembersView();
        return;
      }
      membersList.splice(idx, 1);
      membersFeedback = { text: `ถอดสิทธิ์ ${target.email} แล้ว`, warn: false };
      renderMembersView();
      renderTeamPreview();
    });
  });
}

function renderChrome(key, payload) {
  const admin = isAdmin();
  const { status } = payload;
  $('account-label').textContent = admin ? 'Nok · ผู้ดูแล' : 'Somchai · ทีมงาน';
  $('avatar-badge').textContent = admin ? 'N' : 'S';
  $('nav-settings-sub').textContent = admin ? 'พักเตือนและสถานะอีเมล' : 'เฉพาะผู้ดูแล';
  $('nav-members-sub').textContent = admin ? 'บัญชีทีมและผู้ดูแล' : 'ดูสิทธิ์ของคุณ';
  $('breadcrumb').textContent = VIEW_HEADERS[activeView][0];
  $('page-title').textContent = VIEW_HEADERS[activeView][1];
  $('updated').textContent = !status.receivedAt
    ? 'ยังไม่ได้รับสถานะ'
    : status.stale
      ? `ข้อมูลเก่า · ล่าสุด ${formatBkkTime(status.receivedAt)}`
      : `รับสถานะล่าสุด ${formatBkkTime(status.receivedAt)}`;

  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    if (btn.dataset.view === activeView) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  $('view-overview').hidden = activeView !== 'overview';
  $('view-history').hidden = activeView !== 'history';
  $('view-settings').hidden = activeView !== 'settings';
  $('view-members').hidden = activeView !== 'members';

  const paused = pauseState.minutes > 0;
  $('pause-banner').hidden = !paused;
  $('alerts-dot').hidden = !(paused || status.incidents.length > 0);
  if (paused) {
    $('pause-banner-title').textContent = `กำลังพักอีเมลแจ้งเตือน ${pauseState.minutes} นาที (ถึง ${pauseState.untilLabel})`;
    $('pause-banner-desc').textContent = `พักโดย ${pauseState.actor} · เว็บยังแสดงปัญหาจริง และจะกลับมาแจ้งเตือนอัตโนมัติเมื่อครบเวลา`;
    $('pause-resume-quick').hidden = !admin;
  }
}

function getCurrentPayload() {
  return buildMockApiPayloads($('scenario').value, $('role').value);
}

function renderAll() {
  const key = $('scenario').value;
  const payload = getCurrentPayload();

  if (lastScenarioRendered !== key) {
    selectedPointIndex = null;
    rhythmCapFilter = 'all';
    selectedCapability = payload.raw.defaultCapability ?? 0;
    lastScenarioRendered = key;
  }

  document.body.dataset.state = key;
  renderChrome(key, payload);
  renderKpis(key, payload);
  renderRhythmCard(key, payload);
  renderCapsuleBars(key, payload);
  renderComplexTable(key, payload);
  renderDailyTraffic(key, payload);
  renderPieCard(key, payload);
  renderDetailCard(key, payload);
  renderRecentCard(key, payload);
  renderTeamPreview();
  renderHistoryView(key, payload);
  renderSettingsView();
  renderMembersView();
}

function switchView(viewName) {
  activeView = viewName;
  renderChrome($('scenario').value, getCurrentPayload());
}

const compactSidebar = window.matchMedia('(max-width: 1020px)');
const sidebarPreferenceKey = 'warroom-horizon-sidebar';
const sidebarToggle = $('sidebar-toggle');
let sidebarPreference;
try {
  const saved = localStorage.getItem(sidebarPreferenceKey);
  if (saved === 'collapsed' || saved === 'expanded') sidebarPreference = saved;
} catch {
  // Keep the automatic layout when browser storage is unavailable.
}

function renderSidebar() {
  const collapsed = sidebarPreference ? sidebarPreference === 'collapsed' : compactSidebar.matches;
  $('horizon-shell').dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู';
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.title = label;
}

sidebarToggle.addEventListener('click', () => {
  sidebarPreference = sidebarToggle.getAttribute('aria-expanded') === 'true' ? 'collapsed' : 'expanded';
  try { localStorage.setItem(sidebarPreferenceKey, sidebarPreference); } catch { /* Keep the current choice. */ }
  renderSidebar();
});
compactSidebar.addEventListener('change', renderSidebar);
renderSidebar();

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}

function openGuidanceDialog() {
  const key = $('scenario').value;
  const payload = getCurrentPayload();
  $('dialog-description').textContent = payload.raw.note;
  const steps = key === 'ai'
    ? ['ตรวจอินเทอร์เน็ตบนเครื่องบอท', 'ให้ผู้ดูแลตรวจรายละเอียดการเรียก AI', 'รอดูผลเรียกครั้งต่อไป']
    : ['ตรวจว่าเครื่องบอทเปิดอยู่และมีอินเทอร์เน็ต', 'ตรวจ WhatsApp และอุปกรณ์ที่ลิงก์', 'หากยังมีปัญหา ให้ผู้ดูแลตรวจบันทึก'];
  $('steps').innerHTML = steps.map((x) => `<li>${x}</li>`).join('');
  $('dialog-pause').hidden = !isAdmin();
  $('dialog').showModal();
}

document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

$('goto-history-btn').addEventListener('click', () => switchView('history'));
$('goto-members-btn').addEventListener('click', () => switchView('members'));
$('quick-alerts').addEventListener('click', () => switchView('settings'));
$('quick-help').addEventListener('click', openGuidanceDialog);

$('quick-theme').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  $('theme').value = next;
  applyTheme(next);
});

$('avatar-badge').addEventListener('click', () => {
  $('role').value = isAdmin() ? 'member' : 'admin';
  settingsFeedback = null;
  membersFeedback = null;
  selectedPointIndex = null;
  renderAll();
});

$('search-input').addEventListener('input', (ev) => {
  searchQuery = ev.target.value;
  const key = $('scenario').value;
  const payload = getCurrentPayload();
  renderComplexTable(key, payload);
  renderHistoryView(key, payload);
});

$('pause-resume-quick').addEventListener('click', () => {
  pauseState = { minutes: 0, untilLabel: null, actor: null };
  auditLog.unshift({ at: '16 พ.ย. 13:21:00', actor: 'nok@example.com', summary: 'กลับมาแจ้งเตือนตามปกติ' });
  settingsFeedback = { text: 'กลับมาเปิดอีเมลแจ้งเตือนตามปกติแล้ว', warn: false };
  renderAll();
});

$('scenario').addEventListener('change', renderAll);
$('role').addEventListener('change', () => {
  settingsFeedback = null;
  membersFeedback = null;
  selectedPointIndex = null;
  renderAll();
});
$('theme').addEventListener('change', (ev) => applyTheme(ev.target.value));

$('dialog-history').addEventListener('click', () => { $('dialog').close(); switchView('history'); });
$('dialog-pause').addEventListener('click', () => { $('dialog').close(); switchView('settings'); });
$('close').addEventListener('click', () => $('dialog').close());

renderAll();
