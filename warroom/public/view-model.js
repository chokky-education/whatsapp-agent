export const UTC_OFFSET_MS = 7 * 3600_000;
const HOUR_MS = 3600_000;
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export const CAPABILITY_META = [
  { key: "requests", name: "ตอบคำขอ / จัดการงาน", short: "ตอบคำขอ", queueKey: "main", queueLabel: "ข้อความและงานตามเวลา", icon: "comment", groupName: "ข้อความ" },
  { key: "task_sync", name: "จับงานอัตโนมัติ", short: "จับงาน", queueKey: "main", queueLabel: "ข้อความและงานตามเวลา", icon: "list", groupName: "ข้อความ" },
  { key: "summary", name: "สรุปบทสนทนา", short: "สรุปแชท", queueKey: "main", queueLabel: "ข้อความและงานตามเวลา", icon: "document", groupName: "ข้อความ" },
  { key: "media", name: "อ่านภาพ / PDF", short: "อ่านภาพ", queueKey: "media", queueLabel: "อ่านภาพและเอกสาร", icon: "picture", groupName: "เอกสาร" },
  { key: "render", name: "สร้างและแก้ภาพ", short: "สร้างภาพ", queueKey: "render", queueLabel: "สร้างภาพ", icon: "wand", groupName: "งานภาพ" },
];

export const CAPABILITY_BY_KEY = Object.fromEntries(CAPABILITY_META.map((m, idx) => [m.key, { ...m, idx }]));

export const QUEUE_LABELS = {
  main: "ข้อความและงานตามเวลา",
  media: "อ่านภาพและเอกสาร",
  render: "สร้างภาพ",
};

export const CONNECTION_LABELS = {
  starting: "กำลังเชื่อมต่อ",
  connected: "เชื่อมต่อแล้ว",
  disconnected: "ขาดการเชื่อมต่อ",
  pairing: "ต้องลิงก์ใหม่",
  logged_out: "ออกจากระบบ",
  replaced: "เชื่อมต่อจากที่อื่น",
};

export const ERROR_GUIDANCE = {
  auth: "ตรวจ API key",
  permission: "ตรวจสิทธิ์การใช้ API",
  model_missing: "ตรวจชื่อโมเดลและสิทธิ์",
  rate_limit: "รอแล้วลองใหม่ / ตรวจโควตา",
  network: "ตรวจเครือข่าย",
  incomplete: "คำตอบไม่ครบ",
  refused: "บริการปฏิเสธคำขอ",
  unknown: "ต้องตรวจสอบเพิ่มเติม",
};

export const EVENT_LABELS = {
  ai_ok: "AI ทำงานสำเร็จ",
  ai_error: "AI ทำงานไม่สำเร็จ",
  send_ok: "ส่งข้อความสำเร็จ",
  send_error: "ส่งข้อความไม่สำเร็จ",
  delivered: "ได้รับหลักฐานการส่งถึง",
  job_interrupted: "งานถูกขัดจังหวะ",
  render_error: "งานเรนเดอร์ไม่สำเร็จ",
  connection: "สถานะ WhatsApp เปลี่ยน",
};

const pad2 = (n) => String(n).padStart(2, "0");
const toBkkDate = (ms) => new Date(ms + UTC_OFFSET_MS);

