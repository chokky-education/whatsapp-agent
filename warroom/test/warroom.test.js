import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import {
  database,
  snapshot,
  seedLive,
  seedEvent,
  seedSession,
} from "./support.js";
import { sanitizeSnapshot } from "../src/protocol.js";
import { evaluate, deliver, pauseState, MINUTE } from "../src/monitor.js";
import worker from "../src/worker.js";
import { verifyGoogle } from "../src/auth.js";
import { createTelemetry } from "../../src/telemetry.js";
const now = Date.now();
test("telemetry strips private fields and rejects stale or future payloads", () => {
  const p = snapshot(now);
  p.text = "secret chat";
  p.queues[0].jid = "66800000000";
  p.models[0].apiKey = "sk-example";
  const safe = sanitizeSnapshot(p, now);
  assert.ok(!JSON.stringify(safe).includes("secret chat"));
  assert.ok(!JSON.stringify(safe).includes("sk-example"));
  assert.throws(() =>
    sanitizeSnapshot({ ...p, generatedAt: now - 121000 }, now),
  );
  assert.throws(() =>
    sanitizeSnapshot({ ...p, generatedAt: now + 61000 }, now),
  );
});
test("collector records actual response model, never raw errors; queues track independent jobs", async () => {
  let time = now;
  const t = createTelemetry({ now: () => time });
  t.configure({
    requests: { provider: "openai", requestedModel: "example-requested" },
  });
  const job = t.queue("main");
  job.start();
  assert.equal(t.snapshot().queues[0].running, 1);
  time += 5;
  await t.ai("requests", "openai", "example-requested", async (report) => {
    report("example-actual");
    return "private reply";
  });
  assert.equal(t.snapshot().models[0].responseModel, "example-actual");
  await assert.rejects(
    t.ai("requests", "openai", "example-requested", async () => {
      throw Object.assign(new Error("private prompt"), { status: 401 });
    }),
  );
  assert.equal(t.snapshot().events.at(-1).error, "auth");
  assert.ok(!JSON.stringify(t.snapshot()).includes("private"));
  job.end();
  assert.equal(t.snapshot().queues[0].running, 0);
});
test("first alert after 5m, hourly repeat, recovery; never no-data false outage", async () => {
  const db = database();
  await evaluate(db, now);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM incidents").first()).n,
    0,
  );
  const p = snapshot(now);
  await seedLive(db, p, now);
  await evaluate(db, now + 4 * MINUTE);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM outbox").first()).n,
    0,
  );
  await evaluate(db, now + 5 * MINUTE);
  let sent = [];
  await deliver(db, async (e) => sent.push(e.kind), now + 5 * MINUTE);
  assert.deepEqual(sent, ["open"]);
  await evaluate(db, now + 6 * MINUTE);
  await deliver(db, async (e) => sent.push(e.kind), now + 6 * MINUTE);
  assert.equal(sent.length, 1);
  await evaluate(db, now + 65 * MINUTE);
  await deliver(db, async (e) => sent.push(e.kind), now + 65 * MINUTE);
  assert.deepEqual(sent, ["open", "reminder"]);
  await seedLive(db, p, now + 66 * MINUTE);
  await evaluate(db, now + 66 * MINUTE);
  await deliver(db, async (e) => sent.push(e.kind), now + 66 * MINUTE);
  assert.deepEqual(sent, ["open", "reminder", "recovery"]);
  db.close();
});
test("AI streak scoped to capability; silence does not recover it; success resets it", async () => {
  const db = database();
  await seedLive(db, snapshot(now), now);
  for (const t of [now - 120000, now - 60000, now - 1000])
    await seedEvent(db, "render", "ai_error", t, "network");
  await seedEvent(db, "requests", "ai_ok", now);
  await evaluate(db, now);
  assert.equal(
    (
      await db
        .prepare("SELECT active FROM incidents WHERE key='ai:render'")
        .first()
    ).active,
    1,
  );
  assert.equal(
    await db.prepare("SELECT * FROM incidents WHERE key='ai:requests'").first(),
    null,
  );
  await seedLive(db, snapshot(now + 20 * MINUTE), now + 20 * MINUTE);
  await evaluate(db, now + 20 * MINUTE);
  assert.equal(
    (
      await db
        .prepare("SELECT active FROM incidents WHERE key='ai:render'")
        .first()
    ).active,
    1,
  );
  await seedEvent(db, "render", "ai_ok", now + 20 * MINUTE + 1);
  await evaluate(db, now + 20 * MINUTE + 2);
  assert.equal(
    (
      await db
        .prepare("SELECT active FROM incidents WHERE key='ai:render'")
        .first()
    ).active,
    0,
  );
  db.close();
});
test("pause expiry alerts ongoing issue; issues wholly within pause do not send retrospective mail", async () => {
  const db = database();
  const p = snapshot(now);
  await seedLive(db, p, now);
  await db
    .prepare("INSERT INTO settings(key,value) VALUES('pause',?)")
    .bind(
      JSON.stringify({ until: now + 30 * MINUTE, actor: "admin@example.com" }),
    )
    .run();
  await evaluate(db, now + 5 * MINUTE);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM outbox").first()).n,
    0,
  );
  await evaluate(db, now + 30 * MINUTE);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM outbox").first()).n,
    1,
  );
  db.close();
  const db2 = database();
  await seedLive(db2, p, now);
  await db2
    .prepare("INSERT INTO settings(key,value) VALUES('pause',?)")
    .bind(JSON.stringify({ until: now + 30 * MINUTE }))
    .run();
  await evaluate(db2, now + 5 * MINUTE);
  await seedLive(db2, p, now + 6 * MINUTE);
  await evaluate(db2, now + 6 * MINUTE);
  await seedLive(db2, p, now + 30 * MINUTE);
  await evaluate(db2, now + 30 * MINUTE);
  assert.equal(
    (await db2.prepare("SELECT COUNT(*) n FROM outbox").first()).n,
    0,
  );
  db2.close();
});
test("failed email is visible and retried, successful acceptance is not claimed as delivery", async () => {
  const db = database();
  await seedLive(db, snapshot(now), now - 6 * MINUTE);
  await evaluate(db, now);
  await deliver(
    db,
    async () => {
      throw new Error("secret provider error");
    },
    now,
  );
  const row = await db.prepare("SELECT * FROM outbox").first();
  assert.equal(row.status, "pending");
  assert.equal(row.error, "mail_send_failed");
  assert.equal(row.sent_at, null);
  await deliver(db, async () => {}, now + MINUTE);
  assert.equal(
    (await db.prepare("SELECT status FROM outbox").first()).status,
    "sent",
  );
  db.close();
});
test("server authorization, CSRF, last-admin and revoked sessions are enforced independent of UI", async () => {
  const db = database();
  const a = await seedSession(db),
    t = await seedSession(db, "team");
  const env = { DB: db };
  const call = (
    path,
    who,
    method = "GET",
    data,
    origin = "https://example.test",
  ) =>
    worker.fetch(
      new Request("https://example.test" + path, {
        method,
        headers: {
          cookie: `__Host-warroom=${who.raw}`,
          "x-csrf-token": who.csrf,
          origin,
          "content-type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      env,
      {},
    );
  assert.equal((await call("/api/members", t)).status, 403);
  assert.equal(
    (
      await call(
        "/api/pause",
        a,
        "POST",
        { minutes: 30 },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/members", a, "DELETE", { email: a.email })).status,
    409,
  );
  assert.equal(
    (await call("/api/members", a, "POST", { email: a.email, role: "team" }))
      .status,
    409,
  );
  assert.equal(
    (await call("/api/members", a, "DELETE", { email: t.email })).status,
    200,
  );
  assert.equal((await call("/api/status", t)).status, 401);
  db.close();
});
test("ingest authentication and replay prevention do not refresh liveness", async () => {
  const db = database(),
    env = { DB: db, WARROOM_INGEST_TOKEN: "test-token" },
    p = snapshot();
  const post = (token) =>
    worker.fetch(
      new Request("https://example.test/api/telemetry", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(p),
      }),
      env,
      {},
    );
  assert.equal((await post("wrong")).status, 401);
  assert.equal((await post("test-token")).status, 200);
  const first = await db.prepare("SELECT received_at FROM live").first();
  const second = await post("test-token");
  assert.equal((await second.json()).accepted, false);
  assert.equal(
    (await db.prepare("SELECT received_at FROM live").first()).received_at,
    first.received_at,
  );
  db.close();
});
test("Google JWT signature/audience/issuer/nonce and mailbox authority are required", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const make = (extra = {}) =>
    new SignJWT({
      email: "nok@gmail.com",
      email_verified: true,
      nonce: "nonce",
      ...extra,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience("client")
      .setSubject("synthetic-google-sub")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  assert.equal(
    (await verifyGoogle(await make(), "client", "nonce", publicKey)).email,
    "nok@gmail.com",
  );
  await assert.rejects(verifyGoogle(await make(), "wrong", "nonce", publicKey));
  await assert.rejects(
    verifyGoogle(await make(), "client", "wrong", publicKey),
  );
  await assert.rejects(
    verifyGoogle(
      await make({ email: "nok@example.com" }),
      "client",
      "nonce",
      publicKey,
    ),
  );
});
test("reconnect attempts preserve outage duration and only a connection resets it", async () => {
  let time = now;
  const t = createTelemetry({ now: () => time });
  t.connection("connected");
  time += MINUTE;
  t.connection("disconnected");
  const first = time;
  time += 3 * MINUTE;
  t.connection("starting");
  time += 3 * MINUTE;
  t.connection("disconnected");
  assert.equal(t.snapshot().connection.unavailableSince, first);
  const db = database(),
    p = snapshot(time);
  p.connection = t.snapshot().connection;
  await seedLive(db, p, time);
  await evaluate(db, time);
  assert.equal(
    (
      await db
        .prepare("SELECT active FROM incidents WHERE key='connection'")
        .first()
    ).active,
    1,
  );
  t.connection("connected");
  assert.equal(t.snapshot().connection.unavailableSince, null);
  db.close();
});
test("pause expiry makes an already-notified incident immediately due, once", async () => {
  const db = database();
  await seedLive(db, snapshot(now), now - 6 * MINUTE);
  await evaluate(db, now);
  const sent = [];
  await deliver(db, async (e) => sent.push(e.kind), now);
  await db
    .prepare("INSERT INTO settings(key,value) VALUES('pause',?)")
    .bind(
      JSON.stringify({ until: now + 30 * MINUTE, actor: "admin@example.com" }),
    )
    .run();
  await evaluate(db, now + 29 * MINUTE);
  await deliver(db, async (e) => sent.push(e.kind), now + 29 * MINUTE);
  assert.equal(sent.length, 1);
  await evaluate(db, now + 30 * MINUTE);
  await deliver(db, async (e) => sent.push(e.kind), now + 30 * MINUTE);
  assert.deepEqual(sent, ["open", "reminder"]);
  await evaluate(db, now + 31 * MINUTE);
  await deliver(db, async (e) => sent.push(e.kind), now + 31 * MINUTE);
  assert.equal(sent.length, 2);
  db.close();
});
test("mail outage does not accumulate hourly copies of the same alert", async () => {
  const db = database();
  await seedLive(db, snapshot(now), now - 6 * MINUTE);
  for (let h = 0; h < 4; h++) {
    await evaluate(db, now + h * 60 * MINUTE);
    await deliver(
      db,
      async () => {
        throw new Error("unavailable");
      },
      now + h * 60 * MINUTE,
    );
  }
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM outbox WHERE status='pending'")
        .first()
    ).n,
    1,
  );
  db.close();
});
test("history pagination preserves events that share a timestamp", async () => {
  const db = database(),
    a = await seedSession(db);
  for (let i = 0; i < 105; i++) await seedEvent(db, "render", "ai_ok", now);
  const call = async (query) => {
    const r = await worker.fetch(
      new Request("https://example.test/api/history" + query, {
        headers: { cookie: `__Host-warroom=${a.raw}` },
      }),
      { DB: db },
      {},
    );
    assert.equal(r.status, 200);
    return r.json();
  };
  const first = await call("");
  assert.equal(first.events.length, 100);
  const second = await call(
    `?before=${first.nextBefore}&cursor=${encodeURIComponent(first.nextCursor)}`,
  );
  assert.equal(second.events.length, 5);
  assert.equal(
    new Set([...first.events, ...second.events].map((e) => e.id)).size,
    105,
  );
  db.close();
});
test("stale events in the local spool cannot block current heartbeats", () => {
  let time = now;
  const t = createTelemetry({ now: () => time });
  t.event("send_ok");
  time += 31 * 86400_000;
  assert.equal(t.snapshot().events.length, 0);
});
test("restart preserves continuing outage and administrator action until connected", async () => {
  let time = now;
  const t = createTelemetry({ now: () => time });
  t.connection("logged_out");
  const saved = t.checkpoint();
  time += 6 * MINUTE;
  const restarted = createTelemetry({ now: () => time });
  restarted.restore(saved);
  restarted.connection("starting");
  const p = snapshot(time);
  p.connection = restarted.snapshot().connection;
  assert.equal(p.connection.unavailableSince, now);
  const db = database();
  await seedLive(db, p, time);
  await evaluate(db, time);
  assert.equal(
    (
      await db
        .prepare("SELECT active FROM incidents WHERE key='logged_out'")
        .first()
    ).active,
    1,
  );
  restarted.connection("connected");
  assert.equal(restarted.snapshot().connection.actionRequired, null);
  db.close();
});
test("restart retains message evidence but does not misattribute an old response model to a new model", async () => {
  const models = {
    requests: { provider: "openai", requestedModel: "example-first" },
  };
  let time = now;
  const old = createTelemetry({ now: () => time, models });
  old.sent();
  await old.ai("requests", "openai", "example-first", async (report) =>
    report("example-response"),
  );
  const saved = old.checkpoint();
  time += MINUTE;
  const same = createTelemetry({ now: () => time, models });
  same.restore(saved);
  assert.equal(same.snapshot().activity.sent, now);
  assert.equal(same.snapshot().models[0].responseModel, "example-response");
  const changed = createTelemetry({
    now: () => time,
    models: {
      requests: { provider: "openai", requestedModel: "example-second" },
    },
  });
  changed.restore(saved);
  assert.equal(changed.snapshot().models[0].responseModel, null);
});
