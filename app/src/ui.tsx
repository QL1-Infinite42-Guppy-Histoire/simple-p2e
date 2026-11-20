import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// Guppy 系の見た目: 銀河背景 + 半透明の白ガラスカード + 濃い文字 +
// ボタンは青基調 (M2E アプリと統一。DESIGN.md §6)。
export function GalaxyBackground({ children }: { children: React.ReactNode }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: ((i * 37) % 100) + (i % 5) * 0.7,
        top: ((i * 53) % 100) + (i % 3) * 0.9,
        size: (i % 3) + 1,
        opacity: 0.25 + ((i * 7) % 10) / 18,
      })),
    [],
  );
  return (
    <LinearGradient colors={['#0b1030', '#1b2452', '#3a2a63', '#101b3c']} style={styles.root}>
      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: `${s.left}%` as never,
            top: `${s.top}%` as never,
            width: s.size,
            height: s.size,
            borderRadius: s.size / 2,
            backgroundColor: '#ffffff',
            opacity: s.opacity,
          }}
        />
      ))}
      {children}
    </LinearGradient>
  );
}

export function GlassCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function CardLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.cardLabel}>{children}</Text>;
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <View style={styles.disabledBtn}>
        <Text style={styles.disabledBtnText}>{title}</Text>
      </View>
    );
  }
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress}>
      <Text style={styles.primaryBtnText}>{title}</Text>
    </TouchableOpacity>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },
  title: { color: '#ffffff', fontSize: 26, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#cfd8ff', fontSize: 15, marginTop: 4, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, elevation: 3,
  },
  cardLabel: { color: '#5c6572', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  bigNumber: { color: '#14181f', fontSize: 44, fontWeight: '800' },
  unit: { fontSize: 18, fontWeight: '600', color: '#5c6572' },
  note: { color: '#374151', fontSize: 14, lineHeight: 21, marginTop: 6 },
  seasonNotice: { color: '#92400e', backgroundColor: '#fef3c7', fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, overflow: 'hidden' },
  message: { color: '#1d4ed8', fontSize: 14, marginTop: 10, lineHeight: 20 },
  errorText: { color: '#b91c1c', fontSize: 14, marginTop: 10, lineHeight: 20 },
  primaryBtn: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  disabledBtn: { backgroundColor: '#e5e7eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 10, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  disabledBtnText: { color: '#6b7280', fontSize: 15, fontWeight: '600' },
  pointsRow: { flexDirection: 'row', gap: 12 },
  pointBox: { flex: 1, backgroundColor: '#eef1f5', borderRadius: 12, padding: 12 },
  pointLabel: { color: '#5c6572', fontSize: 12, fontWeight: '700' },
  pointValue: { color: '#14181f', fontSize: 24, fontWeight: '800', marginTop: 4 },
  mono: { color: '#374151', fontSize: 13, marginTop: 4, fontFamily: 'monospace' },
  input: {
    borderWidth: 1, borderColor: '#e3e6ec', borderRadius: 12, padding: 12,
    fontSize: 16, backgroundColor: '#ffffff', color: '#14181f', marginTop: 8,
  },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tabBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12, paddingVertical: 10, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  tabBtnActive: { backgroundColor: '#2563eb' },
  tabText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e3e6ec' },
  rankRowMe: { backgroundColor: '#dbeafe', borderRadius: 8, paddingHorizontal: 8 },
  rankNum: { width: 44, color: '#5c6572', fontSize: 15, fontWeight: '800' },
  rankName: { flex: 1, color: '#14181f', fontSize: 15 },
  rankScore: { color: '#14181f', fontSize: 15, fontWeight: '800' },
});
