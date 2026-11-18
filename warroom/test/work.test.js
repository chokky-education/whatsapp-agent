import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import worker from "../src/worker.js";
import { hash } from "../src/auth.js";
import { database, seedSession } from "./support.js";
import { groupWorkTasks } from "../public/work-view.js";

const origin = "https://example.test";

async function setup(t) {
  const db = database();
  t.after(() => db.close());
  const admin = await seedSession(db, "admin");
  const team = await seedSession(db, "team");
  const now = Date.now();
  const env = {
    DB: db,
    WORK_ENABLED: "true",
    WORK_PILOT_ID: randomUUID(),
    WORK_MEMBER_KEY: randomUUID(),
    WORK_BRIDGE_TOKEN: "synthetic-work-token",
    WARROOM_INGEST_TOKEN: "synthetic-telemetry-token",
  };
  const sub = "example-pilot-owner";
  await db.prepare("UPDATE members SET sub=? WHERE email=?").bind(sub, admin.email).run();
  await db.prepare("INSERT INTO work_access(pilot,google_sub,member_key) VALUES(?,?,?)")
    .bind(env.WORK_PILOT_ID, sub, env.WORK_MEMBER_KEY).run();
  async function bindIdentity() {
    await db.prepare("INSERT INTO work_session_subjects(session_hash,google_sub) VALUES(?,?)")
      .bind(await hash(admin.raw), sub).run();
  }
  async function request(path, { identity, data, method = data === undefined ? "GET" : "POST", token, csrf } = {}) {
    const response = await worker.fetch(new Request(origin + path, {
      method,
      headers: {
        origin,
        ...(identity ? { cookie: `__Host-warroom=${identity.raw}`, "x-csrf-token": csrf ?? identity.csrf } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    }), env, {});
    assert.equal(response.headers.get("cache-control"), "no-store");
    return [response.status, await response.json()];
  }
  const runId = randomUUID();
  const tasks = [
    { id: 1, title: "เช็กแบบไฟ", projectId: 1, project: "บ้านตัวอย่าง", assignee: "นก",
      mine: true, dueAt: now, doneAt: null },
    { id: 2, title: "ตรวจรูปตัด", projectId: null, project: null, assignee: "สมชาย",
      mine: false, dueAt: null, doneAt: null },
  ];
  function syncPayload(revision, changes = {}) {
    return { pilot: env.WORK_PILOT_ID, memberKey: env.WORK_MEMBER_KEY, runId, revision, epoch: 0, generatedAt: Date.now(),
      proofAt: Date.now(), mode: "ready", tasks, outcomes: [], ...changes };
  }
  const sync = (revision, changes) => request("/api/work/bridge", {
    token: env.WORK_BRIDGE_TOKEN, data: syncPayload(revision, changes),
  });
  const authorize = (command, overrides = {}) => request("/api/work/bridge/authorize", {
    token: env.WORK_BRIDGE_TOKEN,
    data: { pilot: env.WORK_PILOT_ID, runId, ...command, ...overrides },
  });
  return { db, admin, team, env, bindIdentity, request, sync, syncPayload, authorize, tasks, runId, now };
}

test("Work requires a separately paired, subject-bound session; bridge key is separate", async (t) => {
  const { admin, team, env, bindIdentity, request, sync, syncPayload } = await setup(t);
  assert.equal((await request("/api/work"))[0], 401);
  assert.equal((await request("/api/work", { identity: team }))[0], 403);
  assert.deepEqual(await request("/api/work", { identity: admin }), [403, { error: "work_reauth" }]);
  await bindIdentity();
  assert.equal((await request("/api/work/bridge", { data: syncPayload(1), token: env.WARROOM_INGEST_TOKEN }))[0], 401);
  assert.equal((await sync(1))[0], 200);
  assert.equal((await sync(2, { memberKey: randomUUID() }))[0], 400);
  const [status, data] = await request("/api/work", { identity: admin });
  assert.equal(status, 200);
  assert.deepEqual(data.tasks.map((task) => [task.id, task.mine]), [[1, true], [2, false]]);
  assert.equal(data.writable, true);
  assert.equal("memberKey" in data || "pilot" in data || "runId" in data, false);
  env.WORK_ENABLED = "false";
  assert.equal((await request("/api/work", { identity: admin }))[0], 404);
  assert.equal((await request("/api/session", { identity: admin }))[0], 200);
});

test("completion requires ownership and CSRF, reports only bot-confirmed results, and deduplicates", async (t) => {
  const { admin, team, bindIdentity, request, sync, authorize, tasks } = await setup(t);
  await bindIdentity();
  await sync(1);
  const data = { taskId: 1, requestId: randomUUID() };
  const submit = (overrides = {}) => request("/api/work/completions", { identity: admin, data, ...overrides });
  assert.equal((await submit({ csrf: "bad" }))[0], 403);
  assert.equal((await submit({ data: { ...data, taskId: 2 } }))[0], 409);
  assert.equal((await submit())[0], 202);
  assert.equal((await submit())[0], 202);
  assert.equal((await submit({ data: { ...data, requestId: randomUUID() } }))[0], 409);
  const commandPath = `/api/work/completions/${data.requestId}`;
  assert.equal((await request(commandPath, { identity: team }))[0], 403);
  const [, { command }] = await sync(2);
  assert.equal(command.requestId, data.requestId);
  assert.deepEqual(await authorize(command), [200, { authorized: true }]);
  assert.equal((await request(commandPath, { identity: admin }))[1].state, "pending");
  const doneAt = Date.now();
  await sync(3, { tasks: [{ ...tasks[0], doneAt }, tasks[1]],
    outcomes: [{ requestId: data.requestId, result: "applied", doneAt }] });
  assert.equal((await request(commandPath, { identity: admin }))[1].state, "applied");
  assert.equal((await request("/api/work", { identity: admin }))[1].tasks[0].doneAt, doneAt);
});

test("offline snapshot expires, revocation stops in-flight authorization, and erasure rejects replay", async (t) => {
  const { db, admin, env, bindIdentity, request, sync, authorize, now } = await setup(t);
  await bindIdentity();
  await sync(1);
  const data = { taskId: 1, requestId: randomUUID() };
  assert.equal((await request("/api/work/completions", { identity: admin, data }))[0], 202);
  const [, { command }] = await sync(2);
  await sync(3, { mode: "offline", proofAt: null, tasks: null });
  const [, stale] = await request("/api/work", { identity: admin });
  assert.equal(stale.tasks.length, 2);
  assert.equal(stale.writable, false);
  assert.equal((await authorize(command))[0], 409);
  await db.prepare("UPDATE work_live SET expires_at=? WHERE pilot=?").bind(now - 1, env.WORK_PILOT_ID).run();
  const [, expired] = await request("/api/work", { identity: admin });
  assert.equal(expired.state, "expired");
  assert.deepEqual(expired.tasks, []);
  await sync(4, { epoch: 1, mode: "purge", proofAt: null, tasks: null });
  assert.equal((await sync(3))[1].accepted, false);
  assert.equal((await sync(5, { epoch: 0 }))[1].accepted, false);
  assert.deepEqual((await request("/api/work", { identity: admin }))[1].tasks, []);
  assert.equal((await request(`/api/work/completions/${data.requestId}`, { identity: admin }))[0], 404);
  assert.equal((await sync(6, { epoch: 1 }))[0], 200);
  const second = { ...data, requestId: randomUUID() };
  assert.equal((await request("/api/work/completions", { identity: admin, data: second }))[0], 202);
  const [, claimed] = await sync(7, { epoch: 1 });
  assert.equal((await request("/api/work/access", { identity: admin, method: "DELETE" }))[0], 200);
  assert.equal((await authorize(claimed.command))[0], 409);
  assert.equal((await request("/api/work", { identity: admin }))[0], 403);
  assert.equal((await request("/api/status", { identity: admin }))[0], 200);
});

test("both layouts group the same visible tasks by Bangkok day, including midnight rollover", () => {
  const task = { mine: true, projectId: 1, doneAt: null };
  const tasks = [
    { ...task, id: 1, dueAt: Date.parse("2026-11-18T16:59:59Z") },
    { ...task, id: 2, dueAt: Date.parse("2026-11-18T17:00:00Z") },
    { ...task, id: 3, dueAt: null },
    { ...task, id: 4, dueAt: null, projectId: 2 },
    { ...task, id: 5, dueAt: null, mine: false },
    { ...task, id: 6, dueAt: null, doneAt: Date.parse("2026-11-18T16:50:00Z") },
  ];
  const result = groupWorkTasks(tasks, "mine", "1", Date.parse("2026-11-18T17:30:00Z"));
  assert.deepEqual(Object.fromEntries(Object.entries(result).map(([key, rows]) => [key, rows.map((r) => r.id)])),
    { overdue: [1], today: [2], upcoming: [], undated: [3], done: [] });
});
