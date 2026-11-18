export const CAPABILITIES = [
  "requests",
  "task_sync",
  "summary",
  "media",
  "render",
];
export const QUEUES = ["main", "media", "render"];
export const CONNECTIONS = [
  "starting",
  "connected",
  "disconnected",
  "pairing",
  "logged_out",
  "replaced",
];
export const ERRORS = [
  "auth",
  "permission",
  "model_missing",
  "rate_limit",
  "network",
  "incomplete",
  "refused",
  "unknown",
];
export const EVENT_TYPES = [
  "ai_ok",
  "ai_error",
  "send_ok",
  "send_error",
  "delivered",
  "job_interrupted",
  "render_error",
  "connection",
];
const num = (v, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= 0 && v <= max;
export const safeModel = (v) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(v) &&
  !/sk-|https?:|token|secret/i.test(v)
    ? v
    : null;
const provider = (v) => (["openai", "anthropic"].includes(v) ? v : null);
const timestamp = (v) => (v === null ? null : num(v) ? v : null);
function required(ok) {
  if (!ok) throw new Error("invalid_telemetry");
}

// Construct a new object field by field. Never forward arbitrary bot fields.
export function sanitizeSnapshot(p, now = Date.now()) {
  required(
    p?.version === 1 &&
      /^[a-f0-9-]{36}$/.test(p.runId || "") &&
      num(p.seq) &&
      num(p.startedAt) &&
      num(p.generatedAt),
  );
  required(
    p.startedAt <= p.generatedAt &&
      p.generatedAt <= now + 60_000 &&
      p.generatedAt >= now - 120_000,
  );
  required(CONNECTIONS.includes(p.connection?.state));
  const models = CAPABILITIES.map((capability) => {
    const m = p.models?.find((x) => x.capability === capability) || {};
    required(provider(m.provider) && safeModel(m.requestedModel));
    return {
      capability,
      provider: provider(m.provider),
      requestedModel: safeModel(m.requestedModel),
      responseModel: safeModel(m.responseModel),
      lastAt: timestamp(m.lastAt),
      lastResult: ["ok", "error"].includes(m.lastResult) ? m.lastResult : null,
    };
  });
  const queues = QUEUES.map((name) => {
    const q = p.queues?.find((x) => x.name === name) || {};
    required(num(q.waiting, 100000) && num(q.running, 100000));
    return {
      name,
      waiting: q.waiting,
      running: q.running,
      oldestAt: timestamp(q.oldestAt),
    };
  });
  required(Array.isArray(p.events) && p.events.length <= 200);
  const events = p.events.map((e) => {
    required(
      typeof e.id === "string" &&
        /^[a-f0-9-]{36}:\d{1,12}$/.test(e.id) &&
        EVENT_TYPES.includes(e.type) &&
        num(e.at) &&
        e.at <= now + 60_000 &&
        e.at >= now - 30 * 86400_000,
    );
    return {
      id: e.id,
      type: e.type,
      at: e.at,
      capability: CAPABILITIES.includes(e.capability) ? e.capability : null,
      provider: provider(e.provider),
      requestedModel: safeModel(e.requestedModel),
      responseModel: safeModel(e.responseModel),
      error: ERRORS.includes(e.error) ? e.error : null,
      durationMs: num(e.durationMs, 86400_000) ? e.durationMs : null,
      state: CONNECTIONS.includes(e.state) ? e.state : null,
    };
  });
  return {
    version: 1,
    runId: p.runId,
    seq: p.seq,
    startedAt: p.startedAt,
    generatedAt: p.generatedAt,
    connection: {
      state: p.connection.state,
      since: timestamp(p.connection.since),
      unavailableSince: timestamp(p.connection.unavailableSince),
      actionRequired: ["pairing", "logged_out", "replaced"].includes(
        p.connection.actionRequired,
      )
        ? p.connection.actionRequired
        : null,
    },
    activity: {
      inbound: timestamp(p.activity?.inbound),
      sent: timestamp(p.activity?.sent),
      delivered: timestamp(p.activity?.delivered),
    },
    queues,
    models,
    events,
    droppedEvents: num(p.droppedEvents) ? p.droppedEvents : 0,
  };
}

export function classifyError(err) {
  if (err?.status === 401) return "auth";
  if (err?.status === 403) return "permission";
  if (err?.status === 404) return "model_missing";
  if (err?.status === 429) return "rate_limit";
  if (/incomplete|max_tokens|ตอบไม่ครบ/.test(err?.message || ""))
    return "incomplete";
  if (/refusal|ปฏิเสธ/.test(err?.message || "")) return "refused";
  if (err?.code || /connection|timeout|network/i.test(err?.name || ""))
    return "network";
  return "unknown";
}
