import {
  isTaskId, isWorkId, sanitizeWorkSync, WORK_BODY_LIMIT, WORK_FRESH_MS, WORK_TTL_MS,
} from "./work-protocol.js";

export function workEnabled(env) {
  return env.WORK_ENABLED === "true" && isWorkId(env.WORK_PILOT_ID) &&
    isWorkId(env.WORK_MEMBER_KEY) && Boolean(env.WORK_BRIDGE_TOKEN);
}

export async function workAccess(env, user) {
  if (!workEnabled(env)) return "disabled";
  const grant = await env.DB.prepare(
    "SELECT a.google_sub FROM work_access a JOIN members m ON m.sub=a.google_sub WHERE a.pilot=? AND a.member_key=? AND m.email=?",
  ).bind(env.WORK_PILOT_ID, env.WORK_MEMBER_KEY, user.email).first();
  if (!grant) return "unpaired";
  return grant.google_sub === user.verified_sub ? "paired" : "reauth";
}

// Recheck the actual requesting session and scoped grant at the point of claim and authorization.
const activeCommandGrant = `
  EXISTS (
    SELECT 1 FROM work_access a
    JOIN members m ON m.sub=a.google_sub
    JOIN sessions s ON s.email=m.email
    JOIN work_session_subjects w ON w.session_hash=s.hash AND w.google_sub=m.sub
    WHERE a.pilot=work_completions.pilot AND a.member_key=work_completions.member_key
      AND a.google_sub=work_completions.google_sub
      AND s.hash=work_completions.session_hash AND s.expires_at>?
  )`;
const ownedOpenTask = `EXISTS (
  SELECT 1 FROM json_each(l.tasks)
  WHERE json_extract(value,'$.id')=? AND json_extract(value,'$.mine')=1 AND json_extract(value,'$.doneAt') IS NULL
)`;

async function exchange(request, env, now, { body, json }) {
  const db = env.DB;
  const pilot = env.WORK_PILOT_ID;
  const sync = sanitizeWorkSync(await body(request, WORK_BODY_LIMIT), pilot, env.WORK_MEMBER_KEY, now);
  const { revision, epoch, runId, mode, generatedAt, proofAt, tasks, outcomes } = sync;
  const ready = mode === "ready";
  // A lower epoch (even with a later revision) can never restore erased tasks.
  const upsert = db.prepare(`
    INSERT INTO work_live(pilot,member_key,revision,epoch,run_id,mode,synced_at,expires_at,tasks)
    SELECT ?,?,?,?,?,?,?,?,?
    WHERE ?!='ready' OR EXISTS (SELECT 1 FROM work_access WHERE pilot=? AND member_key=?)
    ON CONFLICT(pilot) DO UPDATE SET
      revision=excluded.revision, epoch=excluded.epoch, run_id=excluded.run_id,
      mode=CASE WHEN excluded.mode='offline' AND work_live.mode='missing' AND excluded.epoch=work_live.epoch
        THEN 'missing' ELSE excluded.mode END,
      synced_at=CASE
        WHEN excluded.mode='offline' AND excluded.epoch=work_live.epoch THEN work_live.synced_at ELSE excluded.synced_at END,
      expires_at=CASE
        WHEN excluded.mode='offline' AND excluded.epoch=work_live.epoch THEN work_live.expires_at ELSE excluded.expires_at END,
      tasks=CASE
        WHEN excluded.mode='offline' AND excluded.epoch=work_live.epoch THEN work_live.tasks ELSE excluded.tasks END
    WHERE excluded.member_key=work_live.member_key AND excluded.revision>work_live.revision AND excluded.epoch>=work_live.epoch
  `).bind(pilot, env.WORK_MEMBER_KEY, revision, epoch, runId, mode, ready ? generatedAt : null,
    ready ? Math.min(generatedAt, proofAt) + WORK_TTL_MS : null, ready ? JSON.stringify(tasks) : null,
    mode, pilot, env.WORK_MEMBER_KEY);
  const accepted = "EXISTS (SELECT 1 FROM work_live WHERE pilot=? AND revision=? AND epoch=? AND run_id=? AND mode=?)";
  const changes = [
    upsert,
    db.prepare(`DELETE FROM work_completions WHERE pilot=? AND epoch<? AND ${accepted}`)
      .bind(pilot, epoch, pilot, revision, epoch, runId, mode),
  ];
  if (mode === "missing") {
    changes.push(db.prepare(`DELETE FROM work_completions WHERE pilot=? AND epoch=? AND ${accepted}`)
      .bind(pilot, epoch, pilot, revision, epoch, runId, mode));
  }
  if (ready) {
    for (const outcome of outcomes) {
      changes.push(db.prepare(`
        UPDATE work_completions SET state=?, done_at=?, reason=?
        WHERE request_id=? AND pilot=? AND epoch=? AND state='claimed'
          AND (authorized_at IS NOT NULL OR ?='rejected') AND ${accepted}
      `).bind(outcome.result, outcome.doneAt, outcome.reason, outcome.requestId,
        pilot, epoch, outcome.result, pilot, revision, epoch, runId, mode));
    }
    // This ordered projection was read after the deadline. A bot never applies a new command past it.
    changes.push(db.prepare(`
      UPDATE work_completions SET state='rejected', reason='expired'
      WHERE pilot=? AND epoch=? AND state IN ('claimed','queued') AND expires_at<=? AND ${accepted}
    `).bind(pilot, epoch, generatedAt, pilot, revision, epoch, runId, mode));
  }
  const [published] = await db.batch(changes);
  if (!published.meta.changes) return json({ accepted: false });
  if (!ready) return json({ accepted: true, command: null, receiptsAccepted: false });
  if (!sync.claim) return json({ accepted: true, command: null, receiptsAccepted: true });

  const command = await db.prepare(`
    UPDATE work_completions SET state='claimed' WHERE request_id=(
      SELECT request_id FROM work_completions
      WHERE pilot=? AND epoch=? AND run_id=? AND member_key=? AND state='queued' AND expires_at>?
        AND ${activeCommandGrant} AND ${accepted}
      ORDER BY created_at,request_id LIMIT 1
    )
    RETURNING request_id AS requestId, task_id AS taskId, member_key AS memberKey, expires_at AS expiresAt, epoch
  `).bind(pilot, epoch, runId, env.WORK_MEMBER_KEY, now, now,
    pilot, revision, epoch, runId, mode).first();
  return json({ accepted: true, command, receiptsAccepted: true });
}

