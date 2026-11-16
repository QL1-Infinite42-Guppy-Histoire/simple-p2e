// 簡素版P2E — サーバー側の設定。
//
// ============================================================
// ここの数値はすべて「仮値・未決定」です。
// Phase 1 のテストと動作確認のためだけの暫定値であり、ユーザーが
// 決めた本番値ではありません (DESIGN.md §4・§12)。
// とくに pt→QOM レートは未決定なので null のまま (払い出し無効)。
// 本番値は環境変数で差し替える想定で、コードに直書きしません。
// ============================================================

import { GAME_CONFIG} from "../../shared/sim.js";

export const CONFIG = {
// ゲームのシミュレーション設定 (共有モジュール側が正。仮値・未決定)
game: GAME_CONFIG,

// 1日のプレイ試行回数の上限
maxAttemptsPerDay: intFromEnv("P2E_MAX_ATTEMPTS_PER_DAY", 5),
// プレイセッションの有効期限 (ms)
sessionTtlMs: intFromEnv("P2E_SESSION_TTL_MS", 10 * 60 * 1000),
// 1日にポイント化できる上限 (その日のベストスコア分まで)
dailyEarnCapPoints: intFromEnv("P2E_DAILY_EARN_CAP", 10000),
// 獲得ポイントの保留期間 (ms)。Phase 1 の確認用に短め。
// 本番の長さは未決定 (DESIGN.md §12-4)。
holdMs: intFromEnv("P2E_HOLD_MS", 60 * 1000),

// 払い出し (Phase 1 では無効。Phase 2 で有効化する)
// pt→QOM レートはなので null。null の間は払い出し不可。
ptToQomRate: null,
ql1ChainId: 766,
ql1RpcUrl: process.env.QL1_RPC_URL || "https://evm-rpc-ql1.mschihuahua.org",
};

function intFromEnv(name, fallback) {
const v = Number(process.env[name]);
return Number.isInteger(v) && v >= 0? v: fallback;
}

// Tests pass per-instance overrides via env.P2E_CONFIG / env.P2E_GAME_CONFIG
// (plain objects merged over the defaults above). Production uses CONFIG.
export function resolveConfig(env = {}) {
const cfg = {...CONFIG,...(env.P2E_CONFIG || {})};
cfg.game = {...GAME_CONFIG,...(env.P2E_GAME_CONFIG || {})};
return cfg;
}
