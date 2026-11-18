import { sanitizeSnapshot } from "./protocol.js";
import { workEnabled, workAccess, workBridge, workUser, cleanupWork } from "./work.js";
import {
  collectSignals,
  loadLive,
  pauseState,
  evaluate,
  deliver,
  cleanup,
  incidentLabels,
  MINUTE,
} from "./monitor.js";
import {
  hash,
  token,
  cookie,
  sessionCookie,
  challengeCookie,
  sameOrigin,
  session,
  verifyGoogle,
} from "./auth.js";
const security = {
  "cache-control": "no-store",
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com/gsi/; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...security,
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}
const bad = (code, status = 400) => json({ error: code }, status);
async function body(request, limit = 131072) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new Error("body_limit");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body_limit");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("body_limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const emailValid = (s) =>
  typeof s === "string" &&
  s.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
async function audit(db, actor, action, detail, now) {
  return db
    .prepare("INSERT INTO audit(id,at,actor,action,detail) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), now, actor, action, JSON.stringify(detail))
    .run();
}

async function ingest(request, env, now) {
  if (
    !env.WARROOM_INGEST_TOKEN ||
    !(await authorizedToken(request, env.WARROOM_INGEST_TOKEN))
  )
    return bad("unauthorized", 401);
  const snapshot = sanitizeSnapshot(await body(request), now);
  const result = await env.DB.prepare(
    `INSERT INTO live(id,run_id,seq,started_at,generated_at,received_at,snapshot) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,seq=excluded.seq,started_at=excluded.started_at,generated_at=excluded.generated_at,received_at=excluded.received_at,snapshot=excluded.snapshot WHERE (excluded.run_id=live.run_id AND excluded.seq>live.seq AND excluded.generated_at>=live.generated_at) OR (excluded.run_id!=live.run_id AND excluded.started_at>live.started_at AND excluded.generated_at>=live.generated_at)`,
  )
    .bind(
      snapshot.runId,
      snapshot.seq,
      snapshot.startedAt,
      snapshot.generatedAt,
      now,
      JSON.stringify({ ...snapshot, events: [] }),
    )
    .run();
  if (!result.meta.changes)
    return json({ accepted: false, reason: "old_snapshot" });
  if (snapshot.events.length)
    await env.DB.batch(
      snapshot.events.map((e) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO events(id,type,capability,at,received_at,detail) VALUES(?,?,?,?,?,?)",
        ).bind(e.id, e.type, e.capability, e.at, now, JSON.stringify(e)),
      ),
    );
  return json({ accepted: true });
}
async function authorizedToken(request, expected) {
  const raw = request.headers.get("authorization") || "";
  if (raw.length > 200) return false;
  return (await hash(raw)) === (await hash(`Bearer ${expected}`));
}
const workHelpers = { bad, json, body, authorizedToken };

async function getStatus(env, user, now) {
  const live = await loadLive(env.DB),
    pause = await pauseState(env.DB);
  const incidents = (
    await env.DB.prepare(
      "SELECT * FROM incidents WHERE active=1 ORDER BY opened_at DESC",
    ).all()
  ).results;
  const events = (
    await env.DB.prepare("SELECT * FROM events ORDER BY at DESC LIMIT 30").all()
  ).results;
  const calls =
    user.role === "admin"
      ? events
          .filter((e) => e.type.startsWith("ai_"))
          .map((e) => JSON.parse(e.detail))
      : undefined;
  const notice = await env.DB.prepare(
    "SELECT COUNT(*) AS pending, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failed FROM outbox WHERE status='pending'",
  ).first();
  return json({
    now,
    receivedAt: live?.received_at || null,
    stale: !live || now - live.received_at >= 2 * MINUTE,
    snapshot: live?.snapshot || null,
    pause,
    incidents: incidents.map((i) => ({
      key: i.key,
      openedAt: i.opened_at,
      error: user.role === "admin" ? i.error : undefined,
    })),
    calls,
    notification:
      user.role === "admin"
        ? {
            ...notice,
            configured: !!(env.EMAIL && env.ALERT_TO && env.ALERT_FROM),
            enabled: env.ALERTS_ENABLED === "true",
          }
        : undefined,
  });
}

