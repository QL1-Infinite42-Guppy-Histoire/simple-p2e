// D1-compatible database shim over node:sqlite (Node 22.5+ / 24 built-in).
//
// The application logic (src/app.js) was written against the Cloudflare D1
// prepared-statement API:
//   db.prepare(sql).bind(...params).first()  -> row object | null
//   db.prepare(sql).bind(...params).all()    -> { results: [row, ...] }
//   db.prepare(sql).bind(...params).run()    -> { meta: { last_row_id } }
// This shim reproduces exactly that surface on top of SQLite, so the shared
// schema.sql and all handler code run unchanged. SQLite is the same engine
// D1 is built on, so SQL semantics (including UNIQUE-constraint errors,
// which the SSV / exchange flows rely on via try/catch) match.
//
// Differences handled here:
//   - node:sqlite .get() returns undefined for "no row"  -> first() maps to null
//   - node:sqlite run() returns { changes, lastInsertRowid } -> reshaped to D1 meta
//   - undefined bind params become null; booleans become 1/0 (D1 behaviour)

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

function normalizeParam(p) {
  if (p === undefined) return null;
  if (typeof p === "boolean") return p ? 1 : 0;
  return p;
}

class D1Statement {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
    this._params = [];
  }

  bind(...params) {
    this._params = params.map(normalizeParam);
    return this;
  }

  async first() {
    const row = this._db.prepare(this._sql).get(...this._params);
    return row === undefined ? null : row;
  }

  async all() {
    const results = this._db.prepare(this._sql).all(...this._params);
    return { results };
  }

  async run() {
    const r = this._db.prepare(this._sql).run(...this._params);
    return {
      success: true,
      meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes },
    };
  }
}

export class D1Shim {
  constructor(db) {
    this._db = db;
  }

  prepare(sql) {
    return new D1Statement(this._db, sql);
  }

  exec(sql) {
    this._db.exec(sql);
  }

  close() {
    this._db.close();
  }
}

// Open (creating if needed) the SQLite database at dbPath, apply pragmas,
// and apply schemaSql if provided (the schema is idempotent: IF NOT EXISTS).
export function openDatabase(dbPath, schemaSql = null) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec("PRAGMA busy_timeout = 5000;");
  const db = new D1Shim(raw);
  if (schemaSql) {
    db.exec(schemaSql);
    applyMigrations(raw);
  }
  return db;
}

// Idempotent column additions for databases created before a column
// existed (CREATE TABLE IF NOT EXISTS never alters an existing table).
function applyMigrations(raw) {
  const cols = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
  if (!cols("play_sessions").includes("multiplier")) {
    raw.exec("ALTER TABLE play_sessions ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1");
  }
  if (!cols("play_results").includes("multiplier")) {
    raw.exec("ALTER TABLE play_results ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1");
  }
}

export function loadSchema(schemaPath) {
  return readFileSync(schemaPath, "utf8");
}
