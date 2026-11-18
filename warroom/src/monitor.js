import { CAPABILITIES } from "./protocol.js";
export const MINUTE = 60_000;
export const DAY = 86400_000;
const humanStates = ["pairing", "logged_out", "replaced"];
export const incidentLabels = {
  contact: "ไม่ได้รับสถานะจากเครื่องบอท",
  connection: "WhatsApp ขาดการเชื่อมต่อ",
  pairing: "ต้องลิงก์ WhatsApp ใหม่",
  logged_out: "WhatsApp ออกจากระบบ",
  replaced: "บัญชี WhatsApp เชื่อมต่อจากที่อื่น",
  requests: "AI ตอบคำขอมีปัญหา",
  task_sync: "AI จับงานอัตโนมัติมีปัญหา",
  summary: "AI สรุปบทสนทนามีปัญหา",
  media: "AI อ่านภาพหรือ PDF มีปัญหา",
  render: "AI สร้างภาพมีปัญหา",
};
export async function loadLive(db) {
  const row = await db.prepare("SELECT * FROM live WHERE id=1").first();
  return row ? { ...row, snapshot: JSON.parse(row.snapshot) } : null;
}
export async function pauseState(db) {
  const p = await db
    .prepare("SELECT value FROM settings WHERE key='pause'")
    .first();
  return p ? JSON.parse(p.value) : { until: 0, actor: null };
}

export async function collectSignals(db, now) {
  const live = await loadLive(db);
  const signals = new Map();
  // A never-connected installation is explicitly unconfigured, not an outage.
  if (!live) return { live, signals, freezeAI: true };
  const elapsed = now - live.received_at;
  if (elapsed >= 5 * MINUTE)
    signals.set("contact", { since: live.received_at });
  const fresh = elapsed < 2 * MINUTE;
  if (fresh) {
    const c = live.snapshot.connection;
    if (humanStates.includes(c.actionRequired || c.state))
      signals.set(c.actionRequired || c.state, {
        since: c.since || live.received_at,
      });
    else if (
      c.state !== "connected" &&
      now - (c.unavailableSince || c.since || live.received_at) >= 5 * MINUTE
    )
      signals.set("connection", {
        since: c.unavailableSince || c.since || live.received_at,
      });
    for (const capability of CAPABILITIES) {
      const { results } = await db
        .prepare(
          "SELECT type,at,detail FROM events WHERE capability=? AND type IN ('ai_ok','ai_error') ORDER BY at DESC,rowid DESC LIMIT 3",
        )
        .bind(capability)
        .all();
      if (!results.length) continue;
      const first = results[0],
        detail = JSON.parse(first.detail);
      if (first.type === "ai_ok") signals.set(`ai:${capability}`, null);
      else if (["auth", "permission", "model_missing"].includes(detail.error))
        signals.set(`ai:${capability}`, {
          since: first.at,
          error: detail.error,
        });
      else if (
        results.length === 3 &&
        results.every((e) => e.type === "ai_error") &&
        results[0].at - results[2].at <= 10 * MINUTE
      )
        signals.set(`ai:${capability}`, {
          since: results[2].at,
          error: detail.error,
        });
      // No new call / elapsed time is not evidence of recovery.
    }
  }
  return { live, signals, freezeAI: !fresh };
}

