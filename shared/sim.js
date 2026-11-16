// 簡素版P2E — スタックゲーム共有シミュレーション (shared/sim.js)
//
// このモジュールはアプリ (React Native) とサーバー (Node) の両方から
// そのまま import される純粋 JavaScript です。副作用なし・I/O なし。
// サーバーはクライアントから届いた「タップ時刻列」をこのモジュールで
// 再計算 (リプレイ検証) し、自己申告スコアは一切採用しません
// (DESIGN.md §3.2b)。
//
// 座標系: フィールド幅を 100 ユニットに正規化し、ブロックは左端座標と
// 幅だけで表します。ブロックの左端位置は「開始からの経過 ms・段数・
// デイリーシード」だけから決まる決定的な三角波関数です。
//
// ============================================================
// 下の GAME_CONFIG の数値はすべて「仮値・未決定」です。
// テストと Phase 1 の動作確認のためだけに置いた暫定値であり、
// ユーザーが決めた本番の数値ではありません (DESIGN.md §4・§12)。
// 本番値はユーザーの決定後にこの1か所を差し替えます。
// ============================================================

export const FIELD_WIDTH = 100;

export const GAME_CONFIG = {
// 最初のブロックの幅 (フィールド幅 100 に対して)
initialWidth: 40,
// PERFECT と判定するずれの許容幅 (ユニット)
perfectTolerance: 1.5,
// 往復周期の基準 (ms)。段が上がるごとに
// periodDecayPerFloor 倍ずつ短くなり (速くなり)、minPeriodMs で止まる
basePeriodMs: 2400,
minPeriodMs: 900,
periodDecayPerFloor: 0.96,
// スコア係数: 1段あたりの点数
pointsPerFloor: 100,
// PERFECT ボーナス: 連続コンボ n 回目のボーナスは
// perfectBaseBonus + perfectComboStep * (n - 1)
perfectBaseBonus: 50,
perfectComboStep: 25,
// 逓減 (ユーザー決定 2026-11-17「積み重ねるほど貰えるポイントを減らす」):
// 1段の得点は floorPointsDecayEvery 段ごとに floorPointsDecayFactor 倍に
// なり、floorPointsMin で止まる。超人的な長ラン (bot等) の旨みを潰し、
// 上位のスコア差を圧縮する。帯と係数は仮値・未決定 (DESIGN.md §4.1)。
floorPointsDecayEvery: 10,
floorPointsDecayFactor: 0.5,
floorPointsMin: 10,
};

// その段 (level) で得られる点数。(基本点 + PERFECTボーナス) に逓減を適用。
export function pointsForLevel(level, config = GAME_CONFIG, bonus = 0) {
const band = Math.floor(level / config.floorPointsDecayEvery);
const scaled = Math.round(
(config.pointsPerFloor + bonus) * Math.pow(config.floorPointsDecayFactor, band),
);
return Math.max(config.floorPointsMin, scaled);
}

// ---------- seed / PRNG ----------

// 文字列 → 32bit ハッシュ (FNV-1a)。デイリーシードの導出に使う。
export function hashString32(text) {
let h = 0x811c9dc5;
for (let i = 0; i < text.length; i++) {
h ^= text.charCodeAt(i);
h = Math.imul(h, 0x01000193);
}
return h >>> 0;
}

// その日 (JST の YYYY-MM-DD) の全員共通シード。
// 日付が同じなら誰でも同じ値になり、その日の条件が全員そろいます。
export function dailySeed(dateJst) {
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateJst))) {
throw new Error("dateJst must be YYYY-MM-DD");
}
return hashString32(`simple-p2e:${dateJst}`);
}

