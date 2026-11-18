const $ = (id) => document.getElementById(id);

const ITEMS = [
  { key: 'requests', name: 'ตอบคำขอ', model: 'example-text-model', queueLabel: 'ข้อความและงานตามเวลา', queueKey: 'main', icon: 'comment', baselineMs: 6000, groupName: 'กลุ่มข้อความ' },
  { key: 'task_sync', name: 'จับงานอัตโนมัติ', model: 'example-text-model', queueLabel: 'ข้อความและงานตามเวลา', queueKey: 'main', icon: 'list', baselineMs: 6000, groupName: 'กลุ่มข้อความ' },
  { key: 'summary', name: 'สรุปบทสนทนา', model: 'example-text-model', queueLabel: 'ข้อความและงานตามเวลา', queueKey: 'main', icon: 'document', baselineMs: 6000, groupName: 'กลุ่มข้อความ' },
  { key: 'media', name: 'อ่านภาพ / PDF', model: 'example-text-model', queueLabel: 'อ่านภาพและเอกสาร', queueKey: 'media', icon: 'picture', baselineMs: 10000, groupName: 'กลุ่มเอกสาร' },
  { key: 'render', name: 'สร้างและแก้ภาพ', model: 'example-image-model', queueLabel: 'สร้างภาพ', queueKey: 'render', icon: 'wand', baselineMs: 15000, groupName: 'กลุ่มภาพ' },
];