export async function evaluate(db, now = Date.now()) {
  const { live, signals, freezeAI } = await collectSignals(db, now);
  if (!live) return;
  const pause = await pauseState(db);
  if (pause.until > 0 && pause.until <= now) {
    // Expiry/cancellation makes existing issues due now, even within their hourly interval.
    const previousPause = JSON.stringify(pause);
    await db.batch([
      db
        .prepare(
          "UPDATE incidents SET next_at=MIN(next_at,?) WHERE active=1 AND EXISTS(SELECT 1 FROM settings WHERE key='pause' AND value=?)",
        )
        .bind(now, previousPause),
      db
        .prepare("UPDATE settings SET value=? WHERE key='pause' AND value=?")
        .bind(JSON.stringify({ ...pause, until: 0 }), previousPause),
    ]);
  }
  const previous = (await db.prepare("SELECT * FROM incidents").all()).results;
  const keys = new Set([...signals.keys(), ...previous.map((i) => i.key)]);
  for (const key of keys) {
    const old = previous.find((i) => i.key === key);
    if (key.startsWith("ai:") && (freezeAI || !signals.has(key))) continue;
    if (freezeAI && key !== "contact") continue;
    const signal = signals.get(key);
    if (signal) {
      const opened = old?.active ? old.opened_at : signal.since;
      await db
        .prepare(
          `INSERT INTO incidents(key,opened_at,changed_at,active,next_at,error) VALUES(?,?,?,1,?,?) ON CONFLICT(key) DO UPDATE SET opened_at=excluded.opened_at, changed_at=CASE WHEN incidents.active=0 THEN excluded.changed_at ELSE incidents.changed_at END, active=1, next_at=CASE WHEN incidents.active=0 THEN excluded.next_at ELSE incidents.next_at END, notified=CASE WHEN incidents.active=0 THEN 0 ELSE incidents.notified END,error=excluded.error`,
        )
        .bind(key, opened, now, now, signal.error || null)
        .run();
      const pending = await db
        .prepare(
          "SELECT id FROM outbox WHERE incident_key=? AND status='pending' AND kind!='recovery' LIMIT 1",
        )
        .bind(key)
        .first();
      if (
        !pending &&
        pause.until <= now &&
        (!old?.active || old.next_at <= now)
      ) {
        const kind = old?.active && old.notified ? "reminder" : "open";
        const id = `${key}:${opened}:${kind}:${old?.active ? old.next_at : now}`;
        await db.batch([
          db
            .prepare(
              "INSERT OR IGNORE INTO outbox(id,incident_key,opened_at,kind,created_at) VALUES(?,?,?,?,?)",
            )
            .bind(id, key, opened, kind, now),
          db
            .prepare("UPDATE incidents SET next_at=? WHERE key=?")
            .bind(now + 60 * MINUTE, key),
        ]);
      }
    } else if (old?.active) {
      const jobs = [
        db
          .prepare("UPDATE incidents SET active=0,changed_at=? WHERE key=?")
          .bind(now, key),
        db
          .prepare(
            "UPDATE outbox SET status='cancelled' WHERE incident_key=? AND status='pending'",
          )
          .bind(key),
      ];
      // During pause, no recovery email is queued for retrospective sending.
      if (old.notified && pause.until <= now)
        jobs.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO outbox(id,incident_key,opened_at,kind,created_at) VALUES(?,?,?,?,?)",
            )
            .bind(
              `${key}:${old.opened_at}:recovery`,
              key,
              old.opened_at,
              "recovery",
              now,
            ),
        );
      await db.batch(jobs);
    }
  }
}

export async function deliver(db, send, now = Date.now()) {
  const pause = await pauseState(db);
  if (pause.until > now) return;
  const pending = (
    await db
      .prepare(
        "SELECT * FROM outbox WHERE status='pending' AND lease_until<=? ORDER BY created_at LIMIT 10",
      )
      .bind(now)
      .all()
  ).results;
  for (const item of pending) {
    const incident = await db
      .prepare("SELECT * FROM incidents WHERE key=?")
      .bind(item.incident_key)
      .first();
    const relevant =
      incident &&
      (item.kind === "recovery"
        ? !incident.active
        : incident.active && incident.opened_at === item.opened_at);
    if (!relevant) {
      await db
        .prepare("UPDATE outbox SET status='cancelled' WHERE id=?")
        .bind(item.id)
        .run();
      continue;
    }
    const claim = await db
      .prepare(
        "UPDATE outbox SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND lease_until<=?",
      )
      .bind(now + 2 * MINUTE, item.id, now)
      .run();
    if (!claim.meta.changes) continue;
    try {
      await send(item);
      await db.batch([
        db
          .prepare(
            "UPDATE outbox SET status='sent',sent_at=?,error=NULL WHERE id=?",
          )
          .bind(now, item.id),
        db
          .prepare(
            "UPDATE incidents SET notified=1 WHERE key=? AND opened_at=?",
          )
          .bind(item.incident_key, item.opened_at),
      ]);
    } catch {
      // No raw provider errors, addresses or credentials in operational history.
      await db
        .prepare(
          "UPDATE outbox SET error='mail_send_failed',lease_until=? WHERE id=?",
        )
        .bind(now + MINUTE, item.id)
        .run();
    }
  }
}

export async function cleanup(db, now = Date.now()) {
  // Bound each delete so a long outage cannot cause an unbounded cleanup invocation.
  await db.batch([
    db
      .prepare(
        "DELETE FROM events WHERE id IN (SELECT id FROM events WHERE at<? ORDER BY at LIMIT 500)",
      )
      .bind(now - 30 * DAY),
    db
      .prepare(
        "DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE at<? ORDER BY at LIMIT 100)",
      )
      .bind(now - 30 * DAY),
    db
      .prepare(
        "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox WHERE created_at<? ORDER BY created_at LIMIT 100)",
      )
      .bind(now - 30 * DAY),
    db
      .prepare("DELETE FROM incidents WHERE active=0 AND changed_at<?")
      .bind(now - 30 * DAY),
    db
      .prepare(
        "DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE expires_at<? LIMIT 100)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM challenges WHERE nonce IN (SELECT nonce FROM challenges WHERE expires_at<? LIMIT 100)",
      )
      .bind(now),
  ]);
}
