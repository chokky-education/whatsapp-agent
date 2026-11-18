import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CAPABILITIES, QUEUES } from "../src/protocol.js";
import { hash } from "../src/auth.js";
export function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("../migrations/0001.sql", import.meta.url), "utf8"),
  );
  sql.exec(readFileSync(new URL("../migrations/0002-work.sql", import.meta.url), "utf8"));
  const wrap = (query, values = []) => ({
    bind(...v) {
      return wrap(query, v);
    },
    async first() {
      return sql.prepare(query).get(...values) || null;
    },
    async all() {
      return { results: sql.prepare(query).all(...values) };
    },
    async run() {
      const r = sql.prepare(query).run(...values);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  const db = {
    prepare: (q) => wrap(q),
    async batch(statements) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => sql.close(),
  };
  return db;
}
export function snapshot(now = Date.now()) {
  return {
    version: 1,
    runId: randomUUID(),
    seq: 1,
    startedAt: now - 10000,
    generatedAt: now,
    connection: { state: "connected", since: now - 9000 },
    activity: { inbound: now - 2000, sent: now - 1000, delivered: null },
    models: CAPABILITIES.map((capability) => ({
      capability,
      provider: "openai",
      requestedModel: "example-model",
      responseModel: null,
      lastAt: null,
      lastResult: null,
    })),
    queues: QUEUES.map((name) => ({
      name,
      waiting: 0,
      running: 0,
      oldestAt: null,
    })),
    events: [],
    droppedEvents: 0,
  };
}
export async function seedLive(db, p, now = Date.now()) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO live(id,run_id,seq,started_at,generated_at,received_at,snapshot) VALUES(1,?,?,?,?,?,?)",
    )
    .bind(p.runId, p.seq, p.startedAt, p.generatedAt, now, JSON.stringify(p))
    .run();
}
export async function seedSession(db, role = "admin", now = Date.now()) {
  const email = role === "admin" ? "admin@example.com" : "team@example.com",
    raw = (role === "admin" ? "a" : "b").repeat(64),
    csrf = (role === "admin" ? "c" : "d").repeat(64);
  await db
    .prepare(
      "INSERT OR IGNORE INTO members(email,role,created_at) VALUES(?,?,?)",
    )
    .bind(email, role, now)
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO sessions(hash,email,csrf,expires_at) VALUES(?,?,?,?)",
    )
    .bind(await hash(raw), email, csrf, now + 28800000)
    .run();
  return { raw, csrf, email, role };
}
export async function seedEvent(db, capability, type, at, error = null) {
  const id = `${randomUUID()}:1`,
    e = { id, capability, type, at, error };
  await db
    .prepare(
      "INSERT INTO events(id,type,capability,at,received_at,detail) VALUES(?,?,?,?,?,?)",
    )
    .bind(id, type, capability, at, at, JSON.stringify(e))
    .run();
}
