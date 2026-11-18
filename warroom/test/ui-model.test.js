import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshot } from "./support.js";
import {
  CAPABILITY_META,
  formatBkkHm,
  formatBkkTime,
  formatBkkDateTime,
  formatSec,
  formatAge,
  formatShortAge,
  aggregateCapabilities,
  bucketHourlyEvents,
  summarizeQueues,
  describeConnectionState,
  translateIncident,
  translateEvent,
  mergeHistoryPage,
} from "../public/view-model.js";

test("formats unix millisecond timestamps in fixed Asia/Bangkok offset", () => {
  const ms = Date.UTC(2026, 10, 16, 6, 20, 5); // 13:20:05 Bangkok
  assert.equal(formatBkkHm(ms), "13:20");
  assert.equal(formatBkkTime(ms), "13:20:05");
  assert.equal(formatBkkDateTime(ms), "16 พ.ย. 13:20:05");
  assert.equal(formatSec(1850), "1.9 วิ");
  assert.equal(formatSec(null), "—");
  assert.equal(formatAge(160_000), "2 น. 40 วิ ที่แล้ว");
  assert.equal(formatShortAge(4 * 60_000), "4 น.");
  assert.equal(formatShortAge(null), "ยังไม่เรียก");
  assert.equal(CAPABILITY_META.length, 5);
});

test("aggregateCapabilities aggregates admin calls honestly and never fabricates ms for team", () => {
  const now = Date.UTC(2026, 10, 16, 6, 20, 0);
  const snap = snapshot(now);
  snap.models[0].lastAt = now - 120_000;
  snap.models[0].lastResult = "ok";
  snap.models[0].responseModel = "example-response-model";
  snap.models[2].lastAt = now - 240_000;
  snap.models[2].lastResult = "error";

  const adminStatus = {
    now,
    receivedAt: now,
    stale: false,
    snapshot: snap,
    calls: [
      { id: "c1", type: "ai_ok", at: now - 120_000, capability: "requests", durationMs: 1800, error: null },
      { id: "c2", type: "ai_ok", at: now - 300_000, capability: "requests", durationMs: 1400, error: null },
      { id: "c3", type: "ai_error", at: now - 240_000, capability: "summary", durationMs: 5100, error: "network" },
    ],
  };

  const adminCaps = aggregateCapabilities(adminStatus);
  const req = adminCaps.find((c) => c.key === "requests");
  const sum = adminCaps.find((c) => c.key === "summary");
  const ren = adminCaps.find((c) => c.key === "render");
  assert.equal(req.count, 2);
  assert.equal(req.avgMs, 1600);
  assert.equal(req.latestDurationMs, 1800);
  assert.equal(req.latestCallType, "ai_ok");
  assert.equal(sum.hasErr, true);
  assert.equal(sum.latestError, "network");
  assert.equal(ren.count, 0);
  assert.equal(ren.avgMs, null);
  assert.equal(ren.latestDurationMs, null);

  const teamStatus = { ...adminStatus, calls: undefined };
  const teamCaps = aggregateCapabilities(teamStatus);
  assert.equal(teamCaps[0].avgMs, null);
  assert.equal(teamCaps[0].latestDurationMs, null);
  assert.equal(teamCaps[0].lastResult, "ok");
  assert.equal(teamCaps[0].responseModel, "example-response-model");
  assert.equal(teamCaps[2].lastResult, "error");
});

test("bucketHourlyEvents buckets ms events across 7 Bangkok hours without fabricating team errors", () => {
  const now = Date.UTC(2026, 10, 16, 6, 20, 0); // 13:20 BKK
  const events = [
    { id: "e1", type: "ai_ok", at: Date.UTC(2026, 10, 16, 6, 5, 0), capability: "requests" },
    { id: "e2", type: "ai_error", at: Date.UTC(2026, 10, 16, 6, 10, 0), capability: "summary" },
    { id: "e3", type: "connection", at: Date.UTC(2026, 10, 16, 6, 12, 0), state: "disconnected" },
    { id: "e4", type: "connection", at: Date.UTC(2026, 10, 16, 4, 15, 0) }, // team-masked connection event (state undefined)
    { id: "e5", type: "ai_ok", at: Date.UTC(2026, 10, 15, 22, 0, 0), capability: "media" }, // outside 7h window
  ];

  const buckets = bucketHourlyEvents(events, now, 7);
  assert.equal(buckets.length, 7);
  assert.equal(buckets[0].label, "07:00");
  assert.equal(buckets[6].label, "13:00");
  assert.equal(buckets[6].ok, 1);
  assert.equal(buckets[6].err, 2);
  assert.equal(buckets[4].label, "11:00");
  assert.equal(buckets[4].ok, 1);
  assert.equal(buckets[4].err, 0);
});

test("summarizeQueues calculates totals and oldest non-null oldestAt", () => {
  const now = Date.UTC(2026, 10, 16, 6, 20, 0);
  const queues = [
    { name: "main", waiting: 3, running: 1, oldestAt: now - 160_000 },
    { name: "media", waiting: 1, running: 0, oldestAt: now - 90_000 },
    { name: "render", waiting: 0, running: 0, oldestAt: null },
  ];
  const s = summarizeQueues(queues, now);
  assert.equal(s.waitingTotal, 4);
  assert.equal(s.runningTotal, 1);
  assert.equal(s.inFlightTotal, 5);
  assert.equal(s.oldestAt, now - 160_000);
  assert.equal(s.oldestAgeMs, 160_000);
  assert.equal(s.byName.main.waiting, 3);
  assert.equal(summarizeQueues(null, now), null);
});

test("translates real Worker connection/incidents/events and preserves pagination uniqueness", () => {
  assert.deepEqual(describeConnectionState("connected"), { label: "เชื่อมต่อแล้ว", ok: true, warn: false, stale: false });
  assert.deepEqual(describeConnectionState("disconnected"), { label: "ขาดการเชื่อมต่อ", ok: false, warn: true, stale: false });
  assert.equal(describeConnectionState("logged_out").warn, true);
  assert.equal(describeConnectionState("starting").warn, false);

  const inc = translateIncident({ key: "ai:summary", error: "rate_limit", openedAt: 1000 });
  assert.equal(inc.title, "สรุปบทสนทนามีปัญหา");
  assert.match(inc.hint, /โควตา/);

  const evAdmin = translateEvent({
    id: "1",
    type: "ai_error",
    at: 2000,
    capability: "summary",
    error: "network",
    durationMs: 4200,
    provider: "openai",
  }, true);
  assert.equal(evAdmin.ok, false);
  assert.match(evAdmin.detail, /4\.2 วิ/);
  assert.match(evAdmin.adminHint, /เครือข่าย/);

  const evTeam = translateEvent({ type: "connection", at: 3000, capability: null }, false);
  assert.equal(evTeam.kind, "connection");
  assert.equal(evTeam.adminHint, "");

  const merged = mergeHistoryPage(
    [{ id: "b:2", at: 2000, type: "ai_ok" }, { id: "a:1", at: 1000, type: "ai_ok" }],
    [{ id: "a:1", at: 1000, type: "ai_ok" }, { id: "a:0", at: 1000, type: "send_ok" }],
  );
  assert.equal(merged.length, 3);
});
