// 簡素版P2E — API application logic (Phase 1).
//
// Modelled on the proven M2E Walk server-node patterns (device-token auth
// with hashed tokens, recovery codes, append-only ledger, admin secret),
// with a SEPARATE database and ledger (DESIGN.md §0/§10 — never shared
// with M2E).
//
// Score integrity (DESIGN.md §3.2b): POST /play/submit accepts ONLY a
// session id and a tap-times array. The server replays them through the
// shared simulation (shared/sim.js) and records THAT score. Any score a
// client claims for itself is ignored — see `claimedScoreIgnored` below.
//
// Secrets come from environment variables (never in this repo):
//   ADMIN_SECRET             — required in X-Admin-Secret for /admin/*
//   DISTRIBUTION_PRIVATE_KEY — payout wallet key (Phase 2; unused in P1)
//
// Device auth: header `X-Device-Token: <accountId>.<secret>`.
// Only the sha256 hash of the secret is stored.

import { resolveConfig, PAID_TIERS } from "./config.js";
import { computeBalances, sumEarnForRef } from "./lib/ledger.js";
import { jstDateString, seasonDates, seasonStart } from "./lib/dates.js";
import { dailySeed, simulate } from "../../shared/sim.js";
import { payoutStatus } from "./payout.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const err = (status, code) => json({ error: code }, status);
const now = () => Date.now();

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomToken = (bytes = 24) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// 表示名は未決定 (DESIGN.md §12-12)。当面はアカウントID由来の仮表示。
export const playerLabel = (accountId) => `プレイヤー${accountId.slice(0, 6)}`;

// --- ZAP reward pool / burn stats (DESIGN.md §3.5) -------------------------
// ZAP is the 42 Chain token 0x89195ca5c954b6f99b78f4a2aa5435a75dc5b256,
// 18 decimals (verified on-chain). pool_events is append-only; the public
// display derives ONLY from those rows, so both numbers are 0 until paid
// extra plays actually land.
const ZAP_DECIMALS = 18;

function rawToDecimal(raw) {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(ZAP_DECIMALS + 1, "0");
  const int = s.slice(0, s.length - ZAP_DECIMALS);
  const frac = s.slice(s.length - ZAP_DECIMALS).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export async function poolStats(env) {
  const seasonFrom = seasonStart(jstDateString());
  const seasonStartMs = Date.parse(`${seasonFrom}T00:00:00+09:00`);
  const { results } = await env.DB.prepare(
    "SELECT kind, amount_raw AS amountRaw, created_at AS createdAt FROM pool_events",
  ).all();
  let seasonPool = 0n;
  let totalBurned = 0n;
  for (const row of results || []) {
    let amount;
    try {
      amount = BigInt(row.amountRaw);
    } catch {
      continue;
    }
    if (row.kind === "burn") totalBurned += amount;
    if (row.createdAt >= seasonStartMs) {
      if (row.kind === "pool_in") seasonPool += amount;
      if (row.kind === "pool_out") seasonPool -= amount;
    }
  }
  if (seasonPool < 0n) seasonPool = 0n;
  return {
    zapDecimals: ZAP_DECIMALS,
    seasonStartJst: seasonFrom,
    seasonRewardPoolZap: rawToDecimal(seasonPool),
    totalBurnedZap: rawToDecimal(totalBurned),
  };
}

async function getAccount(env, accountId) {
  return env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId).first();
}

async function ledgerEntries(env, accountId) {
  const { results } = await env.DB.prepare(
    "SELECT type, points_delta AS pointsDelta, ref, memo, created_at AS createdAt FROM ledger WHERE account_id = ? ORDER BY id",
  ).bind(accountId).all();
  return results;
}

async function addLedger(env, accountId, type, pointsDelta, ref = null, memo = null) {
  await env.DB.prepare(
    "INSERT INTO ledger (account_id, type, points_delta, ref, memo, created_at) VALUES (?,?,?,?,?,?)",
  ).bind(accountId, type, pointsDelta, ref, memo, now()).run();
}

async function authenticate(request, env) {
  const header = request.headers.get("x-device-token") || "";
  const dot = header.indexOf(".");
  if (dot < 1) return null;
  const accountId = header.slice(0, dot);
  const secret = header.slice(dot + 1);
  const account = await getAccount(env, accountId);
  if (!account || account.suspended) return null;
  if ((await sha256Hex(secret)) !== account.token_hash) return null;
  return account;
}

function isAdmin(request, env) {
  const secret = request.headers.get("x-admin-secret");
  return !!env.ADMIN_SECRET && !!secret && secret === env.ADMIN_SECRET;
}

