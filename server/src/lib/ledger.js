// Pure ledger logic (no I/O) — unit-tested via the API tests.
//
// Points are NEVER a mutable balance. Every movement is an append-only
// ledger row with a signed points_delta. Balances are derived:
//   total     = SUM(points_delta)
//   confirmed = SUM(points_delta of rows at least `holdMs` old)
//               (payout/adjust rows count immediately: they are not earnings)
//   pending   = total - confirmed
// The hold period is therefore pure config: changing it re-derives every
// balance without touching stored rows.

export function computeBalances(entries, nowMs, holdMs) {
  let total = 0;
  let confirmed = 0;
  for (const e of entries) {
    const delta = e.pointsDelta || 0;
    total += delta;
    if (e.type !== "earn" || nowMs - e.createdAt >= holdMs) {
      confirmed += delta;
    }
  }
  if (confirmed < 0) confirmed = 0; // defensive; payout guards prevent this
  return { total, pending: total - confirmed, confirmed };
}

export function sumEarnForRef(entries, ref) {
  let sum = 0;
  for (const e of entries) {
    if (e.type === "earn" && e.ref === ref) sum += e.pointsDelta || 0;
  }
  return sum;
}
