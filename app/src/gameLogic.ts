// ゲームまわりの純粋ロジック (UI なし) — test/gameLogic.test.mjs で検証。
// シミュレーション本体は shared/sim.js をそのまま使う (サーバーと同一)。
import { GAME_CONFIG, dailySeed, simulate, type SimResult} from '../../shared/sim.js';

export { GAME_CONFIG, dailySeed, simulate};
export type { SimResult};

// アプリ名は。これは仮称であり、正式名称ではない。
export const APP_NAME_PROVISIONAL = 'スタックP2E（仮称）';

// 端末のローカル時刻ではなく JST の日付 (サーバーの日次と一致させる)。
export function jstToday(nowMs: number = Date.now()): string {
return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ローカル (サーバー未接続) モードで使う、その日のシード。
// サーバー接続時はサーバー発行のシードが正で、値は同じ式で一致する。
export function localDailySeed(nowMs: number = Date.now()): number {
return dailySeed(jstToday(nowMs));
}

// スコア/ポイントは内部で 0.1点単位 (×10 の整数。得点表に 0.5/0.1 があるため)。
// 表示は 1/10 して、整数なら整数、小数があれば小数1桁で出す。
export function formatScore(x10: number): string {
const v = x10 / 10;
return Number.isInteger(v)
? v.toLocaleString()
: v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// 「あと○点で○位」表示。すでに1位なら null。
export function rankGapText(myRank: number | null, pointsToNextRank: number | null): string | null {
if (myRank === null || myRank <= 1 || pointsToNextRank === null) return null;
return `あと${formatScore(pointsToNextRank)}点で${myRank - 1}位`;
}

// SNS シェア文。スコアと順位だけを自慢する。
// 獲得 QOM 額・「稼げる」類の表現 (DESIGN.md §3.3)。
export function buildShareText(result: {
score: number;
floors: number;
rank: number | null;
isDailyBest: boolean;
}): string {
const parts = [
`${APP_NAME_PROVISIONAL}で${formatScore(result.score)}点！`,
`${result.floors}段積み上げた`,
];
if (result.rank!== null) parts.push(`今日${result.rank}位`);
if (result.isDailyBest) parts.push('自己ベスト更新！');
return parts.join(' ');
}
