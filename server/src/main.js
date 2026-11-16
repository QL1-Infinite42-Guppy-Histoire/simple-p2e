// 簡素版P2E — Node bootstrap (Phase 1: local only).
//
// Serves src/app.js over node:http, backed by SQLite via the D1-compatible
// shim in src/db.js. No dependencies: Node 24 built-ins only.
//
// Configuration is via environment variables (see .env.example):
//   PORT                     listen port   (default 8788 — M2E uses 8787)
//   HOST                     listen addr   (default 127.0.0.1)
//   DB_PATH                  SQLite file   (default ./data/simple-p2e.db)
//   ADMIN_SECRET             required for /admin/* (unset = admin disabled)
//   DISTRIBUTION_PRIVATE_KEY payout key, Phase 2 only (never set in P1)
//
// Run:  node src/main.js

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import app from "./app.js";
import { openDatabase, loadSchema } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(root, "data", "simple-p2e.db");

const db = openDatabase(DB_PATH, loadSchema(join(root, "schema.sql")));

const env = {
  DB: db,
  ADMIN_SECRET: process.env.ADMIN_SECRET || "",
  DISTRIBUTION_PRIVATE_KEY: process.env.DISTRIBUTION_PRIVATE_KEY || "",
};

if (!env.ADMIN_SECRET) {
  console.warn("[simple-p2e] ADMIN_SECRET is not set — /admin/* will reject all requests.");
}
if (env.DISTRIBUTION_PRIVATE_KEY) {
  console.warn("[simple-p2e] DISTRIBUTION_PRIVATE_KEY is set, but payout stays DISABLED in Phase 1.");
}

const MAX_BODY_BYTES = 1024 * 1024;

const server = createServer(async (req, res) => {
  const started = Date.now();
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const url = `http://${req.headers.host || `${HOST}:${PORT}`}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await app.fetch(request, env);
    const out = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(out);
    // Access log: method/path/status only — never headers or bodies.
    console.log(`[simple-p2e] ${req.method} ${new URL(url).pathname} -> ${response.status} (${Date.now() - started}ms)`);
  } catch (e) {
    console.error("[simple-p2e] request failed:", e?.message || e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[simple-p2e] listening on http://${HOST}:${PORT} (db: ${DB_PATH}, payout: disabled)`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