const SCENARIOS = {
  problem: {
    title: 'WhatsApp หลุดไป 6 นาที',
    description: 'เครื่องบอทยังติดต่อได้ แต่ข้อความใหม่อาจยังไม่ถึงบอท',
    advice: 'ลองตรวจการเชื่อมต่อ WhatsApp',
    note: 'ยังบอกสาเหตุที่หลุดไม่ได้จากข้อมูลนี้',
    updatedText: 'รับสถานะล่าสุด 13:20:00',
    lastAiTime: '16 พ.ย. 13:05:00',
    defaultCapability: 0,
    metrics: [
      ['เครื่องบอท', 'ติดต่อได้', 'รับสถานะ 13:20:00'],
      ['WhatsApp', 'ขาดการเชื่อมต่อ', 'ตั้งแต่ 13:14:00'],
      ['ส่งคำตอบล่าสุด', '13:12:00', 'ส่งสำเร็จ · ยังไม่ยืนยันส่งถึง'],
    ],
    queues: { main: 3, media: 1, render: 0, runningMain: 1 },
    capDurationsMs: [1850, 2100, 2900, 3400, 14200],
    rhythm: [
      { time: '12:25', label: 'ตอบคำขอ', capIndex: 0, durationMs: 1700, ok: true },
      { time: '12:38', label: 'จับงานอัตโนมัติ', capIndex: 1, durationMs: 2150, ok: true },
      { time: '12:50', label: 'ช่วงไม่มีเหตุการณ์ (ไม่เดาสถานะ)', gap: true },
      { time: '13:02', label: 'อ่านภาพ / PDF', capIndex: 3, durationMs: 3400, ok: true },
      { time: '13:08', label: 'สรุปบทสนทนา', capIndex: 2, durationMs: 2900, ok: true },
      { time: '13:12', label: 'ตอบคำขอ (ส่งสำเร็จ)', capIndex: 0, durationMs: 1850, ok: true },
      { time: '13:14', label: 'WhatsApp ขาดการเชื่อมต่อ', capIndex: null, durationMs: null, ok: false, eventOnly: true },
    ],
    history: [
      { at: '16 พ.ย. 13:14:00', kind: 'connection', label: 'WhatsApp ขาดการเชื่อมต่อ', cap: 'การเชื่อมต่อ', ok: false, detail: 'สถานะที่บอทรายงานล่าสุด', adminHint: 'โค้ดเหตุผล: disconnected · ตรวจอุปกรณ์ที่ลิงก์' },
      { at: '16 พ.ย. 13:12:00', kind: 'send', label: 'ส่งคำตอบสำเร็จ', cap: 'ตอบคำขอ', ok: true, detail: 'ยังไม่ยืนยันการส่งถึงผู้รับ', adminHint: 'ปลายทางรับจากเซิร์ฟเวอร์แล้ว · รอ ACK' },
      { at: '16 พ.ย. 13:08:00', kind: 'ai', label: 'AI ทำงานสำเร็จ', cap: 'สรุปบทสนทนา', ok: true, detail: 'ใช้เวลา 2.9 วิ · example-response-model', adminHint: 'OpenAI · ปกติ' },
      { at: '16 พ.ย. 13:02:00', kind: 'ai', label: 'AI ทำงานสำเร็จ', cap: 'อ่านภาพ / PDF', ok: true, detail: 'ใช้เวลา 3.4 วิ · example-response-model', adminHint: 'OpenAI · ปกติ' },
      { at: '14 พ.ย. 09:15:00', kind: 'connection', label: 'WhatsApp เชื่อมต่อใหม่', cap: 'การเชื่อมต่อ', ok: true, detail: 'กลับมาออนไลน์หลังหลุด 2 นาที', adminHint: 'บันทึกเก็บย้อนหลัง 30 วัน' },
    ],
  },
  healthy: {
    title: 'ติดต่อบอทได้',
    description: 'เครื่องบอทและ WhatsApp เชื่อมต่ออยู่',
    advice: 'ยังไม่มีเรื่องที่ต้องตรวจ',
    note: 'การเชื่อมต่อไม่ได้ยืนยันว่าจะตอบได้ทุกครั้ง',
    updatedText: 'รับสถานะล่าสุด 13:20:00',
    lastAiTime: '16 พ.ย. 13:18:00',
    defaultCapability: 0,
    metrics: [
      ['เครื่องบอท', 'ติดต่อได้', 'รับสถานะ 13:20:00'],
      ['WhatsApp', 'เชื่อมต่อแล้ว', 'สถานะล่าสุด'],
      ['ส่งคำตอบล่าสุด', '13:18:00', 'ส่งสำเร็จ · ยังไม่ยืนยันส่งถึง'],
    ],
    queues: { main: 0, media: 0, render: 0, runningMain: 0 },
    capDurationsMs: [1350, 1650, 2400, 2850, 11800],
    rhythm: [
      { time: '12:24', label: 'ตอบคำขอ', capIndex: 0, durationMs: 1420, ok: true },
      { time: '12:41', label: 'สรุปบทสนทนา', capIndex: 2, durationMs: 2550, ok: true },
      { time: '12:52', label: 'ช่วงเงียบในกลุ่ม (ไม่มีเหตุการณ์)', gap: true },
      { time: '13:04', label: 'จับงานอัตโนมัติ', capIndex: 1, durationMs: 1650, ok: true },
      { time: '13:10', label: 'อ่านภาพ / PDF', capIndex: 3, durationMs: 2850, ok: true },
      { time: '13:15', label: 'สร้างและแก้ภาพ', capIndex: 4, durationMs: 11800, ok: true },
      { time: '13:18', label: 'ตอบคำขอ', capIndex: 0, durationMs: 1350, ok: true },
    ],
    history: [
      { at: '16 พ.ย. 13:18:00', kind: 'send', label: 'ส่งคำตอบสำเร็จ', cap: 'ตอบคำขอ', ok: true, detail: 'ใช้เวลา 1.4 วิ · ยังไม่ยืนยันส่งถึง', adminHint: 'example-response-model' },
      { at: '16 พ.ย. 13:15:00', kind: 'ai', label: 'AI ทำงานสำเร็จ', cap: 'สร้างและแก้ภาพ', ok: true, detail: 'ใช้เวลา 11.8 วิ · ยังไม่มีชื่อโมเดลตอบกลับ', adminHint: 'OpenAI · render เสร็จสมบูรณ์' },
      { at: '16 พ.ย. 13:10:00', kind: 'ai', label: 'AI ทำงานสำเร็จ', cap: 'อ่านภาพ / PDF', ok: true, detail: 'ใช้เวลา 2.9 วิ · example-response-model', adminHint: 'OpenAI · ปกติ' },
      { at: '16 พ.ย. 12:24:00', kind: 'connection', label: 'WhatsApp เชื่อมต่ออยู่', cap: 'การเชื่อมต่อ', ok: true, detail: 'ได้รับสถานะรอบปกติ', adminHint: 'ไม่มีเหตุขัดข้อง' },
    ],
  },
  stale: {
    title: 'ยังยืนยันสถานะตอนนี้ไม่ได้',
    description: 'ไม่ได้รับข้อมูลใหม่มา 10 นาที ข้อมูลด้านล่างเป็นข้อมูลเก่า',
    advice: 'ลองตรวจที่เครื่องบอท',
    note: 'เครื่องอาจหลับหรือขาดอินเทอร์เน็ต ยังไม่ทราบสาเหตุ',
    updatedText: 'ข้อมูลเก่า · ล่าสุด 13:10:00',
    lastAiTime: '16 พ.ย. 13:05:00 (เก่า)',
    defaultCapability: 0,
    metrics: [
      ['เครื่องบอท', 'ยังไม่ยืนยัน', 'ข้อมูลเก่า 13:10:00'],
      ['WhatsApp', 'ยังไม่ยืนยัน', 'ข้อมูลเก่า 13:10:00'],
      ['ส่งคำตอบล่าสุด', '13:08:00', 'หลักฐานเก่า · ยังไม่ยืนยันส่งถึง'],
    ],
    queues: { main: 1, media: 0, render: 0, runningMain: 0 },
    capDurationsMs: [1900, 2200, 3100, 3600, 12900],
    rhythm: [
      { time: '12:20', label: 'ตอบคำขอ', capIndex: 0, durationMs: 1850, ok: true },
      { time: '12:35', label: 'จับงานอัตโนมัติ', capIndex: 1, durationMs: 2200, ok: true },
      { time: '12:55', label: 'อ่านภาพ / PDF', capIndex: 3, durationMs: 3600, ok: true },
      { time: '13:08', label: 'ตอบคำขอ (หลักฐานเก่า)', capIndex: 0, durationMs: 1900, ok: true },
      { time: '13:10–13:20', label: 'ไม่ได้รับสถานะใหม่ (10 นาที)', gap: true },
    ],
    history: [
      { at: '16 พ.ย. 13:08:00', kind: 'send', label: 'ส่งคำตอบสำเร็จ (ข้อมูลเก่า)', cap: 'ตอบคำขอ', ok: true, detail: 'หลักฐานสุดท้ายก่อนสัญญาณหาย', adminHint: 'ไม่ได้รับ heartbeat มาแล้ว 10 นาที' },
      { at: '16 พ.ย. 12:55:00', kind: 'ai', label: 'AI ทำงานสำเร็จ (ข้อมูลเก่า)', cap: 'อ่านภาพ / PDF', ok: true, detail: 'ใช้เวลา 3.6 วิ · example-response-model', adminHint: 'OpenAI · ข้อมูลก่อนขาดการติดต่อ' },
    ],
  },
  empty: {
    title: 'ยังรอสถานะแรกจากบอท',
    description: 'เมื่อบอทส่งข้อมูลเข้ามา เราจะเห็นสถานะและกราฟจังหวะงานที่นี่',
    advice: 'รอข้อมูลจากบอท',
    note: 'ยังไม่มีหลักฐานพอจะบอกว่าบอทพร้อมหรือไม่',
    updatedText: 'ยังไม่ได้รับสถานะ',
    lastAiTime: 'ยังไม่ทราบเวลา',
    defaultCapability: 0,
    metrics: [
      ['เครื่องบอท', 'ยังไม่ทราบ', 'ยังไม่ได้รับข้อมูล'],
      ['WhatsApp', 'ยังไม่ทราบ', 'ยังไม่ได้รับข้อมูล'],
      ['ส่งคำตอบล่าสุด', 'ยังไม่มีข้อมูล', 'ยังไม่มีหลักฐานการส่ง'],
    ],
    queues: null,
    capDurationsMs: null,
    rhythm: [],
    history: [],
  },
  ai: {
    title: 'งานสรุปต้องการความช่วยเหลือ',
    description: 'เครื่องบอทและ WhatsApp เชื่อมต่ออยู่ แต่งานสรุปล่าสุดไม่สำเร็จ',
    advice: 'ตรวจบริการ AI สำหรับงานสรุป',
    note: 'ความสามารถอื่นอาจยังทำงานได้ตามปกติ',
    updatedText: 'รับสถานะล่าสุด 13:20:00',
    lastAiTime: '16 พ.ย. 13:16:00',
    defaultCapability: 2,
    metrics: [
      ['เครื่องบอท', 'ติดต่อได้', 'รับสถานะ 13:20:00'],
      ['WhatsApp', 'เชื่อมต่อแล้ว', 'สถานะล่าสุด'],
      ['ส่งคำตอบล่าสุด', '13:18:00', 'ส่งสำเร็จ · ยังไม่ยืนยันส่งถึง'],
    ],
    queues: { main: 2, media: 1, render: 1, runningMain: 1 },
    capDurationsMs: [1520, 1780, 5400, 2950, 12100],
    rhythm: [
      { time: '12:30', label: 'ตอบคำขอ', capIndex: 0, durationMs: 1500, ok: true },
      { time: '12:45', label: 'จับงานอัตโนมัติ', capIndex: 1, durationMs: 1780, ok: true },
      { time: '12:58', label: 'ช่วงไม่มีเหตุการณ์ (ไม่เดาสถานะ)', gap: true },
      { time: '13:06', label: 'อ่านภาพ / PDF', capIndex: 3, durationMs: 2950, ok: true },
      { time: '13:12', label: 'สรุปบทสนทนา (ไม่สำเร็จ)', capIndex: 2, durationMs: 5400, ok: false },
      { time: '13:16', label: 'สรุปบทสนทนา (ลองใหม่ไม่สำเร็จ)', capIndex: 2, durationMs: 5100, ok: false },
      { time: '13:18', label: 'ตอบคำขอ', capIndex: 0, durationMs: 1520, ok: true },
    ],
    history: [
      { at: '16 พ.ย. 13:18:00', kind: 'send', label: 'ส่งคำตอบสำเร็จ', cap: 'ตอบคำขอ', ok: true, detail: 'ความสามารถอื่นยังส่งคำตอบได้', adminHint: 'ไม่กระทบคิวตอบคำขอ' },
      { at: '16 พ.ย. 13:16:00', kind: 'ai', label: 'AI ทำงานไม่สำเร็จ', cap: 'สรุปบทสนทนา', ok: false, detail: 'ใช้เวลา 5.1 วิ · ขาดการตอบกลับ', adminHint: 'คำแนะนำผู้ดูแล: ตรวจเครือข่ายหรือโควตาบริการ OpenAI' },
      { at: '16 พ.ย. 13:12:00', kind: 'ai', label: 'AI ทำงานไม่สำเร็จ', cap: 'สรุปบทสนทนา', ok: false, detail: 'ใช้เวลา 5.4 วิ · ขาดการตอบกลับ', adminHint: 'คำแนะนำผู้ดูแล: เกิดซ้ำ 2 ครั้งในงานสรุป' },
      { at: '16 พ.ย. 13:06:00', kind: 'ai', label: 'AI ทำงานสำเร็จ', cap: 'อ่านภาพ / PDF', ok: true, detail: 'ใช้เวลา 3.0 วิ · example-response-model', adminHint: 'OpenAI · ปกติ' },
    ],
  },
};

