// 簡素版P2E server — integration tests.
// Run: node --test test/*.test.js   (from server/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import app from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { jstDateString, weekDates } from "../src/lib/dates.js";
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
  // ボーナス係数を 0 にした設定では スコア = 段数 × 100 で予測できる
  const noBonus = { perfectBaseBonus: 0, perfectComboStep: 0 };
  const env = makeEnv({ config: { dailyEarnCapPoints: 450, holdMs: 0 }, game: noBonus });
  const cfg = { ...GAME_CONFIG, ...noBonus };
  const acct = await register(env);

  const p1 = await playFloors(env, acct.deviceToken, 3, cfg);
  assert.equal(p1.submit.json.verifiedScore, 300);
  assert.equal(p1.submit.json.pointsEarned, 300);

  const pLow = await playFloors(env, acct.deviceToken, 2, cfg);
  assert.equal(pLow.submit.json.isDailyBest, false);
  assert.equal(pLow.submit.json.pointsEarned, 0);

  const p2 = await playFloors(env, acct.deviceToken, 5, cfg);
  assert.equal(p2.submit.json.verifiedScore, 500);
  assert.equal(p2.submit.json.pointsEarned, 150); // 差分200だが上限450で頭打ち

  const p3 = await playFloors(env, acct.deviceToken, 5, cfg);
  assert.equal(p3.submit.json.pointsEarned, 0); // 上限到達後は増えない

  const me = await call(env, "GET", "/me", { token: acct.deviceToken });
  assert.equal(me.json.todayBest, 500);
  assert.equal(me.json.todayEarned, 450);
  assert.equal(me.json.balances.total, 450);
  assert.equal(me.json.balances.confirmed, 450); // holdMs=0 なので即確定
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
  const noBonus = { perfectBaseBonus: 0, perfectComboStep: 0 };
  const env = makeEnv({ game: noBonus });
  const cfg = { ...GAME_CONFIG, ...noBonus };
  const a = await register(env);
  const b = await register(env);
  await playFloors(env, a.deviceToken, 5, cfg); // 500
  const pb = await playFloors(env, b.deviceToken, 3, cfg); // 300
  assert.equal(pb.submit.json.ranking.me.rank, 2);
  assert.equal(pb.submit.json.ranking.above.accountId, a.accountId);
  assert.equal(pb.submit.json.ranking.pointsToNextRank, 201); // あと201点で1位

  const daily = await call(env, "GET", "/ranking/daily", { token: b.deviceToken });
  assert.equal(daily.json.top[0].accountId, a.accountId);
  assert.equal(daily.json.top[0].score, 500);
  assert.equal(daily.json.totalPlayers, 2);
});

test("ranking: weekly is the sum of daily bests", async () => {
  const env = makeEnv();
  const a = await register(env);
  const b = await register(env);
  const dates = weekDates(jstDateString());
  const insert = async (accountId, date, score) => {
    await env.DB.prepare(
      "INSERT INTO daily_bests (account_id, date_jst, best_score, updated_at) VALUES (?,?,?,?)",
    ).bind(accountId, date, score, Date.now()).run();
  };
  await insert(a.accountId, dates[0], 700);
  await insert(a.accountId, dates[1], 300);
  await insert(b.accountId, dates[0], 500);
  const weekly = await call(env, "GET", "/ranking/weekly", { token: b.deviceToken });
  assert.equal(weekly.json.top[0].accountId, a.accountId);
  assert.equal(weekly.json.top[0].score, 1000); // 700 + 300
  assert.equal(weekly.json.me.rank, 2);
  assert.equal(weekly.json.me.score, 500);
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
