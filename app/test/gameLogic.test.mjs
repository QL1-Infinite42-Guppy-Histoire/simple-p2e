// アプリ側ロジックのテスト。実行: node --test test/*.test.mjs (app/ から)
// gameLogic.ts は共有シミュレーション (shared/sim.js) をそのまま使う。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_NAME_PROVISIONAL, buildShareText, jstToday, localDailySeed, rankGapText, simulate,
} from "../src/gameLogic.ts";
import { dailySeed } from "../../shared/sim.js";

test("app uses the same daily seed as the server/shared module", () => {
  const now = Date.UTC(2026, 10, 17, 3, 0, 0); // 12:00 JST
  assert.equal(jstToday(now), "2026-11-17");
  assert.equal(localDailySeed(now), dailySeed("2026-11-17"));
});

test("JST date rolls over at 00:00 JST, not UTC", () => {
  const beforeMidnightJst = Date.UTC(2026, 10, 17, 14, 59, 0); // 23:59 JST
  const afterMidnightJst = Date.UTC(2026, 10, 17, 15, 1, 0); // 00:01 JST next day
  assert.equal(jstToday(beforeMidnightJst), "2026-11-17");
  assert.equal(jstToday(afterMidnightJst), "2026-11-18");
});

test("simulate is reachable through the app path and deterministic", () => {
  const seed = dailySeed("2026-11-17");
  const a = simulate(seed, [1000, 2000, 3000]);
  const b = simulate(seed, [1000, 2000, 3000]);
  assert.deepEqual(a, b);
});

test("share text: score + floors + rank, and never any QOM/earnings wording", () => {
  const text = buildShareText({ score: 123450, floors: 42, rank: 3, isDailyBest: true }); // 内部単位は0.1点
  assert.ok(text.includes("12,345点"));
  assert.ok(text.includes("42段"));
  assert.ok(text.includes("今日3位"));
  assert.ok(text.includes("自己ベスト更新"));
  assert.ok(!text.includes("QOM"), "share text must not mention QOM amounts");
  assert.ok(!text.includes("稼"), "share text must not promise earnings");
});

test("share text without a rank omits the rank part", () => {
  const text = buildShareText({ score: 100, floors: 1, rank: null, isDailyBest: false });
  assert.ok(!text.includes("位"));
});

test("rank gap text: only for non-top ranks with a known gap", () => {
  assert.equal(rankGapText(3, 2010), "あと201点で2位"); // 内部単位は0.1点
  assert.equal(rankGapText(3, 2015), "あと201.5点で2位");
  assert.equal(rankGapText(1, null), null);
  assert.equal(rankGapText(2, null), null);
  assert.equal(rankGapText(null, 10), null);
});

test("provisional app name is clearly marked as provisional", () => {
  assert.ok(APP_NAME_PROVISIONAL.includes("仮称"));
});