const VIEW_META = {
  overview: { kicker: 'ภาพรวมบอท' },
  history: { kicker: 'ประวัติการทำงาน' },
  settings: { kicker: 'การแจ้งเตือน' },
  members: { kicker: 'สมาชิกและสิทธิ์' },
};

let activeView = 'overview';
let selectedCapability = 0;
let selectedPointIndex = null;
let lastScenarioRendered = null;
let historyFilter = 'all';
let pauseState = { minutes: 0, untilLabel: null, actor: null };
let settingsFeedback = null;
let membersFeedback = null;

const membersList = [
  { email: 'nok@example.com', name: 'Nok', role: 'admin', active: true },
  { email: 'somchai@example.com', name: 'Somchai', role: 'member', active: true },
  { email: 'ploy@example.com', name: 'Ploy', role: 'member', active: true },
];

const auditLog = [
  { at: '16 พ.ย. 09:00:00', actor: 'nok@example.com', summary: 'ตั้งสิทธิ์สมาชิก · somchai@example.com' },
  { at: '15 พ.ย. 18:30:00', actor: 'nok@example.com', summary: 'พักแจ้งเตือน 30 นาที' },
  { at: '15 พ.ย. 19:00:00', actor: 'ระบบอัตโนมัติ', summary: 'ครบกำหนดพัก · กลับมาแจ้งเตือนตามปกติ' },
];

function isAdmin() {
  return $('role').value === 'admin';
}

function formatSec(ms) {
  if (ms === null || ms === undefined) return '—';
  return `${(ms / 1000).toFixed(1)} วิ`;
}

