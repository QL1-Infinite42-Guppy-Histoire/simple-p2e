// shared/sim.js のユニットテスト。実行: node --test shared/test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_WIDTH, GAME_CONFIG, dailySeed, seedPhase, periodForLevel,
  blockLeftAt, simulate,
} from "../sim.js";

const SEED = dailySeed("2026-11-17");

// その段で台の真上に来るタップ時刻を探す (テスト用のタップ列生成)。
// サーバー検証のテストでも同じ考え方を使う: 位置は決定的関数なので、
// 「良いタップ」は時刻を走査すれば必ず作れる。
function findAlignedTap(seed, level, width, supportLeft, afterMs) {
  const period = periodForLevel(level);
  let bestT = afterMs + 1;
  let bestErr = Infinity;
  for (let t = afterMs + 1; t <= afterMs + period + 2; t += 1) {
    const err = Math.abs(blockLeftAt(t, level, seed, width) - supportLeft);
    if (err < bestErr) { bestErr = err; bestT = t; }
  }
  return bestT;
}

function perfectTaps(seed, count) {
  const taps = [];
  let supportLeft = (FIELD_WIDTH - GAME_CONFIG.initialWidth) / 2;
  const width = GAME_CONFIG.initialWidth;
  let prev = 0;
  for (let level = 0; level < count; level++) {
    const t = findAlignedTap(seed, level, width, supportLeft, prev);
    taps.push(t);
    prev = t;
  }
  return taps;
}

test("determinism: same seed + taps → same result", () => {
  const taps = perfectTaps(SEED, 5);
  const a = simulate(SEED, taps);
  const b = simulate(SEED, taps);
  assert.deepEqual(a, b);
  assert.equal(a.floorsStacked, 5);
});

test("daily seed: same date same seed, different date different seed", () => {
  assert.equal(dailySeed("2026-11-17"), dailySeed("2026-11-17"));
  assert.notEqual(dailySeed("2026-11-17"), dailySeed("2026-11-18"));
});

test("different seed → different phase/direction pattern", () => {
  const a = seedPhase(dailySeed("2026-11-17"));
  // 少なくともどちらかの日付で位相が変わることを確認 (全日同一なら壊れている)
  const phases = new Set();
  for (let d = 10; d <= 25; d++) phases.add(seedPhase(dailySeed(`2026-11-${d}`)).phase01);
  assert.ok(phases.size > 8, `phases vary across days (got ${phases.size})`);
  assert.ok(a.phase01 >= 0 && a.phase01 < 1);
});

test("block position stays inside the field", () => {
  for (let level = 0; level < 8; level++) {
    for (let t = 0; t < 10000; t += 137) {
      const left = blockLeftAt(t, level, SEED, 40);
      assert.ok(left >= 0 && left <= FIELD_WIDTH - 40, `left=${left}`);
    }
  }
});

test("speed curve: period shortens per floor and floors at the minimum", () => {
  assert.ok(periodForLevel(5) < periodForLevel(0));
  assert.equal(periodForLevel(1000), GAME_CONFIG.minPeriodMs);
});

test("PERFECT snap: aligned taps keep full width and grow combo bonus", () => {
  const taps = perfectTaps(SEED, 3);
  const r = simulate(SEED, taps);
  assert.equal(r.gameOver, false);
  assert.equal(r.perfects, 3);
  assert.equal(r.maxCombo, 3);
  for (const f of r.floors) {
    assert.equal(f.perfect, true);
    assert.equal(f.newWidth, GAME_CONFIG.initialWidth); // 切り落とされない
  }
  // スコア = 3段 × pointsPerFloor + ボーナス (50 + 75 + 100)
  const expected = 3 * GAME_CONFIG.pointsPerFloor
    + GAME_CONFIG.perfectBaseBonus
    + (GAME_CONFIG.perfectBaseBonus + GAME_CONFIG.perfectComboStep)
    + (GAME_CONFIG.perfectBaseBonus + GAME_CONFIG.perfectComboStep * 2);
  assert.equal(r.score, expected);
});

test("trim math: a half-overlap tap keeps only the overlap", () => {
  // 1段目を PERFECT にし、2段目は台の端から半分ずれる時刻を探す
  const width = GAME_CONFIG.initialWidth;
  const supportLeft = (FIELD_WIDTH - width) / 2;
  const t0 = findAlignedTap(SEED, 0, width, supportLeft, 0);
  const targetLeft = supportLeft + width / 2; // 右に半分ずらす → 重なりは幅の半分
  const period = periodForLevel(1);
  let t1 = -1;
  for (let t = t0 + 1; t <= t0 + period + 2; t += 1) {
    if (Math.abs(blockLeftAt(t, 1, SEED, width) - targetLeft) < 0.6) { t1 = t; break; }
  }
  assert.ok(t1 > 0, "found a half-offset tap time");
  const r = simulate(SEED, [t0, t1]);
  assert.equal(r.gameOver, false);
  assert.equal(r.floors[1].perfect, false);
  assert.ok(Math.abs(r.floors[1].newWidth - width / 2) < 1.2, `newWidth=${r.floors[1].newWidth}`);
  assert.equal(r.floors[1].points, GAME_CONFIG.pointsPerFloor); // PERFECT ボーナスなし
});

test("game over: a tap with zero overlap ends the run and ignores later taps", () => {
  // 細い台 (幅20・中央) なら完全ミスが起きる。幅40の既定台では2段目は
  // 必ずどこか重なるため、このテストだけ設定を差し替える。
  const cfg = { ...GAME_CONFIG, initialWidth: 20 };
  const width = cfg.initialWidth;
  const supportLeft = (FIELD_WIDTH - width) / 2;
  const t0 = findAlignedTap(SEED, 0, width, supportLeft, 0);
  // 2段目: 台から完全に外れる位置 (左端が台の右端より右) を探す
  const period = periodForLevel(1);
  let tMiss = -1;
  for (let t = t0 + 1; t <= t0 + period + 2; t += 1) {
    const left = blockLeftAt(t, 1, SEED, width);
    if (left >= supportLeft + width + 1 || left + width <= supportLeft - 1) { tMiss = t; break; }
  }
  assert.ok(tMiss > 0, "found a missing tap time");
  const r = simulate(SEED, [t0, tMiss, tMiss + 500], cfg);
  assert.equal(r.gameOver, true);
  assert.equal(r.floorsStacked, 1);
  assert.equal(r.floors.length, 2); // 3回目のタップは処理されない
  assert.equal(r.score, GAME_CONFIG.pointsPerFloor + GAME_CONFIG.perfectBaseBonus);
});

test("invalid tap lists are rejected", () => {
  assert.throws(() => simulate(SEED, [100, 100])); // strictly increasing
  assert.throws(() => simulate(SEED, [-5]));
  assert.throws(() => simulate(SEED, "nope"));
});

test("empty tap list is a zero run", () => {
  const r = simulate(SEED, []);
  assert.equal(r.score, 0);
  assert.equal(r.floorsStacked, 0);
  assert.equal(r.gameOver, false);
});
