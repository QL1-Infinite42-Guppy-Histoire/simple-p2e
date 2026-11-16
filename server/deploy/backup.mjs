// 簡素版P2E — on-box database snapshot (run ON the VPS).
//
// Takes a consistent SQLite snapshot with VACUUM INTO (safe while the
// server is running; no sqlite3 CLI needed) and prunes old snapshots.
//
//   /opt/node-v24/bin/node deploy/backup.mjs
//
// Env (optional):
//   DB_PATH      source database   (default /opt/simple-p2e/data/simple-p2e.db)
//   BACKUP_DIR   snapshot directory (default /opt/simple-p2e/backups)
//   BACKUP_KEEP_DAYS               (default 14)
//
// IMPORTANT: snapshots on the box are only a first line of defence.
// The VPS plan can expire — pull copies OFF the box daily with
// deploy/pull-backup.sh from another machine. The points ledger must
// never exist only on the VPS.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.DB_PATH || "/opt/simple-p2e/data/simple-p2e.db";
const BACKUP_DIR = process.env.BACKUP_DIR || "/opt/simple-p2e/backups";
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..*/, "");
const dest = join(BACKUP_DIR, `simple-p2e-${stamp}.db`);
const escaped = dest.replace(/'/g, "''");

const db = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${escaped}'`);
} finally {
  db.close();
}
console.log(`[backup] wrote ${dest}`);

// Prune snapshots older than KEEP_DAYS.
const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000;
for (const name of readdirSync(BACKUP_DIR)) {
  if (!/^simple-p2e-.*\.db$/.test(name)) continue;
  const p = join(BACKUP_DIR, name);
  if (statSync(p).mtimeMs < cutoff) {
    unlinkSync(p);
    console.log(`[backup] pruned ${p}`);
  }
}