async function handler(request, env, ctx) {
  const url = new URL(request.url),
    path = url.pathname,
    now = Date.now();
  if (path === "/api/telemetry" && request.method === "POST")
    return ingest(request, env, now);
  if (request.method === "POST" && ["/api/work/bridge", "/api/work/bridge/authorize"].includes(path))
    return workBridge(request, env, now, workHelpers);
  if (path === "/api/login" && request.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID) return json({ configured: false });
    const nonce = token();
    await env.DB.prepare("INSERT INTO challenges(nonce,expires_at) VALUES(?,?)")
      .bind(nonce, now + 5 * MINUTE)
      .run();
    return json(
      { configured: true, clientId: env.GOOGLE_CLIENT_ID, nonce },
      200,
      { "set-cookie": challengeCookie(nonce) },
    );
  }
  if (path === "/api/login" && request.method === "POST") {
    if (!sameOrigin(request) || !env.GOOGLE_CLIENT_ID)
      return bad("forbidden", 403);
    const nonce = cookie(request, "__Host-warroom_login");
    if (!nonce) return bad("login_expired", 401);
    const challenge = await env.DB.prepare(
      "DELETE FROM challenges WHERE nonce=? AND expires_at>? RETURNING nonce",
    )
      .bind(nonce, now)
      .first();
    if (!challenge) return bad("login_expired", 401);
    const { credential } = await body(request, 16384);
    let identity;
    try {
      identity = await verifyGoogle(credential, env.GOOGLE_CLIENT_ID, nonce);
    } catch {
      return bad("invalid_identity", 401);
    }
    // One-time bootstrap only when this Google account actually authenticates.
    if (env.ADMIN_EMAIL?.toLowerCase() === identity.email) {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO members(email,sub,role,created_at) SELECT ?,?,'admin',? WHERE NOT EXISTS(SELECT 1 FROM settings WHERE key='bootstrapped') AND NOT EXISTS(SELECT 1 FROM members)",
        ).bind(identity.email, identity.sub, now),
        env.DB.prepare(
          "INSERT OR IGNORE INTO settings(key,value) SELECT 'bootstrapped','true' WHERE EXISTS(SELECT 1 FROM members)",
        ),
      ]);
    }
    const raw = token(),
      csrf = token();
    const sessionHash = await hash(raw);
    const [, inserted] = await env.DB.batch([
      env.DB.prepare("UPDATE members SET sub=? WHERE email=? AND (sub IS NULL OR sub=?)")
        .bind(identity.sub, identity.email, identity.sub),
      env.DB.prepare("INSERT INTO sessions(hash,email,csrf,expires_at) SELECT ?,email,?,? FROM members WHERE email=? AND sub=?")
        .bind(sessionHash, csrf, now + 8 * 60 * MINUTE, identity.email, identity.sub),
      env.DB.prepare("INSERT INTO work_session_subjects(session_hash,google_sub) SELECT hash,? FROM sessions WHERE hash=?")
        .bind(identity.sub, sessionHash),
    ]);
    if (!inserted.meta.changes) return bad("not_invited", 403);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(raw) });
  }
  if (!path.startsWith("/api/")) {
    const assetRequest = path === "/work" && ["GET", "HEAD"].includes(request.method)
      ? new Request(new URL("/", request.url), request)
      : request;
    const asset = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(asset.headers);
    for (const [k, v] of Object.entries(security)) headers.set(k, v);
    return new Response(asset.body, { status: asset.status, headers });
  }
  const user = await session(request, env.DB, now);
  if (!user) return bad("unauthorized", 401);
  const mutating = !["GET", "HEAD"].includes(request.method);
  if (
    mutating &&
    (!sameOrigin(request) || request.headers.get("x-csrf-token") !== user.csrf)
  )
    return bad("forbidden", 403);
  if (path === "/api/session" && request.method === "GET")
    return json({
      email: user.email, role: user.role, csrf: user.csrf,
      workAccess: await workAccess(env, user),
      canManageWork: workEnabled(env) && user.role === "admin" && Boolean(user.verified_sub),
    });
  if (path === "/api/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE hash=?")
      .bind(user.hash)
      .run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }
  if (path === "/api/work" || path.startsWith("/api/work/"))
    return workUser(request, env, user, now, workHelpers);
  if (path === "/api/status" && request.method === "GET")
    return getStatus(env, user, now);
  if (path === "/api/history" && request.method === "GET") {
    const before = Number(url.searchParams.get("before")) || now + 1;
    const cursor = url.searchParams.get("cursor") || "~";
    const rows = (
      await env.DB.prepare(
        "SELECT * FROM events WHERE (at<? OR (at=? AND id<?)) AND at>=? ORDER BY at DESC,id DESC LIMIT 100",
      )
        .bind(before, before, cursor, now - 30 * 86400_000)
        .all()
    ).results;
    return json({
      events: rows.map((e) =>
        user.role === "admin"
          ? JSON.parse(e.detail)
          : { type: e.type, at: e.at, capability: e.capability },
      ),
      nextBefore: rows.length === 100 ? rows.at(-1).at : null,
      nextCursor: rows.length === 100 ? rows.at(-1).id : null,
    });
  }
  if (user.role !== "admin") return bad("forbidden", 403);
  if (path === "/api/members" && request.method === "GET")
    return json({
      members: (
        await env.DB.prepare(
          "SELECT email,role,created_at FROM members ORDER BY role,email",
        ).all()
      ).results,
    });
  if (path === "/api/members" && request.method === "POST") {
    const p = await body(request, 4096);
    const email =
      typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    if (!emailValid(email) || !["team", "admin"].includes(p.role))
      return bad("invalid_member");
    await env.DB.prepare(
      "INSERT INTO members(email,role,created_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role",
    )
      .bind(email, p.role, now)
      .run();
    await audit(env.DB, user.email, "member_set", { email, role: p.role }, now);
    return json({ ok: true });
  }
  if (path === "/api/members" && request.method === "DELETE") {
    const p = await body(request, 4096);
    if (!emailValid(p.email)) return bad("invalid_member");
    await env.DB.prepare("DELETE FROM members WHERE email=?")
      .bind(p.email.toLowerCase())
      .run();
    await audit(
      env.DB,
      user.email,
      "member_remove",
      { email: p.email.toLowerCase() },
      now,
    );
    return json({ ok: true });
  }
  if (path === "/api/pause" && request.method === "POST") {
    const { minutes } = await body(request, 4096);
    if (![0, 30, 60, 240].includes(minutes)) return bad("invalid_pause");
    const value = {
      until: minutes ? now + minutes * MINUTE : now,
      actor: user.email,
    };
    await env.DB.prepare(
      "INSERT INTO settings(key,value) VALUES('pause',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
      .bind(JSON.stringify(value))
      .run();
    await audit(
      env.DB,
      user.email,
      minutes ? "pause" : "resume",
      { minutes },
      now,
    );
    return json(value);
  }
  if (path === "/api/audit" && request.method === "GET")
    return json({
      events: (
        await env.DB.prepare(
          "SELECT at,actor,action,detail FROM audit ORDER BY at DESC LIMIT 100",
        ).all()
      ).results.map((r) => ({ ...r, detail: JSON.parse(r.detail) })),
    });
  return bad("not_found", 404);
}