async function authorize(request, env, now, { body, bad, json }) {
  const input = await body(request, 4096);
  if (input?.pilot !== env.WORK_PILOT_ID || !isWorkId(input.runId) || !isWorkId(input.requestId) ||
      input.memberKey !== env.WORK_MEMBER_KEY || !isTaskId(input.taskId) || !Number.isSafeInteger(input.epoch)) {
    return bad("invalid_work");
  }
  const result = await env.DB.prepare(`
    UPDATE work_completions SET authorized_at=?
    WHERE request_id=? AND pilot=? AND epoch=? AND run_id=? AND member_key=? AND task_id=?
      AND state='claimed' AND authorized_at IS NULL AND expires_at>? AND ${activeCommandGrant}
      AND EXISTS (
        SELECT 1 FROM work_live l WHERE l.pilot=work_completions.pilot AND l.epoch=work_completions.epoch
          AND l.member_key=work_completions.member_key AND l.run_id=work_completions.run_id
          AND l.mode='ready' AND l.synced_at>? AND l.expires_at>?
          AND ${ownedOpenTask}
      )
    RETURNING request_id
  `).bind(now, input.requestId, input.pilot, input.epoch, input.runId, input.memberKey, input.taskId,
    now, now, now - WORK_FRESH_MS, now, input.taskId).first();
  return result ? json({ authorized: true }) : bad("work_unavailable", 409);
}

export async function workBridge(request, env, now, helpers) {
  const path = new URL(request.url).pathname;
  if (!workEnabled(env)) return helpers.bad("not_found", 404);
  if (!await helpers.authorizedToken(request, env.WORK_BRIDGE_TOKEN)) return helpers.bad("unauthorized", 401);
  return path.endsWith("/authorize") ? authorize(request, env, now, helpers) : exchange(request, env, now, helpers);
}

function commandResult(row, now) {
  const pending = row.state === "queued" || row.state === "claimed";
  if (!pending) return { state: row.state, reason: row.reason, doneAt: row.done_at };
  if (row.expires_at > now) return { state: "pending" };
  return row.authorized_at === null ? { state: "rejected", reason: "expired" } : { state: "unconfirmed" };
}

