// LOCAL ONLY: synthetic data and test sessions. Never bundled into the Worker.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import worker, { scheduled } from "./src/worker.js";
import { hash } from "./src/auth.js";
import {
  database,
  snapshot,
  seedLive,
  seedSession,
} from "./test/support.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const db = database();
const admin = await seedSession(db, "admin"),
  team = await seedSession(db, "team");
let mode = "healthy";
let signIn = true;
const pilot = randomUUID(), memberKey = randomUUID(), workRun = randomUUID();
const workToken = "synthetic-local-work-token";
const ownerSubject = "local-example-owner";
await db.prepare("UPDATE members SET sub=? WHERE email=?").bind(ownerSubject, admin.email).run();
await db.prepare("INSERT INTO work_session_subjects VALUES(?,?)").bind(await hash(admin.raw), ownerSubject).run();
await db.prepare("INSERT INTO work_access VALUES(?,?,?)").bind(pilot, ownerSubject, memberKey).run();
let revision = 0;
const localDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
const now = Date.now();
const start = Date.parse(`${localDay.format(now)}T00:00:00+07:00`);
const at = (days, hours) => start + days * 86_400_000 + hours * 3_600_000;
const workRows = [
  { id: 1, title: "ส่งแบบปรับห้องน้ำชั้นล่าง", projectId: 1, project: "บ้านตัวอย่าง", assignee: "นก", mine: true, dueAt: at(-1, 15) },
  { id: 2, title: "เช็กแบบไฟชั้น 2", projectId: 1, project: "บ้านตัวอย่าง", assignee: "นก", mine: true, dueAt: at(0, 16) },
  { id: 3, title: "ตรวจรายการวัสดุปูพื้น", projectId: 2, project: "สำนักงานตัวอย่าง", assignee: "นก", mine: true, dueAt: at(1, 14) },
  { id: 4, title: "รวบรวมตัวอย่างสีผนัง", projectId: 1, project: "บ้านตัวอย่าง", assignee: "นก", mine: true, dueAt: null },
  { id: 5, title: "ส่งผังเฟอร์นิเจอร์", projectId: 2, project: "สำนักงานตัวอย่าง", assignee: "นก", mine: true, dueAt: at(0, 11), doneAt: Math.min(now, at(0, 10)) },
  { id: 6, title: "วัดขนาดช่องเปิดหน้างาน", projectId: 1, project: "บ้านตัวอย่าง", assignee: "สมชาย", mine: false, dueAt: at(0, 10) },
  { id: 7, title: "ขอราคากระเบื้องตัวอย่าง", projectId: null, project: null, assignee: null, mine: false, dueAt: null },
].map((row) => ({ doneAt: null, ...row }));

async function insertDevEvent(idSuffix, e) {
  const id = `00000000-0000-0000-0000-000000000001:${idSuffix}`;
  await db
    .prepare(
      "INSERT OR REPLACE INTO events(id,type,capability,at,received_at,detail) VALUES(?,?,?,?,?,?)",
    )
    .bind(id, e.type, e.capability || null, e.at, e.at, JSON.stringify({ id, ...e }))
    .run();
}