export async function scheduled(env) {
  const now = Date.now();
  // Only one scheduled evaluator at a time, including retries/overlap.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO settings(key,value) VALUES('monitor_lock','0')",
  ).run();
  const lease = await env.DB.prepare(
    "UPDATE settings SET value=? WHERE key='monitor_lock' AND CAST(value AS INTEGER)<?",
  )
    .bind(String(now + 120000), now)
    .run();
  if (!lease.meta.changes) return;
  try {
    await evaluate(env.DB, now);
    if (
      env.ALERTS_ENABLED === "true" &&
      env.EMAIL &&
      env.ALERT_TO &&
      env.ALERT_FROM
    )
      await deliver(
        env.DB,
        async (item) => {
          const label =
            incidentLabels[item.incident_key.replace("ai:", "")] ||
            "บอทต้องตรวจสอบ";
          const prefix =
            item.kind === "recovery"
              ? "กลับมาทำงานได้"
              : item.kind === "reminder"
                ? "ยังมีปัญหา"
                : "พบปัญหา";
          const message = {
            from: env.ALERT_FROM,
            to: env.ALERT_TO,
            subject: `Warroom · ${prefix}: ${label}`,
            text: `${prefix}: ${label}\nเวลาตรวจ: ${new Date(now).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}\nเปิด Warroom เพื่อตรวจสถานะล่าสุด: ${env.PUBLIC_URL || ""}\nข้อมูลนี้ไม่รวมเนื้อหาแชท`,
          };
          let timer;
          try {
            await Promise.race([
              env.EMAIL.send(message),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("mail_timeout")),
                  15000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        },
        now,
      );
    await cleanup(env.DB, now);
    await cleanupWork(env.DB, now);
  } finally {
    await env.DB.prepare(
      "UPDATE settings SET value='0' WHERE key='monitor_lock' AND value=?",
    )
      .bind(String(now + 120000))
      .run();
  }
}
export default {
  async fetch(request, env, ctx) {
    try {
      return await handler(request, env, ctx);
    } catch (err) {
      if (err.message?.includes("last_admin")) return bad("last_admin", 409);
      if (
        ["invalid_telemetry", "invalid_work", "body_limit"].includes(err.message) ||
        err instanceof SyntaxError
      )
        return bad("invalid_request", 400);
      return bad("service_unavailable", 503);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduled(env));
  },
};