function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX.toFixed(1)} ${p0.y.toFixed(1)}, ${midX.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function buildDetailsMarkup(key, scenario) {
  const unknown = key === 'empty';
  const stale = key === 'stale';
  const item = ITEMS[selectedCapability];
  const isSelectedError = key === 'ai' && selectedCapability === 2;
  const resultText = unknown
    ? 'ยังไม่มีข้อมูล'
    : stale
      ? 'ครั้งก่อนสำเร็จ · ข้อมูลเก่า'
      : isSelectedError
        ? 'ครั้งล่าสุดไม่สำเร็จ'
        : 'ครั้งล่าสุดสำเร็จ';
  const stateBadgeClass = unknown || stale ? '' : isSelectedError ? 'is-warn' : 'is-ok';

  let queueText = 'ยังไม่ทราบ';
  if (scenario.queues) {
    const qWait = scenario.queues[item.queueKey] ?? 0;
    const qRun = item.queueKey === 'main' ? scenario.queues.runningMain : 0;
    queueText = stale ? `ข้อมูลเก่า: ${qWait} รอ` : `${qWait} รอ · ${qRun} กำลังทำ`;
  }

  const responseNote = unknown
    ? 'ยังไม่มีผลตอบกลับจากบริการ AI'
    : selectedCapability === 4
      ? 'ยังไม่มีชื่อโมเดลยืนยันจากผลตอบกลับ'
      : 'โมเดลจากผลตอบกลับ: example-response-model';
  const caveatNote = stale
    ? 'ข้อมูลที่เคยได้รับ ไม่ยืนยันสถานะปัจจุบัน'
    : 'ผลล่าสุดไม่ได้รับประกันว่าการเรียกครั้งถัดไปจะสำเร็จ';

  const adminErrorHint = isSelectedError && isAdmin()
    ? '<p class="detail-note"><strong>ข้อมูลผู้ดูแล:</strong> เกิดข้อผิดพลาด network/timeout ซ้ำ 2 ครั้ง · แนะนำตรวจเครือข่ายหรือโควตา</p>'
    : '';

  return `
    <div class="detail-head">
      <div>
        <h3>${item.name}</h3>
        <p>ผลการใช้ AI ล่าสุด · ${scenario.lastAiTime}</p>
      </div>
      <div class="detail-state ${stateBadgeClass}">${resultText}</div>
    </div>
    <div class="facts">
      <div><span>ผู้ให้บริการ</span><strong>${unknown ? 'ยังไม่ทราบ' : 'OpenAI'}</strong></div>
      <div><span>โมเดลที่ขอใช้</span><strong>${unknown ? 'ยังไม่ทราบ' : item.model}</strong></div>
      <div><span>คิว ${item.queueLabel}</span><strong>${queueText}</strong></div>
    </div>
    <p class="detail-note">${responseNote} · ${caveatNote}</p>
    ${adminErrorHint}
  `;
}

function renderRhythmChart(key, scenario) {
  const stage = $('rhythm-chart');
  const tooltip = $('rhythm-tooltip');
  const legend = $('rhythm-legend');
  const badge = $('rhythm-badge');
  const points = scenario.rhythm;

  if (!points.length) {
    badge.textContent = 'ยังไม่มีเหตุการณ์';
    stage.innerHTML = '<div class="empty-chart-box"><div><strong>ยังไม่มีบันทึกเหตุการณ์ AI</strong><p>เมื่อบอทส่งข้อมูลเข้ามา จะเห็นกราฟจังหวะการทำงานและช่วงที่ไม่มีสัญญาณที่นี่</p></div></div>';
    tooltip.innerHTML = '<strong>รอข้อมูลแรก</strong><span>ยังไม่มีจุดเหตุการณ์ให้เลือกดู</span>';
    legend.innerHTML = '';
    return;
  }

  const validPoints = points.filter((p) => !p.gap && p.durationMs !== null);
  const countObserved = points.filter((p) => !p.gap).length;
  badge.textContent = key === 'stale' ? `${countObserved} เหตุการณ์ (ข้อมูลเก่า)` : `${countObserved} เหตุการณ์ล่าสุด`;

  const W = 620;
  const H = 185;
  const padL = 38;
  const padR = 18;
  const padT = 18;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxMs = Math.max(4000, ...validPoints.map((p) => p.durationMs)) * 1.15;

  const coords = points.map((p, idx) => {
    const x = padL + (points.length === 1 ? plotW / 2 : (idx / (points.length - 1)) * plotW);
    let y = padT + plotH * 0.5;
    if (!p.gap && p.durationMs !== null) {
      const ratio = Math.min(1, p.durationMs / maxMs);
      y = padT + plotH - ratio * plotH;
    } else if (p.eventOnly) {
      y = padT + plotH * 0.85;
    }
    return { ...p, idx, x, y };
  });

  const segments = [];
  let current = [];
  for (const pt of coords) {
    if (!pt.gap && pt.durationMs !== null) {
      current.push(pt);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);

  const gapShapes = [];
  for (let i = 0; i < coords.length; i++) {
    if (!coords[i].gap) continue;
    const prev = coords[i - 1];
    const next = coords[i + 1];
    const x1 = prev ? prev.x : Math.max(padL, coords[i].x - 36);
    const x2 = next ? next.x : Math.min(W - padR, coords[i].x + 36);
    const y1 = prev && prev.durationMs !== null ? prev.y : padT + plotH * 0.55;
    const y2 = next && next.durationMs !== null ? next.y : padT + plotH * 0.55;
    gapShapes.push(`<rect class="chart-gap-band" x="${x1.toFixed(1)}" y="${padT}" width="${Math.max(24, x2 - x1).toFixed(1)}" height="${plotH}" rx="6"></rect>`);
    gapShapes.push(`<path class="chart-gap-line" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}"></path>`);
  }

  const gridLines = [0, 0.5, 1].map((frac) => {
    const y = padT + plotH - frac * plotH;
    const secLabel = `${((maxMs * frac) / 1000).toFixed(0)}s`;
    return `<line class="chart-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>
            <text class="chart-axis-text" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${secLabel}</text>`;
  }).join('');

  const pathsMarkup = segments.map((seg) => {
    const lineD = buildSmoothPath(seg);
    const areaD = seg.length > 1
      ? `${lineD} L ${seg[seg.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
      : '';
    return `${areaD ? `<path class="chart-area" d="${areaD}"></path>` : ''}
            ${seg.length > 1 ? `<path class="chart-line" d="${lineD}"></path>` : ''}`;
  }).join('');

  if (selectedPointIndex === null || !coords[selectedPointIndex] || coords[selectedPointIndex].gap) {
    const firstSelectable = coords.find((c) => !c.gap && !c.ok) || coords.findLast((c) => !c.gap);
    selectedPointIndex = firstSelectable ? firstSelectable.idx : 0;
  }

  const dotsMarkup = coords.map((pt, idx) => {
    if (pt.gap) {
      return `<text class="chart-axis-text" x="${pt.x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle">${pt.time}</text>`;
    }
    const pressed = selectedPointIndex === idx;
    const dotClass = ['chart-point-dot', !pt.ok ? 'is-error' : '', key === 'stale' ? 'is-stale' : ''].filter(Boolean).join(' ');
    const aria = `${pt.time} · ${pt.label} · ${pt.durationMs !== null ? formatSec(pt.durationMs) : 'เหตุการณ์การเชื่อมต่อ'}`;
    return `
      <g class="chart-point-btn" role="button" tabindex="0" data-point="${idx}" aria-pressed="${pressed}" aria-label="${aria}">
        <circle class="chart-point-hit" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="16"></circle>
        <circle class="chart-point-ring" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="10"></circle>
        <circle class="${dotClass}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="5.5" style="animation-delay:${idx * 55}ms"></circle>
      </g>
      <text class="chart-axis-text" x="${pt.x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle">${pt.time}</text>
    `;
  }).join('');

  stage.innerHTML = `
    <svg class="rhythm-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟความเร็วตอบกลับ AI และช่วงที่ไม่มีข้อมูล">
      <defs>
        <linearGradient id="cozy-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"></stop>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01"></stop>
        </linearGradient>
        <pattern id="cozy-gap-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--border-strong)" stroke-width="1.5" stroke-opacity="0.55"></line>
        </pattern>
      </defs>
      ${gridLines}
      ${gapShapes.join('')}
      ${pathsMarkup}
      ${dotsMarkup}
    </svg>
  `;

  stage.querySelectorAll('.chart-line').forEach((pathEl) => {
    const len = Math.ceil(pathEl.getTotalLength());
    pathEl.style.setProperty('--path-len', String(len));
    pathEl.style.strokeDasharray = String(len);
    pathEl.style.strokeDashoffset = String(len);
  });

  const updatePointSelection = (syncCap = false) => {
    stage.querySelectorAll('.chart-point-btn').forEach((el) => {
      el.setAttribute('aria-pressed', String(Number(el.dataset.point) === selectedPointIndex));
    });
    const active = coords[selectedPointIndex];
    if (!active) return;
    if (syncCap && typeof active.capIndex === 'number') {
      selectedCapability = active.capIndex;
      renderCapabilities(key, scenario);
    }
    const statusWord = active.eventOnly ? 'เหตุการณ์การเชื่อมต่อ' : active.ok ? 'สำเร็จ' : 'ไม่สำเร็จ';
    const timing = active.durationMs !== null ? `ใช้เวลา ${formatSec(active.durationMs)}` : 'ไม่มีค่าเวลา AI';
    const jumpBtn = typeof active.capIndex === 'number'
      ? `<button type="button" class="link-button" id="tooltip-jump">ดูงาน "${ITEMS[active.capIndex].name}" ↓</button>`
      : '';
    tooltip.innerHTML = `
      <div><strong>${active.time} · ${active.label}</strong> <span>${statusWord} · ${timing}</span></div>
      ${jumpBtn}
    `;
    const jump = $('tooltip-jump');
    if (jump) {
      jump.addEventListener('click', () => {
        selectedCapability = active.capIndex;
        renderCapabilities(key, scenario);
        const capBtn = document.querySelector(`[data-index="${selectedCapability}"]`);
        if (capBtn) {
          capBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          capBtn.focus();
        }
      });
    }
  };

  updatePointSelection(false);

  legend.innerHTML = `
    <span class="legend-item"><i class="swatch swatch-ok" aria-hidden="true"></i>สำเร็จ</span>
    <span class="legend-item"><i class="swatch swatch-warn" aria-hidden="true"></i>ไม่สำเร็จ / แจ้งเตือน</span>
    <span class="legend-item"><i class="swatch swatch-gap" aria-hidden="true"></i>ช่วงที่ไม่มีข้อมูล (ไม่เดา uptime)</span>
  `;

  stage.querySelectorAll('.chart-point-btn').forEach((btn) => {
    const activate = () => {
      selectedPointIndex = Number(btn.dataset.point);
      updatePointSelection(true);
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

function renderQueueRing(key, scenario) {
  const ring = $('queue-ring');
  const legend = $('queue-legend');
  const foot = $('queue-foot');
  const badge = $('queue-badge');
  const q = scenario.queues;

  if (!q) {
    badge.textContent = 'รอข้อมูล';
    ring.innerHTML = `
      <svg class="ring-svg" viewBox="0 0 128 128" aria-hidden="true">
        <circle class="ring-track" cx="64" cy="64" r="46"></circle>
      </svg>
      <div class="ring-center"><strong>—</strong><span>รอข้อมูล</span></div>
    `;
    legend.innerHTML = `
      <div class="queue-row"><span>ข้อความและงาน (main)</span><strong>ยังไม่ทราบ</strong></div>
      <div class="queue-row"><span>อ่านภาพ / PDF (media)</span><strong>ยังไม่ทราบ</strong></div>
      <div class="queue-row"><span>สร้างภาพ (render)</span><strong>ยังไม่ทราบ</strong></div>
    `;
    foot.textContent = 'ยังไม่ได้รับตัวเลขคิวจากบอท';
    return;
  }

  const totalWaiting = q.main + q.media + q.render;
  badge.textContent = key === 'stale' ? 'ข้อมูลเก่า' : totalWaiting === 0 ? 'ว่างพร้อมรับงาน' : `รอ ${totalWaiting} งาน`;

  const r = 46;
  const circ = 2 * Math.PI * r;
  const entries = [
    { label: 'ข้อความและงาน (main)', count: q.main, color: 'var(--accent)' },
    { label: 'อ่านภาพ / PDF (media)', count: q.media, color: 'var(--wood)' },
    { label: 'สร้างภาพ (render)', count: q.render, color: 'var(--warning)' },
  ];

  let segSvg = '';
  if (totalWaiting === 0) {
    segSvg = `<circle class="ring-seg" cx="64" cy="64" r="${r}" stroke="var(--ok)" stroke-dasharray="${circ.toFixed(1)}" style="--ring-circ:${circ.toFixed(1)};--ring-offset:0"></circle>`;
  } else {
    let accumulated = 0;
    segSvg = entries.filter((e) => e.count > 0).map((e) => {
      const len = (e.count / totalWaiting) * circ;
      const dash = `${Math.max(4, len - 4).toFixed(1)} ${circ.toFixed(1)}`;
      const offset = -accumulated;
      accumulated += len;
      return `<circle class="ring-seg" cx="64" cy="64" r="${r}" stroke="${e.color}" stroke-dasharray="${dash}" stroke-dashoffset="${offset.toFixed(1)}" style="--ring-circ:${circ.toFixed(1)};--ring-offset:${offset.toFixed(1)}"></circle>`;
    }).join('');
  }

  ring.innerHTML = `
    <svg class="ring-svg" viewBox="0 0 128 128" role="img" aria-label="วงแหวนสัดส่วนคิวงานรอทำ">
      <circle class="ring-track" cx="64" cy="64" r="${r}"></circle>
      ${segSvg}
    </svg>
    <div class="ring-center">
      <strong>${totalWaiting}</strong>
      <span>${totalWaiting === 0 ? 'คิวว่าง' : 'งานที่รอ'}</span>
    </div>
  `;

  legend.innerHTML = entries.map((e, idx) => `
    <div class="queue-row">
      <span class="legend-item">
        <i class="swatch ${idx === 0 ? 'swatch-ok' : idx === 1 ? 'swatch-wood' : 'swatch-warn'}" aria-hidden="true"></i>
        ${e.label}
      </span>
      <strong>${e.count} รอ</strong>
    </div>
  `).join('');

  foot.textContent = q.runningMain > 0
    ? `กำลังทำงานอยู่ในคิวหลัก ${q.runningMain} งาน${key === 'stale' ? ' (ตัวเลขเก่า)' : ''}`
    : `ไม่มีงานค้างกำลังประมวลผล${key === 'stale' ? ' (ตัวเลขเก่า)' : ''}`;
}

function renderCapabilities(key, scenario) {
  const unknown = key === 'empty';
  const stale = key === 'stale';
  const durations = scenario.capDurationsMs || [];
  const detailsMarkup = buildDetailsMarkup(key, scenario);

  $('capabilities').innerHTML = ITEMS.map((item, i) => {
    const isAiError = key === 'ai' && i === 2;
    const ms = durations[i] ?? null;
    const pct = ms !== null ? Math.min(100, Math.max(12, Math.round((ms / item.baselineMs) * 100))) : 0;
    const stateText = unknown ? 'ยังไม่มีข้อมูล' : stale ? 'ข้อมูลเก่า' : isAiError ? '! ครั้งล่าสุดไม่สำเร็จ' : 'ครั้งล่าสุดสำเร็จ';
    const fillClass = ['cap-bar-fill', isAiError ? 'is-warn' : '', stale ? 'is-stale' : ''].filter(Boolean).join(' ');
    const isSelected = selectedCapability === i;

    return `
      <button type="button" class="cap" data-index="${i}" aria-pressed="${isSelected}">
        <span class="cap-icon" aria-hidden="true"><i class="fi fi-${item.icon}" aria-hidden="true"></i></span>
        <span class="cap-name">${item.name}</span>
        <span class="cap-provider">${unknown ? 'รอผู้ให้บริการและโมเดล' : `OpenAI · ${item.model}`}</span>
        <span class="cap-state ${isAiError ? 'problem' : ''}">${stateText} →</span>
        <span class="cap-bar-row" aria-hidden="true">
          <span class="cap-bar-track">
            <span class="${fillClass}" style="width:${pct}%;animation-delay:${i * 55}ms"></span>
          </span>
          <span class="cap-bar-label">${ms !== null ? `${formatSec(ms)} · ${item.groupName}` : '—'}</span>
        </span>
      </button>
      ${isSelected ? `<div class="cap-inline-detail" id="cap-inline-detail" aria-live="polite">${detailsMarkup}</div>` : ''}
    `;
  }).join('');

  $('details').innerHTML = detailsMarkup;

  document.querySelectorAll('.cap').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCapability = Number(btn.dataset.index);
      renderCapabilities(key, scenario);
      const refocused = document.querySelector(`[data-index="${selectedCapability}"]`);
      if (refocused) refocused.focus();
    });
  });
}

function renderHistoryView(key, scenario) {
  const filters = [
    ['all', 'ทั้งหมด'],
    ['ai', 'งาน AI'],
    ['connection', 'การเชื่อมต่อ'],
    ['send', 'ส่งคำตอบ'],
  ];

  $('history-filters').innerHTML = filters.map(([id, label]) => `
    <button type="button" class="pill-filter" data-filter="${id}" aria-pressed="${historyFilter === id}">${label}</button>
  `).join('');

  $('history-filters').querySelectorAll('.pill-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      historyFilter = btn.dataset.filter;
      renderHistoryView(key, scenario);
    });
  });

  const rows = scenario.history.filter((ev) => historyFilter === 'all' || ev.kind === historyFilter);
  const admin = isAdmin();

  if (!rows.length) {
    $('history-rows').innerHTML = `<tr><td colspan="4">ยังไม่มีเหตุการณ์ในหมวดนี้ (สำหรับสถานการณ์ "${$('scenario').selectedOptions[0].textContent}")</td></tr>`;
  } else {
    $('history-rows').innerHTML = rows.map((ev) => `
      <tr>
        <td>${ev.at}</td>
        <td><span class="status-pill ${ev.ok ? 'is-ok' : 'is-warn'}">${ev.label}</span></td>
        <td>${ev.cap}</td>
        <td>${ev.detail}${admin ? `<br><small style="color:var(--secondary)">${ev.adminHint}</small>` : ''}</td>
      </tr>
    `).join('');
  }

  $('history-note').textContent = admin
    ? 'ผู้ดูแลเห็นคำแนะนำการตรวจแก้เพิ่มเติมด้านล่างของแต่ละแถว (ข้อมูลทำงานล้วน ไม่มีเนื้อหาแชท)'
    : 'มุมมองทีมงานแสดงเฉพาะสถานะเหตุการณ์และโมเดล ไม่แสดงรายละเอียดข้อผิดพลาดเชิงเทคนิค';
}

function renderSettingsView() {
  const admin = isAdmin();
  $('settings-role-chip').textContent = admin ? 'สิทธิ์ผู้ดูแล' : 'ดูอย่างเดียว (ทีมงาน)';

  if (!admin) {
    $('settings-content').innerHTML = `
      <section class="panel-card">
        <h2>สิทธิ์ผู้ดูแลเท่านั้น</h2>
        <p class="panel-note">บัญชีระดับทีมงานสามารถดูภาพรวมและประวัติการทำงานได้ แต่การพักอีเมลแจ้งเตือนและบันทึกผู้ดูแลสงวนไว้สำหรับผู้ดูแลเท่านั้น (ลองสลับ "มุมมองสิทธิ์" เป็น ผู้ดูแล ด้านบนเพื่อทดลอง)</p>
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
      <section class="panel-card">
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

      <section class="panel-card">
        <h2>สถานะการส่งอีเมลแจ้งเตือน</h2>
        <p><span class="status-pill is-ok">เปิดส่งอีเมลแล้ว</span></p>
        <p class="panel-note">รอส่ง 0 รายการ · ส่งไม่สำเร็จและรอลองใหม่ 0 รายการ</p>
        <p class="panel-note">กติกา: ปัญหาต่อเนื่องครบ 5 นาทีแจ้งครั้งแรก · เตือนซ้ำทุก 1 ชั่วโมง · เหตุที่ต้องให้คนช่วยแจ้งทันที</p>
      </section>
    </div>

    <section class="panel-card">
      <h2>ประวัติผู้ดูแล (เก็บย้อนหลัง 30 วัน)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>เวลา (Bangkok)</th>
              <th>ผู้ดำเนินการ</th>
              <th>รายการ</th>
            </tr>
          </thead>
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
  const admin = isAdmin();
  $('members-role-chip').textContent = admin ? 'สิทธิ์ผู้ดูแล' : 'สิทธิ์ทีมงาน';

  if (!admin) {
    $('members-content').innerHTML = `
      <section class="panel-card">
        <h2>บัญชีของคุณ: ทีมงาน (Member)</h2>
        <p class="panel-note">การเพิ่ม ลบ หรือเปลี่ยนสิทธิ์บัญชีอื่นทำได้เฉพาะผู้ดูแลเท่านั้น (ลองสลับ "มุมมองสิทธิ์" เป็น ผู้ดูแล ด้านบนเพื่อทดลองจัดการสมาชิก)</p>
      </section>
    `;
    return;
  }

  const fb = membersFeedback
    ? `<div class="feedback-msg ${membersFeedback.warn ? 'is-warn' : ''}">${membersFeedback.text}</div>`
    : '';

  $('members-content').innerHTML = `
    <section class="panel-card" style="margin-bottom:20px">
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

    <section class="panel-card">
      <h2>รายชื่อสมาชิก (${membersList.length} บัญชี)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>อีเมล</th>
              <th>สิทธิ์</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${membersList.map((m, idx) => `
              <tr>
                <td><strong>${m.name}</strong></td>
                <td>${m.email}</td>
                <td><span class="status-pill ${m.role === 'admin' ? 'is-ok' : ''}">${m.role === 'admin' ? 'ผู้ดูแล' : 'ทีมงาน'}</span></td>
                <td>
                  <button type="button" class="button btn-small" data-toggle-member="${idx}">
                    สลับเป็น${m.role === 'admin' ? 'ทีมงาน' : 'ผู้ดูแล'}
                  </button>
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
    const localName = email.split('@')[0];
    const name = localName.charAt(0).toUpperCase() + localName.slice(1);
    membersList.push({ email, name, role, active: true });
    auditLog.unshift({ at: '16 พ.ย. 13:22:00', actor: 'nok@example.com', summary: `ตั้งสิทธิ์สมาชิก · ${email}` });
    membersFeedback = { text: `เพิ่ม ${email} เรียบร้อยแล้ว`, warn: false };
    renderMembersView();
  });

  document.querySelectorAll('[data-toggle-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.toggleMember);
      const target = membersList[idx];
      const adminCount = membersList.filter((m) => m.role === 'admin').length;
      if (target.role === 'admin' && adminCount <= 1) {
        membersFeedback = { text: 'ต้องมีผู้ดูแลอย่างน้อยหนึ่งคน จึงเปลี่ยนสิทธิ์หรือลบบัญชีนี้ไม่ได้', warn: true };
        renderMembersView();
        return;
      }
      target.role = target.role === 'admin' ? 'member' : 'admin';
      auditLog.unshift({ at: '16 พ.ย. 13:22:00', actor: 'nok@example.com', summary: `ตั้งสิทธิ์สมาชิก · ${target.email}` });
      membersFeedback = { text: `เปลี่ยนสิทธิ์ของ ${target.email} เป็น${target.role === 'admin' ? 'ผู้ดูแล' : 'ทีมงาน'}แล้ว`, warn: false };
      renderMembersView();
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
      auditLog.unshift({ at: '16 พ.ย. 13:22:00', actor: 'nok@example.com', summary: `ถอดสมาชิก · ${target.email}` });
      membersFeedback = { text: `ถอดสิทธิ์ ${target.email} แล้ว`, warn: false };
      renderMembersView();
    });
  });
}

