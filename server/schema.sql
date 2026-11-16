-- 簡素版P2E — SQLite schema (Node build, applied by src/db.js at startup).
-- Points are an append-only ledger; balances are always derived, never stored.

CREATE TABLE IF NOT EXISTS accounts (
  id                 TEXT PRIMARY KEY,            -- public account id (uuid)
  token_hash         TEXT NOT NULL UNIQUE,        -- sha256 hex of the device secret
  recovery_code_hash TEXT NOT NULL,               -- sha256 hex of the recovery code
  payout_address     TEXT,                        -- QL1 address (0x...), format-checked
  suspended          INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,            -- unix ms
  last_seen_at       INTEGER NOT NULL
);

-- Append-only point ledger. Never UPDATE or DELETE rows here.
-- type 'earn'   : points_delta > 0, ref = 'dailybest:YYYY-MM-DD'
-- type 'payout' : points_delta < 0 (Phase 2; disabled in Phase 1)
-- type 'adjust' : operator correction (signed)
-- pending/confirmed are derived from created_at vs the hold period
-- (see src/lib/ledger.js), so the hold is config, not stored state.
CREATE TABLE IF NOT EXISTS ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  type         TEXT NOT NULL CHECK (type IN ('earn','payout','adjust')),
  points_delta INTEGER NOT NULL,
  ref          TEXT,
  memo         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, id);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger(account_id, ref);

-- One play session per attempt. Issued by POST /play/start, consumed once
-- by POST /play/submit. The nonce is a session-uniqueness token only; it
-- deliberately does NOT feed the simulation, so the day's conditions
-- (daily seed) stay identical for every player (DESIGN.md §3.2).
CREATE TABLE IF NOT EXISTS play_sessions (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date_jst   TEXT NOT NULL,                       -- JST date the session belongs to
  seed       INTEGER NOT NULL,                    -- daily seed used for the replay
  nonce      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account_day ON play_sessions(account_id, date_jst);

-- Verified play results. A row exists only after the server replayed the
-- tap times through shared/sim.js — client-claimed scores are never stored.
CREATE TABLE IF NOT EXISTS play_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE REFERENCES play_sessions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date_jst   TEXT NOT NULL,
  score      INTEGER NOT NULL,
  floors     INTEGER NOT NULL,
  perfects   INTEGER NOT NULL,
  taps_json  TEXT NOT NULL,                       -- the submitted tap-times array
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_account_day ON play_results(account_id, date_jst);

-- One row per account per JST day: the day's verified best score.
-- Points are earned on the DIFFERENCE when this best rises (see app.js),
-- so a day's total earn equals the best score (subject to the daily cap).
CREATE TABLE IF NOT EXISTS daily_bests (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date_jst   TEXT NOT NULL,
  best_score INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, date_jst)
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);

-- ZAP (42 Chain) reward-pool / burn accounting (DESIGN.md §3.5).
-- Append-only. Paid extra plays add one 'pool_in' (+7 ZAP) and one 'burn'
-- (+3 ZAP) row per 10 ZAP payment; weekly rank-bonus payouts add
-- 'pool_out' rows. Amounts are ZAP smallest units (18 decimals) as
-- integer strings. The public /stats display derives from these rows —
-- nothing is hard-coded.
CREATE TABLE IF NOT EXISTS pool_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  ref        TEXT,
  created_at INTEGER NOT NULL
);
