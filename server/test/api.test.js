// 簡素版P2E server — integration tests.
// Run: node --test test/*.test.js   (from server/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import app from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { jstDateString, seasonDates, seasonStart } from "../src/lib/dates.js";
import {
  FIELD_WIDTH, GAME_CONFIG, blockLeftAt, periodForLevel, simulate,
} from "../../shared/sim.js";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "schema.sql"), "utf8");
const ADMIN = "test-admin-secret";

function makeEnv({ config = {}, game = {} } = {}) {
  const DB = openDatabase(":memory:", schema);
  return {
    DB,
    ADMIN_SECRET: ADMIN,
    DISTRIBUTION_PRIVATE_KEY: "",
    P2E_CONFIG: config,
    P2E_GAME_CONFIG: game,
  };
}

async function call(env, method, path, { token, admin, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-device-token"] = token;
  if (admin) headers["x-admin-secret"] = admin;
  const res = await app.fetch(
    new Request(`http://test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, json: await res.json() };
}

async function register(env) {
  const r = await call(env, "POST", "/register");
  assert.equal(r.status, 201);
  return r.json; // { accountId, deviceToken, recoveryCode }
}

// 「良いタップ」の時刻列を作る: 各段で台の真上に来る時刻を走査で探す。
// 位置が決定的関数なので、クライアントでもサーバーでも同じ列が作れる。
function craftTaps(seed, floorsWanted, cfg = GAME_CONFIG) {
  const taps = [];
  let prev = 0;
  for (let level = 0; level < floorsWanted; level++) {
    const partial = simulate(seed, taps, cfg);
    const last = partial.floors[partial.floors.length - 1];
    const supportLeft = last ? last.newLeft : (FIELD_WIDTH - cfg.initialWidth) / 2;
    const width = last ? last.newWidth : cfg.initialWidth;
    const period = periodForLevel(level, cfg);
    let bestT = prev + 1;
    let bestErr = Infinity;
    for (let t = prev + 1; t <= prev + period + 2; t += 1) {
      const err = Math.abs(blockLeftAt(t, level, seed, width, cfg) - supportLeft);
      if (err < bestErr) { bestErr = err; bestT = t; }
    }
    taps.push(bestT);
    prev = bestT;
  }
  return taps;
}

async function playFloors(env, token, floorsWanted, cfg = GAME_CONFIG, extraBody = {}) {
  const start = await call(env, "POST", "/play/start", { token });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  const taps = craftTaps(start.json.seed, floorsWanted, cfg);
  const submit = await call(env, "POST", "/play/submit", {
    token,
    body: { sessionId: start.json.sessionId, tapTimesMs: taps, ...extraBody },
  });
  return { start: start.json, taps, submit };
}

test("register → /me works; no token → 401", async () => {
  const env = makeEnv();
  const acct = await register(env);
  assert.ok(acct.deviceToken.includes("."));
  assert.equal(acct.recoveryCode.length, 12);
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.status, 200);
  assert.equal(me.json.balances.total, 0);
  assert.equal(me.json.payoutEnabled, false);
  const anon = await call(env, "GET", "/me");
  assert.equal(anon.status, 401);
});

test("play flow: replay-verified score is recorded", async () => {
  const env = makeEnv();
  const acct = await register(env);
  const { start, taps, submit } = await playFloors(env, acct.deviceToken, 3);
  assert.equal(submit.status, 200, JSON.stringify(submit.json));
  const expected = simulate(start.seed, taps, GAME_CONFIG);
  assert.equal(submit.json.verifiedScore, expected.score);
  assert.equal(submit.json.floors, 3);
  assert.equal(submit.json.perfects, 3);
  assert.equal(submit.json.isDailyBest, true);
  assert.equal(submit.json.pointsEarned, expected.score);
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.todayBest, expected.score);
  assert.equal(me.json.balances.total, expected.score);
});

test("fake claimed score is ignored — the replay decides", async () => {
  const env = makeEnv();
  const acct = await register(env);
  const { start, taps, submit } = await playFloors(
    env, acct.deviceToken, 2, GAME_CONFIG, { score: 999999999, claimedScore: 999999999 },
  );
  assert.equal(submit.status, 200);
  const expected = simulate(start.seed, taps, GAME_CONFIG).score;
  assert.equal(submit.json.verifiedScore, expected);
  assert.notEqual(submit.json.verifiedScore, 999999999);
  assert.equal(submit.json.claimedScoreIgnored, true);
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.todayBest, expected); // 台帳にも偽スコアは入らない
});

test("daily best: only the difference earns, capped by the daily cap", async () => {
  // 全段PERFECTのタップ列なので、スコアは得点表×倍率 (×2,×3,×4…) で予測できる:
  // 3段 = 100000×2 + 99000×3 + 98000×4 = 889,000 (0.1点単位)
  // 5段 = 889,000 + 97000×4 + 96000×4 = 1,661,000
  const env = makeEnv({ config: { dailyEarnCapPoints: 1000000, holdMs: 0, maxAttemptsPerDay: 10 } });
  const acct = await register(env);

  const p1 = await playFloors(env, acct.deviceToken, 3);
  assert.equal(p1.submit.json.verifiedScore, 889000);
  assert.equal(p1.submit.json.pointsEarned, 889000);

  const pLow = await playFloors(env, acct.deviceToken, 2);
  assert.equal(pLow.submit.json.isDailyBest, false);
  assert.equal(pLow.submit.json.pointsEarned, 0);

  const p2 = await playFloors(env, acct.deviceToken, 5);
  assert.equal(p2.submit.json.verifiedScore, 1661000);
  assert.equal(p2.submit.json.pointsEarned, 111000); // 差分772,000だが上限1,000,000で頭打ち

  const p3 = await playFloors(env, acct.deviceToken, 5);
  assert.equal(p3.submit.json.pointsEarned, 0); // 上限到達後は増えない

  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.todayBest, 1661000);
  assert.equal(me.json.todayEarned, 1000000);
  assert.equal(me.json.balances.total, 1000000);
  assert.equal(me.json.balances.confirmed, 1000000); // holdMs=0 なので即確定
});

test("hold period: fresh earnings are pending, then confirmed when hold is 0", async () => {
  const env = makeEnv({ config: { holdMs: 3600000 } });
  const acct = await register(env);
  const { submit } = await playFloors(env, acct.deviceToken, 2);
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.balances.pending, submit.json.pointsEarned);
  assert.equal(me.json.balances.confirmed, 0);
});

test("ranking: daily order, caller's rank and the rival above", async () => {
  const env = makeEnv();
  const a = await register(env);
  const b = await register(env);
  await playFloors(env, a.deviceToken, 5); // 1,661,000
  const pb = await playFloors(env, b.deviceToken, 3); // 889,000
  assert.equal(pb.submit.json.ranking.me.rank, 2);
  assert.equal(pb.submit.json.ranking.above.accountId, a.accountId);
  assert.equal(pb.submit.json.ranking.pointsToNextRank, 772001); // あと772,001 (0.1点単位) で1位

  const daily = await call(env, "GET", "/ranking/daily", { token: b.deviceToken });
  assert.equal(daily.json.top[0].accountId, a.accountId);
  assert.equal(daily.json.top[0].score, 1661000);
  assert.equal(daily.json.totalPlayers, 2);
});

test("ranking: season is the sum of ALL plays within the half-month season", async () => {
  const env = makeEnv();
  const a = await register(env);
  const b = await register(env);
  const dates = seasonDates(jstDateString());
  const insert = async (accountId, date, score, n) => {
    const sid = `s-${accountId}-${date}-${n}`;
    await env.DB.prepare(
      "INSERT INTO play_sessions (id, account_id, date_jst, seed, nonce, expires_at, created_at) VALUES (?,?,?,?,?,?,?)",
    ).bind(sid, accountId, date, 1, "n", Date.now(), Date.now()).run();
    await env.DB.prepare(
      "INSERT INTO play_results (session_id, account_id, date_jst, score, floors, perfects, taps_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).bind(sid, accountId, date, score, 1, 0, "[]", Date.now()).run();
  };
  // a: two plays on day 1 (300 + 200) and one on day 2 (500) = 1,000 total.
  // Every play counts — not just the daily best (which would be 800).
  await insert(a.accountId, dates[0], 300, 1);
  await insert(a.accountId, dates[0], 200, 2);
  await insert(a.accountId, dates[1], 500, 3);
  // b: a single 700 play — better than any single a play, lower total.
  await insert(b.accountId, dates[0], 700, 1);
  const season = await call(env, "GET", "/ranking/season", { token: b.deviceToken });
  assert.equal(season.json.top[0].accountId, a.accountId);
  assert.equal(season.json.top[0].score, 1000);
  assert.equal(season.json.me.rank, 2);
  assert.equal(season.json.me.score, 700);
  assert.ok(season.json.seasonStartJst.endsWith("-01") || season.json.seasonStartJst.endsWith("-16"));
});

test("free plays are limited per day when configured (production: 3/day)", async () => {
  const env = makeEnv({ config: { maxAttemptsPerDay: 3 } });
  const acct = await register(env);
  for (let i = 0; i < 3; i++) {
    const s = await call(env, "POST", "/play/start", { token: acct.deviceToken });
    assert.equal(s.status, 201);
    assert.equal(s.json.attemptsLeft, 2 - i);
  }
  const fourth = await call(env, "POST", "/play/start", { token: acct.deviceToken });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.json.error, "daily_attempt_limit");
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.attemptsLeftToday, 0);
});

test("address: bad formats rejected, good address stored", async () => {
  const env = makeEnv();
  const acct = await register(env);
  for (const bad of ["0x123", "hello", "0x" + "g".repeat(40), "ab".repeat(20)]) {
    const r = await call(env, "POST", "/me/address", { token: acct.deviceToken, body: { address: bad } });
    assert.equal(r.status, 400, bad);
  }
  const good = "0x" + "aB".repeat(20);
  const ok = await call(env, "POST", "/me/address", { token: acct.deviceToken, body: { address: good } });
  assert.equal(ok.status, 200);
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.payoutAddress, good);
});

test("admin: 401 without the secret, status with it", async () => {
  const env = makeEnv();
  await register(env);
  const noAuth = await call(env, "POST", "/admin/status");
  assert.equal(noAuth.status, 401);
  const wrong = await call(env, "POST", "/admin/status", { admin: "nope" });
  assert.equal(wrong.status, 401);
  const ok = await call(env, "POST", "/admin/status", { admin: ADMIN });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.counts.accounts, 1);
  assert.equal(ok.json.payoutEnabled, false);
});

test("sessions: single use, and the per-day attempt limit holds", async () => {
  const env = makeEnv({ config: { maxAttemptsPerDay: 2 } });
  const acct = await register(env);
  const s1 = await call(env, "POST", "/play/start", { token: acct.deviceToken });
  assert.equal(s1.status, 201);
  const taps = craftTaps(s1.json.seed, 1);
  const body = { sessionId: s1.json.sessionId, tapTimesMs: taps };
  const first = await call(env, "POST", "/play/submit", { token: acct.deviceToken, body });
  assert.equal(first.status, 200);
  const again = await call(env, "POST", "/play/submit", { token: acct.deviceToken, body });
  assert.equal(again.status, 409); // 同じセッションは二度使えない
  const s2 = await call(env, "POST", "/play/start", { token: acct.deviceToken });
  assert.equal(s2.status, 201);
  const s3 = await call(env, "POST", "/play/start", { token: acct.deviceToken });
  assert.equal(s3.status, 429); // 1日の試行上限 (仮値2で検証)
});

test("payouts endpoint honestly reports disabled in Phase 1", async () => {
  const env = makeEnv();
  const acct = await register(env);
  const r = await call(env, "GET", "/me/payouts", { token: acct.deviceToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.payoutEnabled, false);
  assert.deepEqual(r.json.payouts, []);
  assert.equal(r.json.reason, "no_distribution_key_configured");
});

test("recover: recovery code rotates the device token", async () => {
  const env = makeEnv();
  const acct = await register(env);
  const rec = await call(env, "POST", "/recover", {
    body: { accountId: acct.accountId, recoveryCode: acct.recoveryCode },
  });
  assert.equal(rec.status, 200);
  assert.notEqual(rec.json.deviceToken, acct.deviceToken);
  const oldToken = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(oldToken.status, 401);
  const newToken = await call(env, "GET", "/me", { token: rec.json.deviceToken });
  assert.equal(newToken.status, 200);
  const bad = await call(env, "POST", "/recover", {
    body: { accountId: acct.accountId, recoveryCode: "FFFFFFFFFFFF" },
  });
  assert.equal(bad.status, 401);
});

test("history lists earn entries newest first", async () => {
  const env = makeEnv();
  const acct = await register(env);
  await playFloors(env, acct.deviceToken, 2);
  const h = await call(env, "GET", "/me/history", { token: acct.deviceToken });
  assert.equal(h.status, 200);
  assert.equal(h.json.history.length, 1);
  assert.equal(h.json.history[0].type, "earn");
  assert.ok(h.json.history[0].pointsDelta > 0);
});

test("paid multiplier: session multiplier scales the verified score", async () => {
  const env = makeEnv();
  const acct = await register(env);
  const start = await call(env, "POST", "/play/start", { token: acct.deviceToken });
  assert.equal(start.status, 201);
  // Simulate a future paid session (payment verification is not enabled
  // yet, so the test sets the multiplier the payment flow will set).
  await env.DB.prepare("UPDATE play_sessions SET multiplier = 5 WHERE id = ?")
    .bind(start.json.sessionId).run();
  const taps = craftTaps(start.json.seed, 2);
  const submit = await call(env, "POST", "/play/submit", {
    token: acct.deviceToken,
    body: { sessionId: start.json.sessionId, tapTimesMs: taps },
  });
  assert.equal(submit.status, 200, JSON.stringify(submit.json));
  const raw = simulate(start.json.seed, taps, GAME_CONFIG).score;
  assert.equal(submit.json.rawScore, raw);
  assert.equal(submit.json.multiplier, 5);
  assert.equal(submit.json.verifiedScore, raw * 5);
  assert.equal(submit.json.pointsEarned, raw * 5);
  // /me exposes the tier menu and the (disabled) paid-play flag.
  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.config.paidPlaysEnabled, false);
  assert.deepEqual(me.json.config.paidTiers.map((t) => t.multiplier), [1, 2, 3, 4, 5]);
});

test("stats: pool and burn totals derive only from pool_events", async () => {
  const env = makeEnv();
  // No events yet: both are honestly zero, and /stats is public.
  const empty = await call(env, "GET", "/stats");
  assert.equal(empty.status, 200);
  assert.equal(empty.json.seasonRewardPoolZap, "0");
  assert.equal(empty.json.totalBurnedZap, "0");
  assert.equal(empty.json.zapDecimals, 18);

  const nowMs = Date.now();
  const zap = (n) => (BigInt(n) * 10n ** 18n).toString();
  const ins = (kind, amountRaw, createdAt) =>
    env.DB.prepare("INSERT INTO pool_events (kind, amount_raw, ref, created_at) VALUES (?,?,?,?)")
      .bind(kind, amountRaw, "test", createdAt).run();
  await ins("pool_in", zap(7), nowMs);
  await ins("pool_in", zap(7), nowMs);
  await ins("burn", zap(3), nowMs);
  await ins("burn", zap(3), nowMs);
  // Last season's pool_in must NOT count into this season's pool.
  const prevSeasonMs = Date.parse(`${seasonStart(jstDateString())}T00:00:00+09:00`) - 1000;
  await ins("pool_in", zap(70), prevSeasonMs);

  const s = await call(env, "GET", "/stats");
  assert.equal(s.json.seasonRewardPoolZap, "14");
  assert.equal(s.json.totalBurnedZap, "6");
  // Burn total is all-time, so it stays 6 even for last season's burn.
  await ins("burn", zap(4), prevSeasonMs);
  const s2 = await call(env, "GET", "/stats");
  assert.equal(s2.json.totalBurnedZap, "10");
  assert.equal(s2.json.seasonRewardPoolZap, "14");
});