function renderChrome() {
  const admin = isAdmin();
  $('account-label').textContent = admin ? 'Nok · ผู้ดูแล' : 'Somchai · ทีมงาน';
  $('role-hint').textContent = admin ? 'มุมมองผู้ดูแล' : 'มุมมองทีมงาน';
  $('nav-settings-sub').textContent = admin ? 'พักเตือนและสถานะอีเมล' : 'เฉพาะผู้ดูแล';
  $('nav-members-sub').textContent = admin ? 'บัญชีทีมและผู้ดูแล' : 'ดูสิทธิ์ของคุณ';
  $('view-kicker').textContent = VIEW_META[activeView].kicker;

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    if (btn.dataset.view === activeView) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  $('view-overview').hidden = activeView !== 'overview';
  $('view-history').hidden = activeView !== 'history';
  $('view-settings').hidden = activeView !== 'settings';
  $('view-members').hidden = activeView !== 'members';

  const paused = pauseState.minutes > 0;
  $('pause-banner').hidden = !paused;
  if (paused) {
    $('pause-banner-title').textContent = `กำลังพักอีเมลแจ้งเตือน ${pauseState.minutes} นาที (ถึง ${pauseState.untilLabel})`;
    $('pause-banner-desc').textContent = `พักโดย ${pauseState.actor} · เว็บยังแสดงปัญหาจริง และจะกลับมาแจ้งเตือนอัตโนมัติเมื่อครบเวลา`;
    $('pause-resume-quick').hidden = !admin;
  }
}