async function update(resetEvents = false) {
  const now = Date.now(),
    p = snapshot(now),
    refNow = mode === "offline" ? now - 600_000 : now;
  p.models = p.models.map((m) => {
    if (mode === "problem" && m.capability === "render") {
      return { ...m, lastAt: null, lastResult: null, responseModel: null };
    }
    return {
      ...m,
      lastAt: refNow - 80_000,
      lastResult: "ok",
      responseModel: m.capability === "render" ? null : "example-response-model",
    };
  });
  if (mode === "problem") {
    p.connection = { state: "disconnected", since: now - 360_000 };
    p.queues[0] = {
      name: "main",
      waiting: 3,
      running: 1,
      oldestAt: now - 160_000,
    };
    p.queues[1] = { name: "media", waiting: 1, running: 0, oldestAt: now - 90_000 };
  }
  if (mode === "empty") {
    await db.prepare("DELETE FROM live").run();
    if (resetEvents) await db.prepare("DELETE FROM events").run();
    return;
  }
  await seedLive(db, p, refNow);
  if (resetEvents) {
    await db.prepare("DELETE FROM events").run();
    const list = [
      { type: "connection", at: refNow - 5 * 3600_000, capability: null, state: "connected", error: null },
      { type: "ai_ok", at: refNow - 4 * 3600_000, capability: "summary", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 2650, error: null },
      { type: "ai_ok", at: refNow - 3 * 3600_000, capability: "task_sync", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 1950, error: null },
      { type: "ai_ok", at: refNow - 2 * 3600_000, capability: "requests", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 1620, error: null },
      { type: "ai_ok", at: refNow - 42 * 60_000, capability: "requests", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 1740, error: null },
      { type: "ai_ok", at: refNow - 24 * 60_000, capability: "task_sync", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 2100, error: null },
      { type: "ai_ok", at: refNow - 14 * 60_000, capability: "media", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 3250, error: null },
      { type: "ai_ok", at: refNow - 8 * 60_000, capability: "summary", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 2850, error: null },
      mode === "problem"
        ? { type: "connection", at: refNow - 360_000, capability: null, state: "disconnected", error: "network" }
        : { type: "ai_ok", at: refNow - 5 * 60_000, capability: "render", provider: "openai", requestedModel: "example-model", responseModel: null, durationMs: 11800, error: null },
      mode === "problem"
        ? { type: "ai_ok", at: refNow - 7 * 60_000, capability: "requests", provider: "openai", requestedModel: "example-model", responseModel: "example-response-model", durationMs: 1850, error: null }
        : { type: "ai_error", at: refNow - 120_000, capability: "requests", provider: "openai", requestedModel: "example-model", responseModel: null, durationMs: 4900, error: "network" },
    ];
    for (let i = 0; i < list.length; i++) await insertDevEvent(i + 1, list[i]);
  }
}
await update(true);
const env = {
  DB: db,
  WARROOM_INGEST_TOKEN: "local-synthetic-ingest",
  WORK_ENABLED: "true",
  WORK_PILOT_ID: pilot,
  WORK_MEMBER_KEY: memberKey,
  WORK_BRIDGE_TOKEN: workToken,
  ALERTS_ENABLED: "false",
  ASSETS: {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + path.sep))
        return new Response("Not found", { status: 404 });
      try {
        const data = await fs.readFile(file);
        const ext = path.extname(file);
        return new Response(data, {
          headers: {
            "content-type":
              {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".woff2": "font/woff2",
                ".svg": "image/svg+xml",
              }[ext] || "text/plain",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
function demoBridge(suffix, payload) {
  return worker.fetch(new Request("http://127.0.0.1:4173/api/work/bridge" + suffix, {
    method: "POST", headers: { authorization: "Bearer " + workToken },
    body: JSON.stringify({ pilot, memberKey, runId: workRun, ...payload }),
  }), env, {}).then((response) => response.json());
}
let workTick;
function updateWork() {
  if (workTick) return workTick;
  workTick = (async () => {
    const ready = mode !== "offline" && mode !== "problem";
    const send = (outcomes) => {
      const generatedAt = Date.now();
      return demoBridge("", {
        revision: ++revision, epoch: 0, generatedAt, proofAt: ready ? generatedAt : null,
        mode: ready ? "ready" : "offline", tasks: ready ? (mode === "empty" ? [] : workRows) : null, outcomes,
      });
    };
    // Publish the previous outcome before claiming more synthetic work.
    while (ready) {
      const { command } = await send(workOutcome);
      workOutcome = [];
      if (!command) return;
      const { authorized } = await demoBridge("/authorize", command);
      const row = workRows.find((task) => task.id === command.taskId);
      if (authorized && row?.mine && row.doneAt === null) {
        row.doneAt = Date.now();
        workOutcome = [{ requestId: command.requestId, result: "applied", doneAt: row.doneAt }];
      }
    }
    await send([]);
  })().finally(() => { workTick = null; });
  return workTick;
}
let workOutcome = [];
await updateWork();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4173");
    let setCookie;
    if (url.pathname === "/__demo") {
      mode = ["healthy", "problem", "offline", "empty"].includes(
        url.searchParams.get("state"),
      )
        ? url.searchParams.get("state")
        : mode;
      signIn = url.searchParams.get("login") !== "1";
      if (url.searchParams.get("role"))
        setCookie = `demo_role=${url.searchParams.get("role") === "team" ? "team" : "admin"}; Path=/; SameSite=Strict`;
      await update(true);
      await updateWork();
      res.writeHead(302, {
        location: url.searchParams.get("view") === "work" ? "/work" : "/",
        ...(setCookie ? { "set-cookie": setCookie } : {}),
      });
      res.end();
      return;
    }
    const identity = (req.headers.cookie || "").includes("demo_role=team")
      ? team
      : admin;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers(req.headers);
    if (signIn) headers.set("cookie", `__Host-warroom=${identity.raw}`);
    const request = new Request(url, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    if (url.pathname === "/api/status") await update();
    if (url.pathname === "/api/work") await updateWork();
    const r = await worker.fetch(request, env, {
      waitUntil: (p) => p.catch(() => {}),
    });
    let data = Buffer.from(await r.arrayBuffer());
    if (url.pathname === "/api/session" && r.ok) {
      const value = JSON.parse(data);
      value.demo = true;
      data = Buffer.from(JSON.stringify(value));
    }
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end("Local preview error");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log(
    "Local Warroom preview: http://127.0.0.1:4173 (synthetic data only)",
  ),
);
const interval = setInterval(() => scheduled(env).catch(() => {}), 60000);
interval.unref();
setInterval(() => updateWork().catch(() => {}), 1500).unref();
