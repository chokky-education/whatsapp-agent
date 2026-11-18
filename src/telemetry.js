// Privacy-safe operational observations. No chat text, JIDs, prompts or raw errors.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CAPABILITIES,
  QUEUES,
  safeModel,
  classifyError,
} from "../warroom/src/protocol.js";

export function createTelemetry({ now = Date.now, models = {} } = {}) {
  const runId = randomUUID();
  const startedAt = now();
  let seq = 0,
    eventSeq = 0,
    droppedEvents = 0;
  const events = [];
  const queues = Object.fromEntries(QUEUES.map((k) => [k, new Map()]));
  const state = {
    connection: {
      state: "starting",
      since: startedAt,
      unavailableSince: startedAt,
      actionRequired: null,
    },
    activity: { inbound: null, sent: null, delivered: null },
    models: [],
  };
  function event(type, details = {}) {
    const e = {
      id: `${runId}:${++eventSeq}`,
      at: now(),
      type,
      capability: CAPABILITIES.includes(details.capability)
        ? details.capability
        : null,
      provider: ["openai", "anthropic"].includes(details.provider)
        ? details.provider
        : null,
      requestedModel: safeModel(details.requestedModel),
      responseModel: safeModel(details.responseModel),
      error: details.error || null,
      durationMs: details.durationMs ?? null,
      state: details.state || null,
    };
    events.push(e);
    if (events.length > 500) {
      events.shift();
      droppedEvents++;
    }
  }
  function configure(value) {
    state.models = CAPABILITIES.map((capability) => ({
      capability,
      provider: value[capability]?.provider,
      requestedModel: safeModel(value[capability]?.requestedModel),
      responseModel: null,
      lastAt: null,
      lastResult: null,
    }));
  }
  configure(models);
  return {
    configure,
    event,
    connection(value) {
      if (state.connection.state !== value) {
        state.connection = {
          state: value,
          since: now(),
          unavailableSince:
            value === "connected"
              ? null
              : state.connection.unavailableSince || now(),
          actionRequired:
            value === "connected"
              ? null
              : ["pairing", "logged_out", "replaced"].includes(value)
                ? value
                : state.connection.actionRequired,
        };
        event("connection", { state: value });
      }
    },
    inbound() {
      state.activity.inbound = now();
    },
    sent() {
      state.activity.sent = now();
      event("send_ok");
    },
    delivered() {
      state.activity.delivered = now();
      event("delivered");
    },
    queue(name) {
      const id = randomUUID();
      queues[name].set(id, { at: now(), running: false });
      return {
        start() {
          const q = queues[name].get(id);
          if (q) q.running = true;
        },
        end() {
          queues[name].delete(id);
        },
      };
    },
    async ai(capability, provider, requestedModel, job) {
      const start = now();
      let responseModel = null;
      try {
        const result = await job((model) => {
          responseModel = safeModel(model);
        });
        Object.assign(
          state.models.find((m) => m.capability === capability) || {},
          {
            provider,
            requestedModel: safeModel(requestedModel),
            responseModel,
            lastAt: now(),
            lastResult: "ok",
          },
        );
        event("ai_ok", {
          capability,
          provider,
          requestedModel,
          responseModel,
          durationMs: now() - start,
        });
        return result;
      } catch (err) {
        Object.assign(
          state.models.find((m) => m.capability === capability) || {},
          {
            provider,
            requestedModel: safeModel(requestedModel),
            responseModel,
            lastAt: now(),
            lastResult: "error",
          },
        );
        event("ai_error", {
          capability,
          provider,
          requestedModel,
          responseModel,
          error: classifyError(err),
          durationMs: now() - start,
        });
        throw err;
      }
    },
    snapshot() {
      return {
        version: 1,
        runId,
        seq: ++seq,
        startedAt,
        generatedAt: now(),
        ...structuredClone(state),
        droppedEvents,
        queues: QUEUES.map((name) => {
          const jobs = [...queues[name].values()];
          return {
            name,
            waiting: jobs.filter((j) => !j.running).length,
            running: jobs.filter((j) => j.running).length,
            oldestAt: jobs.length ? Math.min(...jobs.map((j) => j.at)) : null,
          };
        }),
        events: events
          .filter((e) => e.at >= now() - 30 * 86400_000)
          .slice(0, 200),
      };
    },
    ack(ids) {
      const set = new Set(ids);
      for (let i = events.length - 1; i >= 0; i--)
        if (set.has(events[i].id)) events.splice(i, 1);
    },
    restore(saved) {
      for (const key of ["inbound", "sent", "delivered"]) {
        const value = saved?.activity?.[key];
        if (Number.isSafeInteger(value) && value >= 0 && value <= now())
          state.activity[key] = value;
      }
      for (const current of state.models) {
        const previous = saved?.models?.find(
          (m) =>
            m.capability === current.capability &&
            m.provider === current.provider &&
            m.requestedModel === current.requestedModel,
        );
        if (
          previous &&
          Number.isSafeInteger(previous.lastAt) &&
          previous.lastAt <= now()
        )
          Object.assign(current, {
            responseModel: safeModel(previous.responseModel),
            lastAt: previous.lastAt,
            lastResult: ["ok", "error"].includes(previous.lastResult)
              ? previous.lastResult
              : null,
          });
      }
      if (saved?.connection?.unavailableSince)
        state.connection.unavailableSince = saved.connection.unavailableSince;
      if (
        ["pairing", "logged_out", "replaced"].includes(
          saved?.connection?.actionRequired,
        )
      )
        state.connection.actionRequired = saved.connection.actionRequired;
      for (const e of saved?.events || [])
        if (events.length < 500) events.push(e);
      if (saved?.active) event("job_interrupted");
    },
    checkpoint() {
      return {
        connection: { ...state.connection },
        activity: { ...state.activity },
        models: structuredClone(state.models),
        events: events.slice(-500),
        active: Object.values(queues).some((q) => q.size),
      };
    },
  };
}
export const telemetry = createTelemetry();

export function startTelemetry({
  url,
  token,
  dataDir,
  models,
  fetcher = fetch,
}) {
  telemetry.configure(models);
  if (!url || !token) return () => {};
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    return () => {};
  const file = path.join(dataDir, "warroom-telemetry.json");
  try {
    telemetry.restore(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {}
  let sending = false;
  const save = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(telemetry.checkpoint()), {
        mode: 0o600,
      });
      fs.renameSync(file + ".tmp", file);
    } catch {}
  };
  async function flush() {
    if (sending) return;
    sending = true;
    try {
      save();
      const body = telemetry.snapshot();
      const r = await fetcher(new URL("/api/telemetry", endpoint), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (r.ok && (await r.json()).accepted) {
        telemetry.ack(body.events.map((e) => e.id));
        save();
      }
    } catch {
    } finally {
      sending = false;
    }
  }
  const timer = setInterval(flush, 30000);
  timer.unref();
  const journal = setInterval(save, 5000);
  journal.unref();
  process.on("exit", save);
  void flush();
  return () => {
    clearInterval(timer);
    clearInterval(journal);
    save();
    process.off("exit", save);
  };
}
