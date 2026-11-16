import React, { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fetchRanking, fetchStats, type PoolStats, type RankingView } from '../api';
import { formatScore, rankGapText } from '../gameLogic';
import { CardLabel, GlassCard, styles } from '../ui';

export default function RankingScreen({ localOnly, refreshKey }: { localOnly: boolean; refreshKey: number }) {
  const [kind, setKind] = useState<'daily' | 'season'>('daily');
  const [ranking, setRanking] = useState<RankingView | null>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (localOnly) return;
    try {
      setError(null);
      setRanking(await fetchRanking(kind));
    } catch (e) {
      setError(`ランキングを読めませんでした: ${String((e as Error)?.message || e)}`);
    }
    try {
      setStats(await fetchStats());
    } catch {
      setStats(null);
    }
  }, [kind, localOnly]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const gap = ranking ? rankGapText(ranking.me?.rank ?? null, ranking.pointsToNextRank) : null;

  return (
    <>
      {!localOnly && stats ? (
        <GlassCard>
          <CardLabel>報酬プールとバーン（ZAP）</CardLabel>
          <Text style={styles.note}>今シーズンの報酬プール: {stats.seasonRewardPoolZap} ZAP</Text>
          <Text style={styles.note}>総バーン数: {stats.totalBurnedZap} ZAP</Text>
          <Text style={styles.note}>
            追加プレイ（10 ZAP）のうち7 ZAPがプールに、3 ZAPがバーンに回ります。数字はサーバーの実績集計です。
          </Text>
        </GlassCard>
      ) : null}
    <GlassCard>
      <CardLabel>ランキング</CardLabel>
      <View style={styles.tabRow}>
        {(['daily', 'season'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.tabBtn, kind === k ? styles.tabBtnActive : null]}
            onPress={() => setKind(k)}
          >
            <Text style={styles.tabText}>{k === 'daily' ? '今日' : 'シーズン'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {localOnly ? (
        <Text style={styles.note}>サーバー未接続のため、ランキングは表示できません。</Text>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : !ranking ? (
        <Text style={styles.note}>読み込み中…</Text>
      ) : (
        <>
          {ranking.me ? (
            <Text style={styles.note}>
              あなたは {ranking.me.rank}位（{formatScore(ranking.me.score)}点）
              {gap ? `。${gap}！` : ranking.me.rank === 1 ? '。トップです！' : ''}
            </Text>
          ) : (
            <Text style={styles.note}>まだ{kind === 'daily' ? '今日' : '今シーズン'}のスコアがありません。遊ぶと順位がつきます。</Text>
          )}
          {ranking.top.length === 0 ? (
            <Text style={styles.note}>まだ誰も遊んでいません。一番乗りできます。</Text>
          ) : (
            ranking.top.map((r) => (
              <View key={r.accountId} style={[styles.rankRow, ranking.me?.accountId === r.accountId ? styles.rankRowMe : null]}>
                <Text style={styles.rankNum}>{r.rank}位</Text>
                <Text style={styles.rankName}>{r.label}</Text>
                <Text style={styles.rankScore}>{formatScore(r.score)}点</Text>
              </View>
            ))
          )}
          <Text style={styles.note}>
            {kind === 'daily'
              ? '今日のランキングは全員同じ条件（同じシード）です。差は腕の差だけ。'
              : 'シーズンは半月ごと（1日〜15日／16日〜月末）です。シーズンランキングは、その期間に遊んだ全プレイの合計です。たくさん遊ぶ人が強くなります。'}
          </Text>
        </>
      )}
    </GlassCard>
    </>
  );
}