export function formatBkkHm(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const d = toBkkDate(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function formatBkkTime(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const d = toBkkDate(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function formatBkkDateTime(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "ยังไม่มีข้อมูล";
  const d = toBkkDate(ms);
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${formatBkkTime(ms)}`;
}

export function formatSec(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1)} วิ`;
}

export function formatAge(ageMs) {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs) || ageMs < 0) return "ยังไม่ทราบ";
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return `${ageSec} วิ ที่แล้ว`;
  const mins = Math.floor(ageSec / 60);
  const secs = ageSec % 60;
  if (mins < 60) return secs ? `${mins} น. ${secs} วิ ที่แล้ว` : `${mins} น. ที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hrs} ชม. ${remMins} น. ที่แล้ว` : `${hrs} ชม. ที่แล้ว`;
}

export function formatShortAge(ageMs) {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs) || ageMs < 0) return "ยังไม่เรียก";
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return `${ageSec} วิ`;
  const mins = Math.floor(ageSec / 60);
  if (mins < 60) return `${mins} น.`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.`;
  return `${Math.floor(hrs / 24)} วัน`;
}

export function describeConnectionState(state) {
  if (!state) return { label: "ยังไม่ทราบ", ok: false, warn: false, stale: true };
  if (state === "connected") return { label: CONNECTION_LABELS.connected, ok: true, warn: false, stale: false };
  const warn = ["disconnected", "pairing", "logged_out", "replaced"].includes(state);
  return {
    label: CONNECTION_LABELS[state] || "เปลี่ยนสถานะเชื่อมต่อ",
    ok: false,
    warn,
    stale: state === "starting",
  };
}

export function translateIncident(incident) {
  const key = incident?.key || "";
  if (key === "contact") {
    return {
      key,
      title: "ไม่ได้รับสถานะจากเครื่องบอท",
      hint: "ตรวจว่า Mac เปิดอยู่ ไม่หลับ และมีอินเทอร์เน็ต ยังระบุสาเหตุจากเว็บอย่างเดียวไม่ได้",
      openedAt: incident.openedAt,
    };
  }
  if (key.startsWith("ai:")) {
    const capKey = key.slice(3);
    const meta = CAPABILITY_BY_KEY[capKey];
    const hint = (incident.error && ERROR_GUIDANCE[incident.error])
      || "รอดูผลเรียกใช้ครั้งถัดไป ความเงียบไม่ใช่หลักฐานว่าฟื้นตัวแล้ว";
    return {
      key,
      title: meta ? `${meta.name}มีปัญหา` : "บริการ AI มีปัญหา",
      hint,
      openedAt: incident.openedAt,
    };
  }
  return {
    key,
    title: CONNECTION_LABELS[key] || "WhatsApp ขาดการเชื่อมต่อ",
    hint: "ตรวจอุปกรณ์ที่ลิงก์และการเชื่อมต่อ WhatsApp บนเครื่องบอท",
    openedAt: incident.openedAt,
  };
}

export function isErrorEvent(ev) {
  if (!ev) return false;
  if (["ai_error", "send_error", "render_error", "job_interrupted"].includes(ev.type)) return true;
  if (ev.type === "connection" && ["disconnected", "pairing", "logged_out", "replaced"].includes(ev.state)) return true;
  return false;
}

export function classifyEventKind(type) {
  if (!type) return "other";
  if (type.startsWith("ai") || type === "render_error" || type === "job_interrupted") return "ai";
  if (type.startsWith("send") || type === "delivered") return "send";
  if (type === "connection") return "connection";
  return "other";
}

export function translateEvent(ev, isAdmin) {
  const meta = ev.capability ? CAPABILITY_BY_KEY[ev.capability] : null;
  const kind = classifyEventKind(ev.type);
  const ok = !isErrorEvent(ev);
  const cap = meta ? meta.name : kind === "connection" ? "การเชื่อมต่อ" : "ระบบ";

  if (ev.type === "connection") {
    const conn = ev.state !== undefined ? describeConnectionState(ev.state) : null;
    const label = conn ? `WhatsApp ${conn.label}` : EVENT_LABELS.connection;
    const detail = ev.state !== undefined
      ? (conn.warn ? "สถานะขาดการติดต่อ" : "บันทึกสถานะเชื่อมต่อ")
      : "สิทธิ์ทีมงานแสดงเฉพาะเวลาเหตุการณ์";
    return {
      ok,
      kind,
      label,
      cap,
      detail,
      adminHint: isAdmin && ev.state ? `สถานะ: ${conn.label}` : "",
    };
  }

  const label = EVENT_LABELS[ev.type] || ev.type;
  const detailParts = [];
  if (typeof ev.durationMs === "number") detailParts.push(`ใช้เวลา ${formatSec(ev.durationMs)}`);
  if (ev.responseModel) detailParts.push(`ผลตอบกลับ: ${ev.responseModel}`);
  else if (ev.requestedModel && isAdmin) detailParts.push(`โมเดลที่ขอ: ${ev.requestedModel}`);

  const detail = detailParts.length
    ? detailParts.join(" · ")
    : isAdmin
      ? "บันทึกเหตุการณ์ระบบ"
      : "สิทธิ์ทีมงานแสดงเฉพาะสถานะผลลัพธ์";

  let adminHint = "";
  if (isAdmin && ev.error) {
    adminHint = `คำแนะนำผู้ดูแล: ${ERROR_GUIDANCE[ev.error] || ev.error}`;
  } else if (isAdmin && ev.provider) {
    adminHint = ev.provider === "openai" ? "OpenAI · ปกติ" : "Anthropic · ปกติ";
  }

  return { ok, kind, label, cap, detail, adminHint };
}

export function aggregateCapabilities(status) {
  const snap = status?.snapshot || null;
  const calls = Array.isArray(status?.calls) ? status.calls : null;

  return CAPABILITY_META.map((meta) => {
    const model = snap?.models?.find((m) => m.capability === meta.key) || null;
    if (!calls) {
      return {
        ...meta,
        provider: model?.provider || null,
        requestedModel: model?.requestedModel || null,
        responseModel: model?.responseModel || null,
        lastAt: model?.lastAt ?? null,
        lastResult: model?.lastResult ?? null,
        count: 0,
        avgMs: null,
        latestDurationMs: null,
        latestCallType: null,
        latestError: null,
        hasErr: model?.lastResult === "error",
      };
    }

    const capCalls = calls
      .filter((c) => c.capability === meta.key)
      .sort((a, b) => b.at - a.at);
    const timed = capCalls.filter((c) => typeof c.durationMs === "number");
    const avgMs = timed.length
      ? timed.reduce((sum, c) => sum + c.durationMs, 0) / timed.length
      : null;
    const latestCall = capCalls[0] || null;
    const hasErr = latestCall ? latestCall.type === "ai_error" : model?.lastResult === "error";

    return {
      ...meta,
      provider: model?.provider || latestCall?.provider || null,
      requestedModel: model?.requestedModel || latestCall?.requestedModel || null,
      responseModel: model?.responseModel || latestCall?.responseModel || null,
      lastAt: model?.lastAt ?? latestCall?.at ?? null,
      lastResult: model?.lastResult ?? (latestCall ? (latestCall.type === "ai_error" ? "error" : "ok") : null),
      count: capCalls.length,
      avgMs,
      latestDurationMs: latestCall && typeof latestCall.durationMs === "number" ? latestCall.durationMs : null,
      latestCallType: latestCall?.type || null,
      latestError: latestCall?.error || null,
      hasErr,
    };
  });
}

export function bucketHourlyEvents(events, nowMs, hours = 7) {
  const anchorHour = Math.floor((nowMs + UTC_OFFSET_MS) / HOUR_MS) * HOUR_MS - UTC_OFFSET_MS;
  const buckets = Array.from({ length: hours }, (_, i) => {
    const start = anchorHour - (hours - 1 - i) * HOUR_MS;
    return { start, end: start + HOUR_MS, label: formatBkkHm(start), ok: 0, err: 0 };
  });

  for (const ev of events || []) {
    if (typeof ev?.at !== "number") continue;
    const slot = buckets.find((b) => ev.at >= b.start && ev.at < b.end);
    if (!slot) continue;
    if (isErrorEvent(ev)) slot.err += 1;
    else slot.ok += 1;
  }

  return buckets;
}

export function summarizeQueues(queues, nowMs) {
  if (!Array.isArray(queues)) return null;
  const byName = Object.fromEntries(queues.map((q) => [q.name, q]));
  const waitingTotal = queues.reduce((sum, q) => sum + (q.waiting || 0), 0);
  const runningTotal = queues.reduce((sum, q) => sum + (q.running || 0), 0);
  const oldestAts = queues
    .map((q) => q.oldestAt)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const oldestAt = oldestAts.length ? Math.min(...oldestAts) : null;
  const oldestAgeMs = oldestAt !== null && typeof nowMs === "number" ? Math.max(0, nowMs - oldestAt) : null;

  return {
    waitingTotal,
    runningTotal,
    inFlightTotal: waitingTotal + runningTotal,
    oldestAt,
    oldestAgeMs,
    byName,
  };
}

export function mergeHistoryPage(existing = [], incoming = []) {
  const keyOf = (e) => e.id || `${e.type}:${e.at}:${e.capability || ""}`;
  const seen = new Set(existing.map(keyOf));
  const out = [...existing];
  for (const ev of incoming) {
    const k = keyOf(ev);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(ev);
    }
  }
  return out;
}
