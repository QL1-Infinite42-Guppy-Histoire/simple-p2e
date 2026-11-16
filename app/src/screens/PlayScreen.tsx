import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { FIELD_WIDTH, blockLeftAt, simulate, type SimResult } from '../../../shared/sim.js';
import { GAME_CONFIG, buildShareText, formatScore, localDailySeed } from '../gameLogic';
import { playStart, playSubmit, type SubmitResponse } from '../api';
import { CardLabel, GlassCard, PrimaryButton, styles } from '../ui';

const FLOOR_H = 24;
const VISIBLE_FLOORS = 11;
const FIELD_H = FLOOR_H * (VISIBLE_FLOORS + 1);

function floorColor(level: number, perfect: boolean): string {
  if (perfect) return '#f59e0b'; // PERFECT は金色
  return `hsl(${(level * 24) % 360}, 65%, 55%)`;
}

export default function PlayScreen({
  localOnly,
  onClose,
}: {
  localOnly: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'submitting' | 'done' | 'error'>('ready');
  const [blockLeft, setBlockLeft] = useState(0);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [serverResult, setServerResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seedRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const startAtRef = useRef(0);
  const tapsRef = useRef<number[]>([]);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const currentSupport = useCallback((): { left: number; width: number } => {
    const floors = sim?.floors.filter((f) => !f.gameOver) ?? [];
    const last = floors[floors.length - 1];
    if (!last) {
      return { left: (FIELD_WIDTH - GAME_CONFIG.initialWidth) / 2, width: GAME_CONFIG.initialWidth };
    }
    return { left: last.newLeft, width: last.newWidth };
  }, [sim]);

  // 動くブロックの位置は共有シミュレーションの決定的関数で出す。
  // サーバーの再計算と原理的にズレない (DESIGN.md §3.2b)。
  useEffect(() => {
    if (phase !== 'playing') return;
    const tick = () => {
      const elapsed = Date.now() - startAtRef.current;
      const level = tapsRef.current.length;
      const floors = simulate(seedRef.current, tapsRef.current, GAME_CONFIG).floors.filter((f) => !f.gameOver);
      const last = floors[floors.length - 1];
      const width = last ? last.newWidth : GAME_CONFIG.initialWidth;
      setBlockLeft(blockLeftAt(elapsed, level, seedRef.current, width, GAME_CONFIG));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  const finish = useCallback(
    async (finalSim: SimResult) => {
      if (localOnly || !sessionIdRef.current) {
        setPhase('done');
        return;
      }
      setPhase('submitting');
      try {
        const res = await playSubmit(sessionIdRef.current, tapsRef.current);
        setServerResult(res);
        setPhase('done');
      } catch (e) {
        setError(`結果をサーバーに送れませんでした: ${String((e as Error)?.message || e)}`);
        setPhase('error');
      }
      void finalSim;
    },
    [localOnly],
  );

  const start = useCallback(async () => {
    setError(null);
    setServerResult(null);
    setSim(null);
    tapsRef.current = [];
    try {
      if (localOnly) {
        seedRef.current = localDailySeed();
        sessionIdRef.current = null;
      } else {
        const s = await playStart();
        seedRef.current = s.seed;
        sessionIdRef.current = s.sessionId;
      }
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setError(
        msg.includes('daily_attempt_limit')
          ? '今日のプレイ回数の上限に達しました。また明日どうぞ。'
          : `プレイを開始できませんでした: ${msg}`,
      );
      setPhase('error');
      return;
    }
    startAtRef.current = Date.now();
    setPhase('playing');
  }, [localOnly]);

  const onTap = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const tapMs = Date.now() - startAtRef.current;
    const taps = tapsRef.current;
    if (taps.length > 0 && tapMs <= taps[taps.length - 1]) return;
    taps.push(tapMs);
    const result = simulate(seedRef.current, taps, GAME_CONFIG);
    setSim(result);
    if (result.gameOver) {
      void finish(result);
    }
  }, [finish]);

  const onEndNow = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const result = simulate(seedRef.current, tapsRef.current, GAME_CONFIG);
    setSim(result);
    void finish(result);
  }, [finish]);

  const stacked = sim?.floors.filter((f) => !f.gameOver) ?? [];
  const visible = stacked.slice(-VISIBLE_FLOORS);
  const visibleStartLevel = stacked.length - visible.length;
  const support = currentSupport();
  const lastFloor = stacked[stacked.length - 1];
  const comboNow = lastFloor?.perfect ? lastFloor.combo : 0;

  const finalScore = serverResult?.verifiedScore ?? sim?.score ?? 0;
  const finalFloors = serverResult?.floors ?? sim?.floorsStacked ?? 0;
  const finalRank = serverResult?.ranking.me?.rank ?? null;

  const onShare = useCallback(() => {
    const message = buildShareText({
      score: finalScore,
      floors: finalFloors,
      rank: finalRank,
      isDailyBest: serverResult?.isDailyBest ?? false,
    });
    void Share.share({ message });
  }, [finalScore, finalFloors, finalRank, serverResult]);

  if (phase === 'ready' || phase === 'error') {
    return (
      <GlassCard>
        <CardLabel>あそびかた</CardLabel>
        <Text style={styles.note}>
          左右に動くブロックを、タイミングよくタップして積み上げます。ぴったり重なると PERFECT
          でボーナス。はみ出した分は切り落とされ、細くなっていきます。完全に外れたらおわりです。
        </Text>
        <Text style={styles.note}>スコアがそのままポイントになります（1日にポイントになるのは一番良いスコアだけ）。</Text>
        {localOnly ? (
          <Text style={styles.message}>いまはサーバー未接続です。スコアは端末内だけの仮表示で、ランキングには載りません。</Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <PrimaryButton title="プレイ開始" onPress={() => void start()} />
        <PrimaryButton title="もどる" onPress={onClose} />
      </GlassCard>
    );
  }

  if (phase === 'done') {
    return (
      <GlassCard>
        <CardLabel>けっか</CardLabel>
        <Text style={styles.bigNumber}>
          {formatScore(finalScore)}
          <Text style={styles.unit}> 点</Text>
        </Text>
        <Text style={styles.note}>
          {finalFloors}段 / PERFECT {serverResult?.perfects ?? sim?.perfects ?? 0}回
          {finalRank !== null ? ` / 今日 ${finalRank}位` : ''}
        </Text>
        {serverResult ? (
          <Text style={styles.note}>
            {serverResult.isDailyBest
              ? `今日のベスト更新！ ${formatScore(serverResult.pointsEarned)} pt が貯まりました。`
              : `今日のベストは ${formatScore(serverResult.dailyBest)} 点です（ベスト更新のときだけポイントが増えます）。`}
          </Text>
        ) : (
          <Text style={styles.note}>サーバー未接続のため、このスコアは仮表示です。</Text>
        )}
        <PrimaryButton title="スコアをシェアする" onPress={onShare} />
        <PrimaryButton title="もう一度" onPress={() => setPhase('ready')} />
        <PrimaryButton title="ホームへもどる" onPress={onClose} />
      </GlassCard>
    );
  }

  // playing / submitting
  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: '#14181f', fontSize: 20, fontWeight: '800' }}>
          {formatScore(sim?.score ?? 0)} 点
        </Text>
        <Text style={{ color: '#5c6572', fontSize: 15, fontWeight: '700' }}>{stacked.length} 段</Text>
        {comboNow > 0 ? (
          <Text style={{ color: '#d97706', fontSize: 17, fontWeight: '800' }}>PERFECT ×{comboNow}</Text>
        ) : (
          <Text style={{ fontSize: 17 }}> </Text>
        )}
      </View>
      <Pressable onPress={onTap} style={{ marginTop: 12 }}>
        <View
          style={{
            height: FIELD_H,
            backgroundColor: '#101b3c',
            borderRadius: 12,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* 積み上がったタワー (カメラは上の段に合わせて上がる) */}
          {visible.map((f, i) => (
            <View
              key={f.level}
              style={{
                position: 'absolute',
                bottom: i * FLOOR_H,
                left: `${f.newLeft}%`,
                width: `${f.newWidth}%`,
                height: FLOOR_H - 2,
                borderRadius: 3,
                backgroundColor: floorColor(f.level, f.perfect),
              }}
            />
          ))}
          {/* 土台 */}
          <View
            style={{
              position: 'absolute',
              bottom: -FLOOR_H + 2,
              left: `${(FIELD_WIDTH - GAME_CONFIG.initialWidth) / 2}%`,
              width: `${GAME_CONFIG.initialWidth}%`,
              height: FLOOR_H - 2,
              backgroundColor: '#64748b',
            }}
          />
          {/* 動いているブロック */}
          {phase === 'playing' ? (
            <View
              style={{
                position: 'absolute',
                bottom: visible.length * FLOOR_H,
                left: `${blockLeft}%`,
                width: `${support.width}%`,
                height: FLOOR_H - 2,
                borderRadius: 3,
                backgroundColor: floorColor(stacked.length, false),
                borderWidth: 2,
                borderColor: '#ffffff',
              }}
            />
          ) : null}
          <Text style={{ position: 'absolute', top: 8, alignSelf: 'center', color: '#cfd8ff', fontSize: 13 }}>
            {phase === 'submitting' ? '結果を送信中…' : '画面をタップで落とす'}
          </Text>
        </View>
      </Pressable>
      <Text style={styles.note}>段が上がるほど速くなります。ずれるほど細くなります。</Text>
      <PrimaryButton title="ここで終了する" onPress={onEndNow} disabled={phase !== 'playing'} />
      <View style={{ height: 4 }} />
      <Text style={styles.mono}>表示中の段: {visibleStartLevel + 1}〜{stacked.length}段目</Text>
    </GlassCard>
  );
}