// ---------- ranking helpers ----------

// Daily ranking rows for a JST date: verified daily bests only.
async function dailyRanking(env, dateJst) {
  const { results } = await env.DB.prepare(
    "SELECT account_id AS accountId, best_score AS score, updated_at AS updatedAt FROM daily_bests WHERE date_jst = ? AND best_score > 0 ORDER BY best_score DESC, updated_at ASC",
  ).bind(dateJst).all();
  return results.map((r, i) => ({ rank: i + 1, accountId: r.accountId, label: playerLabel(r.accountId), score: r.score }));
}

// Season ranking: sum of ALL verified play scores over the half-month
// season of dateJst (1st..15th / 16th..month-end) — every play counts,
// not just daily bests (user decision 2026-11-17; DESIGN.md §3.4).
// Points earning still follows the daily best; only this ranking is a
// cumulative total.
async function seasonRanking(env, dateJst) {
  const dates = seasonDates(dateJst);
  const placeholders = dates.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT account_id AS accountId, SUM(score) AS score FROM play_results WHERE date_jst IN (${placeholders}) AND score > 0 GROUP BY account_id ORDER BY score DESC, account_id ASC`,
  ).bind(...dates).all();
  return results.map((r, i) => ({ rank: i + 1, accountId: r.accountId, label: playerLabel(r.accountId), score: r.score }));
}

function rankingView(rows, accountId, topN = 50) {
  const mine = rows.find((r) => r.accountId === accountId) || null;
  const view = {
    totalPlayers: rows.length,
    top: rows.slice(0, topN),
    me: mine,
    above: null, // the rival directly above me
    below: null,
    pointsToNextRank: null, // 「あと○点で○位」用
  };
  if (mine) {
    const idx = mine.rank - 1;
    if (idx > 0) {
      view.above = rows[idx - 1];
      view.pointsToNextRank = rows[idx - 1].score - mine.score + 1;
    }
    if (idx < rows.length - 1) view.below = rows[idx + 1];
  }
  return view;
}

// ---------- handlers ----------

async function handleRegister(request, env) {
  const accountId = crypto.randomUUID();
  const secret = randomToken(32);
  const recoveryCode = randomToken(6).toUpperCase(); // 12 hex chars
  await env.DB.prepare(
    "INSERT INTO accounts (id, token_hash, recovery_code_hash, created_at, last_seen_at) VALUES (?,?,?,?,?)",
  ).bind(accountId, await sha256Hex(secret), await sha256Hex(recoveryCode), now(), now()).run();
  return json({ accountId, deviceToken: `${accountId}.${secret}`, recoveryCode }, 201);
}

// Recovery: exchange (accountId + recovery code) for a fresh device token.
// The old token stops working (its hash is replaced).
async function handleRecover(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.accountId || !body?.recoveryCode) return err(400, "bad_request");
  const account = await getAccount(env, String(body.accountId));
  if (!account || account.suspended) return err(401, "unauthorized");
  if ((await sha256Hex(String(body.recoveryCode).toUpperCase())) !== account.recovery_code_hash) {
    return err(401, "unauthorized");
  }
  const secret = randomToken(32);
  await env.DB.prepare("UPDATE accounts SET token_hash = ?, last_seen_at = ? WHERE id = ?")
    .bind(await sha256Hex(secret), now(), account.id).run();
  return json({ accountId: account.id, deviceToken: `${account.id}.${secret}` });
}

async function handlePlayStart(env, cfg, account) {
  const dateJst = jstDateString();
  const { results } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM play_sessions WHERE account_id = ? AND date_jst = ?",
  ).bind(account.id, dateJst).all();
  const used = results[0]?.n || 0;
  // maxAttemptsPerDay <= 0 means unlimited (β期間中。DESIGN.md §3.5).
  if (cfg.maxAttemptsPerDay > 0 && used >= cfg.maxAttemptsPerDay) return err(429, "daily_attempt_limit");
  const sessionId = crypto.randomUUID();
  const seed = dailySeed(dateJst);
  const expiresAt = now() + cfg.sessionTtlMs;
  await env.DB.prepare(
    "INSERT INTO play_sessions (id, account_id, date_jst, seed, nonce, expires_at, created_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(sessionId, account.id, dateJst, seed, randomToken(12), expiresAt, now()).run();
  return json({
    sessionId,
    seed,
    dateJst,
    expiresAt,
    attemptsLeft: cfg.maxAttemptsPerDay > 0 ? cfg.maxAttemptsPerDay - used - 1 : null,
    gameConfig: cfg.game,
  }, 201);
}

async function handlePlaySubmit(request, env, cfg, account) {
  const body = await request.json().catch(() => null);
  if (!body?.sessionId || !Array.isArray(body?.tapTimesMs)) return err(400, "bad_request");
  // 自己申告スコアは採用しない。来ていても無視し、その旨を返すだけ。
  const claimedScoreIgnored = body.score !== undefined || body.claimedScore !== undefined;

  const session = await env.DB.prepare("SELECT * FROM play_sessions WHERE id = ?").bind(String(body.sessionId)).first();
  if (!session || session.account_id !== account.id) return err(404, "session_not_found");
  if (session.used_at) return err(409, "session_already_used");
  if (session.expires_at < now()) return err(410, "session_expired");
  if (session.date_jst !== jstDateString()) return err(410, "session_wrong_day");

  let result;
  try {
    result = simulate(session.seed, body.tapTimesMs, cfg.game);
  } catch {
    return err(400, "bad_tap_times");
  }
  // Paid-play multiplier (DESIGN.md §3.5): the session carries it, the
  // replay produces the raw score, and the recorded score is raw × mult.
  // Free sessions are always ×1; paid sessions exist only after payment
  // verification (not yet enabled — no receiving wallet configured).
  const multiplier = Number.isInteger(session.multiplier) && session.multiplier >= 1 ? session.multiplier : 1;
  const rawScore = result.score;
  result = { ...result, score: rawScore * multiplier };

  await env.DB.prepare("UPDATE play_sessions SET used_at = ? WHERE id = ?").bind(now(), session.id).run();
  await env.DB.prepare(
    "INSERT INTO play_results (session_id, account_id, date_jst, score, multiplier, floors, perfects, taps_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).bind(session.id, account.id, session.date_jst, result.score, multiplier, result.floorsStacked, result.perfects, JSON.stringify(body.tapTimesMs), now()).run();

  // その日のベスト更新分だけを差分で台帳に入れる (日の合計獲得 = ベスト)。
  const dateJst = session.date_jst;
  const bestRow = await env.DB.prepare(
    "SELECT best_score AS best FROM daily_bests WHERE account_id = ? AND date_jst = ?",
  ).bind(account.id, dateJst).first();
  const prevBest = bestRow?.best || 0;
  const isDailyBest = result.score > prevBest;
  let pointsEarned = 0;
  if (isDailyBest) {
    await env.DB.prepare(
      "INSERT INTO daily_bests (account_id, date_jst, best_score, updated_at) VALUES (?,?,?,?) ON CONFLICT(account_id, date_jst) DO UPDATE SET best_score = excluded.best_score, updated_at = excluded.updated_at",
    ).bind(account.id, dateJst, result.score, now()).run();
    const entries = await ledgerEntries(env, account.id);
    const alreadyEarned = sumEarnForRef(entries, `dailybest:${dateJst}`);
    const room = Math.max(0, cfg.dailyEarnCapPoints - alreadyEarned);
    pointsEarned = Math.min(result.score - prevBest, room);
    if (pointsEarned > 0) {
      await addLedger(env, account.id, "earn", pointsEarned, `dailybest:${dateJst}`, `score:${result.score}`);
    }
  }

  const ranking = rankingView(await dailyRanking(env, dateJst), account.id);
  return json({
    verifiedScore: result.score,
    rawScore,
    multiplier,
    floors: result.floorsStacked,
    perfects: result.perfects,
    maxCombo: result.maxCombo,
    gameOver: result.gameOver,
    isDailyBest,
    dailyBest: Math.max(prevBest, result.score),
    pointsEarned,
    claimedScoreIgnored,
    ranking,
  });
}

async function handleMe(env, cfg, account) {
  const entries = await ledgerEntries(env, account.id);
  const balances = computeBalances(entries, now(), cfg.holdMs);
  const dateJst = jstDateString();
  const bestRow = await env.DB.prepare(
    "SELECT best_score AS best FROM daily_bests WHERE account_id = ? AND date_jst = ?",
  ).bind(account.id, dateJst).first();
  const ranking = rankingView(await dailyRanking(env, dateJst), account.id);
  const payout = payoutStatus(env, cfg);
  const { results: usedRows } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM play_sessions WHERE account_id = ? AND date_jst = ?",
  ).bind(account.id, dateJst).all();
  const attemptsUsed = usedRows[0]?.n || 0;
  return json({
    accountId: account.id,
    label: playerLabel(account.id),
    balances,
    attemptsLeftToday: cfg.maxAttemptsPerDay > 0 ? Math.max(0, cfg.maxAttemptsPerDay - attemptsUsed) : null,
    todayBest: bestRow?.best || 0,
    todayEarned: sumEarnForRef(entries, `dailybest:${dateJst}`),
    ranking,
    payoutAddress: account.payout_address || null,
    payoutEnabled: payout.enabled,
    payoutReason: payout.reason,
    seasonNotice: cfg.seasonNotice || null,
    config: {
      dailyEarnCapPoints: cfg.dailyEarnCapPoints,
      maxAttemptsPerDay: cfg.maxAttemptsPerDay,
      holdMs: cfg.holdMs,
      ratesFinal: false, // 数値はすべて仮値・未決定 (DESIGN.md §4)
      paidTiers: PAID_TIERS, // 追加プレイの倍率ティア (DESIGN.md §3.5)
      paidPlaysEnabled: false, // 受取ウォレット待ちのため未有効化
    },
  });
}

async function handleHistory(env, account) {
  const { results } = await env.DB.prepare(
    "SELECT id, type, points_delta AS pointsDelta, ref, memo, created_at AS createdAt FROM ledger WHERE account_id = ? ORDER BY id DESC LIMIT 100",
  ).bind(account.id).all();
  return json({ history: results });
}

const QL1_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

async function handleSetAddress(request, env, account) {
  const body = await request.json().catch(() => null);
  const address = String(body?.address || "");
  if (!QL1_ADDRESS_RE.test(address)) return err(400, "bad_address_format");
  await env.DB.prepare("UPDATE accounts SET payout_address = ? WHERE id = ?").bind(address, account.id).run();
  return json({ ok: true, payoutAddress: address });
}

async function handlePayouts(env, cfg, account) {
  const payout = payoutStatus(env, cfg);
  return json({
    payouts: [],
    payoutEnabled: payout.enabled,
    reason: payout.reason,
    note: "払い出しはまだ始まっていません (Phase 1)。",
  });
}

// ---------- admin (X-Admin-Secret required, status only) ----------

async function handleAdminStatus(env, cfg) {
  const counts = {};
  for (const table of ["accounts", "play_sessions", "play_results", "ledger", "daily_bests"]) {
    const { results } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all();
    counts[table] = results[0]?.n || 0;
  }
  const payout = payoutStatus(env, cfg);
  return json({ ok: true, service: "simple-p2e", counts, payoutEnabled: payout.enabled, payoutReason: payout.reason });
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const cfg = resolveConfig(env);
    try {
      if (path === "/health") {
        const payout = payoutStatus(env, cfg);
        return json({ ok: true, service: "simple-p2e", payoutEnabled: payout.enabled });
      }
      if (path === "/stats" && request.method === "GET") return json(await poolStats(env));
      if (path === "/register" && request.method === "POST") return handleRegister(request, env);
      if (path === "/recover" && request.method === "POST") return handleRecover(request, env);

      if (path.startsWith("/admin/")) {
        if (!isAdmin(request, env)) return err(401, "admin_auth_required");
        if (path === "/admin/status" && request.method === "POST") return handleAdminStatus(env, cfg);
        return err(404, "not_found");
      }

      const account = await authenticate(request, env);
      if (!account) return err(401, "unauthorized");
      await env.DB.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").bind(now(), account.id).run();

      if (path === "/play/start" && request.method === "POST") return handlePlayStart(env, cfg, account);
      if (path === "/play/submit" && request.method === "POST") return handlePlaySubmit(request, env, cfg, account);
      if (path === "/me" && request.method === "GET") return handleMe(env, cfg, account);
      if (path === "/me/history" && request.method === "GET") return handleHistory(env, account);
      if (path === "/me/address" && request.method === "POST") return handleSetAddress(request, env, account);
      if (path === "/me/payouts" && request.method === "GET") return handlePayouts(env, cfg, account);
      if (path === "/ranking/daily" && request.method === "GET") {
        return json({ dateJst: jstDateString(), ...rankingView(await dailyRanking(env, jstDateString()), account.id) });
      }
      if (path === "/ranking/season" && request.method === "GET") {
        const dateJst = jstDateString();
        return json({ seasonStartJst: seasonStart(dateJst), ...rankingView(await seasonRanking(env, dateJst), account.id) });
      }
      return err(404, "not_found");
    } catch (e) {
      return json({ error: "internal", detail: String(e?.message || e) }, 500);
    }
  },
};