async function completion(request, env, user, now, { body, bad, json }) {
  const input = await body(request, 4096);
  if (!isWorkId(input?.requestId) || !isTaskId(input.taskId)) return bad("invalid_work");
  const { requestId, taskId } = input;
  const db = env.DB, pilot = env.WORK_PILOT_ID;
  await db.prepare(`
    INSERT OR IGNORE INTO work_completions
      (request_id,pilot,epoch,run_id,google_sub,session_hash,member_key,task_id,created_at,expires_at,state)
    SELECT ?,l.pilot,l.epoch,l.run_id,a.google_sub,s.hash,a.member_key,?,?,?,'queued'
    FROM work_live l
    JOIN work_access a ON a.pilot=l.pilot AND a.member_key=l.member_key
    JOIN members m ON m.sub=a.google_sub
    JOIN sessions s ON s.email=m.email
    JOIN work_session_subjects w ON w.session_hash=s.hash AND w.google_sub=m.sub
    WHERE l.pilot=? AND a.member_key=? AND s.hash=? AND s.expires_at>? AND l.mode='ready'
      AND l.synced_at>? AND l.expires_at>? AND ${ownedOpenTask}
      AND NOT EXISTS (SELECT 1 FROM work_completions c WHERE c.pilot=l.pilot AND c.epoch=l.epoch AND c.task_id=?
        AND c.state IN ('queued','claimed') AND (c.expires_at>? OR c.authorized_at IS NOT NULL))
  `).bind(requestId, taskId, now, now + WORK_FRESH_MS, pilot, env.WORK_MEMBER_KEY, user.hash,
    now, now - WORK_FRESH_MS, now, taskId, taskId, now).run();
  const row = await findCompletion(env, user, requestId);
  if (!row || row.task_id !== taskId) return bad("work_unavailable", 409);
  const result = commandResult(row, now);
  return json(result, result.state === "pending" ? 202 : 200);
}

function findCompletion(env, user, requestId) {
  return env.DB.prepare(`
    SELECT c.task_id,c.state,c.expires_at,c.authorized_at,c.done_at,c.reason FROM work_completions c
    JOIN work_access a ON a.pilot=c.pilot AND a.google_sub=c.google_sub AND a.member_key=c.member_key
    JOIN work_live l ON l.pilot=c.pilot AND l.member_key=c.member_key AND l.epoch=c.epoch AND l.mode!='missing'
    WHERE c.request_id=? AND c.pilot=? AND c.google_sub=? AND c.member_key=?
  `).bind(requestId, env.WORK_PILOT_ID, user.verified_sub, env.WORK_MEMBER_KEY).first();
}

export async function workUser(request, env, user, now, helpers) {
  const { bad, json } = helpers;
  const path = new URL(request.url).pathname, pilot = env.WORK_PILOT_ID;
  if (!workEnabled(env)) return bad("not_found", 404);
  if (path === "/api/work/access" && request.method === "DELETE") {
    if (user.role !== "admin" || !user.verified_sub) return bad("forbidden", 403);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM work_access WHERE pilot=?").bind(pilot),
      env.DB.prepare("UPDATE work_live SET tasks=NULL, synced_at=NULL, expires_at=NULL, mode='purge' WHERE pilot=?").bind(pilot),
      env.DB.prepare("DELETE FROM work_completions WHERE pilot=?").bind(pilot),
    ]);
    return json({ ok: true });
  }
  const access = await workAccess(env, user);
  if (access !== "paired") return bad(access === "reauth" ? "work_reauth" : "forbidden", 403);
  if (path === "/api/work" && request.method === "GET") {
    const live = await env.DB.prepare(
      "SELECT l.mode,l.synced_at,l.expires_at,l.tasks FROM work_live l JOIN work_access a ON a.pilot=l.pilot AND a.member_key=l.member_key WHERE l.pilot=? AND a.google_sub=? AND a.member_key=?",
    ).bind(pilot, user.verified_sub, env.WORK_MEMBER_KEY).first();
    if (live?.mode === "missing") return bad("work_not_in_group", 403);
    const expired = live?.expires_at != null && live.expires_at <= now;
    const writable = !expired && live?.mode === "ready" && live.synced_at > now - WORK_FRESH_MS;
    return json({
      state: expired ? "expired" : !live?.tasks ? "waiting" : writable ? "ready" : "stale",
      syncedAt: live?.synced_at ?? null,
      expiresAt: live?.expires_at ?? null,
      writableUntil: writable ? live.synced_at + WORK_FRESH_MS : null,
      now,
      writable: Boolean(writable),
      tasks: expired || !live?.tasks ? [] : JSON.parse(live.tasks),
    });
  }
  if (path === "/api/work/completions" && request.method === "POST") return completion(request, env, user, now, helpers);
  const prefix = "/api/work/completions/";
  const requestId = path.slice(prefix.length);
  if (request.method === "GET" && path.startsWith(prefix) && isWorkId(requestId)) {
    const row = await findCompletion(env, user, requestId);
    return row ? json(commandResult(row, now)) : bad("not_found", 404);
  }
  return bad("not_found", 404);
}

export async function cleanupWork(db, now) {
  await db.batch([
    db.prepare("UPDATE work_live SET tasks=NULL WHERE tasks IS NOT NULL AND expires_at<=?").bind(now),
    db.prepare("DELETE FROM work_completions WHERE expires_at<=?").bind(now - WORK_TTL_MS),
  ]);
}