function renderOverview(key, s) {
  const unknown = key === 'empty';
  const stale = key === 'stale';

  document.body.dataset.state = key;
  $('overview-title').textContent = s.title;
  $('overview-description').textContent = s.description;
  $('symbol').innerHTML = `<i class="fi fi-${key === 'healthy' ? 'check' : stale || unknown ? 'unknown' : 'alert'}" aria-hidden="true"></i>`;
  $('updated').textContent = s.updatedText;
  $('advice-title').textContent = s.advice;
  $('advice-description').textContent = s.note;
  $('advice-button').hidden = unknown || key === 'healthy';

  $('evidence').innerHTML = s.metrics.map((m) => `
    <div class="metric">
      <span>${m[0]}</span>
      <strong>${m[1]}</strong>
      <small>${m[2]}</small>
    </div>
  `).join('');

  renderRhythmChart(key, s);
  renderQueueRing(key, s);
  renderCapabilities(key, s);
}

function renderAll() {
  const key = $('scenario').value;
  const s = SCENARIOS[key];

  if (lastScenarioRendered !== key) {
    selectedPointIndex = null;
    selectedCapability = s.defaultCapability ?? 0;
    lastScenarioRendered = key;
  }

  renderChrome();
  renderOverview(key, s);
  renderHistoryView(key, s);
  renderSettingsView();
  renderMembersView();
}

