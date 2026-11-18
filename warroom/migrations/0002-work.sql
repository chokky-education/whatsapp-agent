CREATE TABLE IF NOT EXISTS work_session_subjects (
  session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE,
  google_sub TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_access (
  pilot TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL REFERENCES members(sub) ON DELETE CASCADE,
  member_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_live (
  pilot TEXT PRIMARY KEY,
  member_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  synced_at INTEGER,
  expires_at INTEGER,
  tasks TEXT
);

CREATE TABLE IF NOT EXISTS work_completions (
  request_id TEXT PRIMARY KEY,
  pilot TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  member_key TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','claimed','applied','already_done','rejected')),
  authorized_at INTEGER,
  done_at INTEGER,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS work_completions_by_pilot
  ON work_completions(pilot, run_id, state, expires_at, created_at);
