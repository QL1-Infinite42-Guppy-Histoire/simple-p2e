import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { fetchHistory, fetchPayouts } from '../api';
import { formatScore } from '../gameLogic';
import { CardLabel, GlassCard, styles } from '../ui';

type Entry = { id: number; type: string; pointsDelta: number; memo: string | null; createdAt: number };

export default function HistoryScreen({ localOnly, refreshKey }: { localOnly: boolean; refreshKey: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payoutNote, setPayoutNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (localOnly) return;
    try {
      setError(null);
      const h = await fetchHistory();
      setEntries(h.history);
      const p = await fetchPayouts();
      setPayoutNote(p.note);
    } catch (e) {
      setError(`履歴を読めませんでした: ${String((e as Error)?.message || e)}`);
    }
  }, [localOnly]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <>
      <GlassCard>
        <CardLabel>ポイントの履歴</CardLabel>
        {localOnly ? (
          <Text style={styles.note}>サーバー未接続のため、履歴は表示できません。</Text>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : entries.length === 0 ? (
          <Text style={styles.note}>まだ履歴がありません。遊ぶとここに貯まったポイントが出ます。</Text>
        ) : (
          entries.map((e) => (
            <View key={e.id} style={styles.rankRow}>
              <Text style={styles.rankName}>
                {new Date(e.createdAt).toLocaleDateString('ja-JP')}{' '}
                {e.type === 'earn' ? 'ポイント獲得' : e.type === 'payout' ? 'QOM払い出し' : '調整'}
              </Text>
              <Text style={styles.rankScore}>
                {e.pointsDelta > 0 ? '+' : ''}
                {formatScore(e.pointsDelta)} pt
              </Text>
            </View>
          ))
        )}
      </GlassCard>
      <GlassCard>
        <CardLabel>QOMの払い出し履歴</CardLabel>
        <Text style={styles.note}>
          {localOnly
            ? 'サーバー未接続のため表示できません。'
            : payoutNote || '払い出しはまだ始まっていません。'}
        </Text>
        <Text style={styles.note}>払い出しが始まると、ここに金額と取引ID（tx）が出ます。</Text>
      </GlassCard>
    </>
  );
}