// mulberry32: 決定的な小さい PRNG。
export function mulberry32(seed) {
let a = seed >>> 0;
return function next() {
a = (a + 0x6d2b79f5) | 0;
let t = Math.imul(a ^ (a >>> 15), 1 | a);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}

// シードからその日の開始位相と進行方向を決める (全員共通)。
export function seedPhase(seed) {
const rng = mulberry32(seed >>> 0);
const phase01 = rng(); // 0..1 (周期に対する開始位置)
const direction = rng() < 0.5? 1: -1; // 最初にどちらへ動くか
return { phase01, direction};
}

// ---------- block motion ----------

// 段 level (0 始まり) での往復周期 (ms)。
export function periodForLevel(level, config = GAME_CONFIG) {
if (!Number.isInteger(level) || level < 0) throw new Error("level must be a non-negative integer");
const p = config.basePeriodMs * Math.pow(config.periodDecayPerFloor, level);
return Math.max(config.minPeriodMs, p);
}

// 経過 ms 時点でのブロック左端座標 (決定的三角波)。
// 移動範囲は [0, FIELD_WIDTH - width]。位相と方向はシード由来。
export function blockLeftAt(elapsedMs, level, seed, width, config = GAME_CONFIG) {
if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("elapsedMs must be a non-negative number");
if (!Number.isFinite(width) || width <= 0 || width > FIELD_WIDTH) throw new Error("width out of range");
const span = FIELD_WIDTH - width;
if (span === 0) return 0;
const period = periodForLevel(level, config);
const { phase01, direction} = seedPhase(seed);
let u = (elapsedMs / period + phase01) % 1;
if (u < 0) u += 1;
let tri = u < 0.5? u * 2: 2 - u * 2; // 0 → 1 → 0
if (direction < 0) tri = 1 - tri;
return tri * span;
}

// ---------- simulation ----------

function validateTapTimes(tapTimesMs) {
if (!Array.isArray(tapTimesMs)) throw new Error("tapTimesMs must be an array");
if (tapTimesMs.length > 1000) throw new Error("too many taps");
let prev = -1;
for (const t of tapTimesMs) {
if (!Number.isFinite(t) || t < 0) throw new Error("tap times must be non-negative numbers");
if (t <= prev) throw new Error("tap times must be strictly increasing");
prev = t;
}
}

// simulate(seed, tapTimesMs) → プレイ全体の再計算結果。
//
// 台 (support) は最初、中央に置かれた initialWidth の土台です。
// 各タップで、その段の幅 (= 現在の台の幅) のブロックが blockLeftAt の
// 位置に落ちます:
// - ずれが perfectTolerance 以内 → PERFECT。切り落とさず台に吸着し、
// 連続コンボが伸びてボーナスが増える
// - 重なりがある → 重なった部分だけが新しい台になる (コンボは 0 に戻る)
// - 重なりがゼロ → ゲームオーバー。以降のタップは無視する
export function simulate(seed, tapTimesMs, config = GAME_CONFIG) {
validateTapTimes(tapTimesMs);
const floors = [];
let supportLeft = (FIELD_WIDTH - config.initialWidth) / 2;
let supportWidth = config.initialWidth;
let combo = 0;
let maxCombo = 0;
let perfects = 0;
let score = 0;
let gameOver = false;

for (let level = 0; level < tapTimesMs.length; level++) {
const tapMs = tapTimesMs[level];
const widthBefore = supportWidth;
const blockLeft = blockLeftAt(tapMs, level, seed, widthBefore, config);
const offset = blockLeft - supportLeft;

if (Math.abs(offset) <= config.perfectTolerance) {
combo += 1;
maxCombo = Math.max(maxCombo, combo);
perfects += 1;
const bonus = config.perfectBaseBonus + config.perfectComboStep * (combo - 1);
const points = pointsForLevel(level, config, bonus);
score += points;
floors.push({
level, tapMs, blockLeft, widthBefore, offset,
perfect: true, combo, newLeft: supportLeft, newWidth: supportWidth,
points, gameOver: false,
});
// PERFECT: 台はそのまま (吸着したので位置も幅も変わらない)
continue;
}

const overlapLeft = Math.max(blockLeft, supportLeft);
const overlapRight = Math.min(blockLeft + widthBefore, supportLeft + supportWidth);
const overlap = overlapRight - overlapLeft;

if (overlap <= 0) {
floors.push({
level, tapMs, blockLeft, widthBefore, offset,
perfect: false, combo: 0, newLeft: overlapLeft, newWidth: 0,
points: 0, gameOver: true,
});
gameOver = true;
break;
}

combo = 0;
const points = pointsForLevel(level, config, 0);
score += points;
floors.push({
level, tapMs, blockLeft, widthBefore, offset,
perfect: false, combo: 0, newLeft: overlapLeft, newWidth: overlap,
points, gameOver: false,
});
supportLeft = overlapLeft;
supportWidth = overlap;
}

return {
floors,
floorsStacked: floors.filter((f) =>!f.gameOver).length,
perfects,
maxCombo,
score,
gameOver,
};
}
