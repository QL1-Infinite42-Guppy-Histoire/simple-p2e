// 簡素版P2E — QOM 払い出しモジュール (Phase 1: 骨組みのみ・無効)。
//
// 方式は既存ファウセットと同じ (DESIGN.md §7.2):
//   配布専用ウォレット → QL1 EVM (chain 766) ネイティブ送金、
//   ガス価格は送信時に eth_gasPrice を読む、鍵はサーバー環境変数のみ。
//
// Phase 1 では絶対に送金しません:
//   - 配布鍵が環境変数に無い → 無効 (理由: no_distribution_key_configured)
//   - 鍵があっても Phase 1 では送金コードパス自体が無効
//     (理由: phase1_payout_not_enabled)。Phase 2 でこのガードを外し、
//     台帳 payout エントリ作成 → 送金 → tx ハッシュ記録の順で実装する。
//   - pt→QOM レートが未決定 (null) の間も無効。
//
// 本物の鍵をこのファイルや repo に書くことは絶対にありません。

export function payoutStatus(env, config) {
  if (!env.DISTRIBUTION_PRIVATE_KEY) {
    return { enabled: false, reason: "no_distribution_key_configured" };
  }
  if (config.ptToQomRate == null) {
    return { enabled: false, reason: "pt_to_qom_rate_undecided" };
  }
  return { enabled: false, reason: "phase1_payout_not_enabled" };
}

// Phase 1: 常に無効を正直に返す。送金は一切行わない。
export async function attemptPayout(env, config, _account, _points) {
  const status = payoutStatus(env, config);
  return { ok: false, ...status };
}