function switchView(viewName) {
  activeView = viewName;
  renderChrome();
}

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.dataset.theme = mode;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

$('goto-history-link').addEventListener('click', () => switchView('history'));

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
  renderAll();
});
$('theme').addEventListener('change', (ev) => applyTheme(ev.target.value));

$('advice-button').addEventListener('click', () => {
  const key = $('scenario').value;
  $('dialog-description').textContent = SCENARIOS[key].note;
  const steps = key === 'ai'
    ? ['ตรวจอินเทอร์เน็ตบนเครื่องบอท', 'ให้ผู้ดูแลตรวจรายละเอียดการเรียก AI', 'รอดูผลเรียกครั้งต่อไป']
    : ['ตรวจว่าเครื่องบอทเปิดอยู่และมีอินเทอร์เน็ต', 'ตรวจ WhatsApp และอุปกรณ์ที่ลิงก์', 'หากยังมีปัญหา ให้ผู้ดูแลตรวจบันทึก'];
  $('steps').innerHTML = steps.map((x) => `<li>${x}</li>`).join('');
  $('dialog-pause').hidden = !isAdmin();
  $('dialog').showModal();
});

$('dialog-history').addEventListener('click', () => {
  $('dialog').close();
  switchView('history');
});

$('dialog-pause').addEventListener('click', () => {
  $('dialog').close();
  switchView('settings');
});

$('close').addEventListener('click', () => $('dialog').close());

renderAll();
