import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import {
  ensureDeviceRegistration, fetchMe, getStoredRecoveryCode,
  type MeResponse,
} from './src/api';
import { APP_NAME_PROVISIONAL, formatScore, rankGapText } from './src/gameLogic';
import { CardLabel, GalaxyBackground, GlassCard, PrimaryButton, styles } from './src/ui';
import PlayScreen from './src/screens/PlayScreen';
import RankingScreen from './src/screens/RankingScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';

type Tab = 'home' | 'ranking' | 'history' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'ホーム' },
  { key: 'ranking', label: 'ランキング' },
  { key: 'history', label: '履歴' },
  { key: 'settings', label: '設定' },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [localOnly, setLocalOnly] = useState(true);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [playing, setPlaying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      setLoadError(null);
      setMe(await fetchMe());
    } catch (e) {
      setLoadError(`サーバーから情報を読めませんでした: ${String((e as Error)?.message || e)}`);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const reg = await ensureDeviceRegistration();
      setAccountId(reg.accountId);
      setLocalOnly(reg.localOnly);
      setRecoveryCode(await getStoredRecoveryCode());
      setReady(true);
      if (!reg.localOnly) await refreshMe();
    })();
  }, [refreshMe]);

  const onPlayClose = useCallback(() => {
    setPlaying(false);
    setRefreshKey((k) => k + 1);
    if (!localOnly) void refreshMe();
  }, [localOnly, refreshMe]);

  const gap = me ? rankGapText(me.ranking.me?.rank ?? null, me.ranking.pointsToNextRank) : null;

  return (
    <GalaxyBackground>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>{APP_NAME_PROVISIONAL}</Text>
          <Text style={styles.subtitle}>ブロックを積んで競う、QOMがもらえるゲーム（検証版）</Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{localOnly ? 'サーバー未接続（端末内のみ）' : 'サーバー接続中'}</Text>
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>コミュニティによる開発</Text>
            </View>
          </View>

          <View style={styles.tabRow}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.tabBtn, tab === t.key && !playing ? styles.tabBtnActive : null]}
                onPress={() => {
                  setPlaying(false);
                  setTab(t.key);
                  setRefreshKey((k) => k + 1);
                }}
              >
                <Text style={styles.tabText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {!ready ? (
            <GlassCard>
              <ActivityIndicator color="#2563eb" />
              <Text style={styles.note}>読み込み中…</Text>
            </GlassCard>
          ) : playing ? (
            <PlayScreen localOnly={localOnly} onClose={onPlayClose} />
          ) : tab === 'ranking' ? (
            <RankingScreen localOnly={localOnly} refreshKey={refreshKey} />
          ) : tab === 'history' ? (
            <HistoryScreen localOnly={localOnly} refreshKey={refreshKey} />
          ) : tab === 'settings' ? (
            <SettingsScreen
              accountId={accountId}
              recoveryCode={recoveryCode}
              payoutAddress={me?.payoutAddress ?? null}
              localOnly={localOnly}
              onAddressSaved={() => void refreshMe()}
            />
          ) : (
            <>
              <GlassCard>
                <CardLabel>ポイント</CardLabel>
                <View style={styles.pointsRow}>
                  <View style={styles.pointBox}>
                    <Text style={styles.pointLabel}>保留中</Text>
                    <Text style={styles.pointValue}>{formatScore(me?.balances.pending ?? 0)} pt</Text>
                  </View>
                  <View style={styles.pointBox}>
                    <Text style={styles.pointLabel}>確定</Text>
                    <Text style={styles.pointValue}>{formatScore(me?.balances.confirmed ?? 0)} pt</Text>
                  </View>
                </View>
                <Text style={styles.note}>
                  {localOnly
                    ? 'いまはサーバー未接続です。ポイントはサーバーにつながってから貯まります。'
                    : '貯まったポイントは、しばらく保留されてから確定します。確定ポイントがQOMへの交換対象です（交換はまだ始まっていません）。'}
                </Text>
                {!localOnly && me?.attemptsLeftToday != null ? (
                  <Text style={styles.note}>今日の無料プレイは あと {me.attemptsLeftToday} 回です（追加プレイは10 ZAP・準備中）。</Text>
                ) : null}
                {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
              </GlassCard>

              <GlassCard>
                <CardLabel>今日の記録</CardLabel>
                <Text style={styles.bigNumber}>
                  {formatScore(me?.todayBest ?? 0)}
                  <Text style={styles.unit}> 点（今日のベスト）</Text>
                </Text>
                {me?.ranking.me ? (
                  <Text style={styles.note}>
                    今日 {me.ranking.me.rank}位 / {me.ranking.totalPlayers}人中
                    {gap ? `。${gap}！` : me.ranking.me.rank === 1 ? '。トップです！' : ''}
                  </Text>
                ) : (
                  <Text style={styles.note}>今日はまだ遊んでいません。最初のスコアで順位がつきます。</Text>
                )}
                <PrimaryButton title="あそぶ" onPress={() => setPlaying(true)} />
              </GlassCard>

              <GlassCard>
                <CardLabel>正直な注意書き</CardLabel>
                <Text style={styles.note}>・ポイントは遊んだ分の小さなごほうびです。お金が稼げるものではありません。</Text>
                <Text style={styles.note}>・QOMは暗号資産で、価格が変動します。</Text>
                <Text style={styles.note}>・今日のランキングは全員同じ条件です。スコアはサーバーで再計算して確認しています。</Text>
              </GlassCard>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </GalaxyBackground>
  );
}
