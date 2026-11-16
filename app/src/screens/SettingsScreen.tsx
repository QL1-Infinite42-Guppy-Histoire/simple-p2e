import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { API_BASE_URL, setPayoutAddress } from '../api';
import { CardLabel, GlassCard, PrimaryButton, styles } from '../ui';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export default function SettingsScreen({
  accountId,
  recoveryCode,
  payoutAddress,
  localOnly,
  onAddressSaved,
}: {
  accountId: string | null;
  recoveryCode: string | null;
  payoutAddress: string | null;
  localOnly: boolean;
  onAddressSaved: (address: string) => void;
}) {
  const [address, setAddress] = useState(payoutAddress ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setMessage(null);
    setError(null);
    if (!ADDRESS_RE.test(address.trim())) {
      setError('アドレスの形が違います。「0x」から始まる42文字で入力してください。');
      return;
    }
    try {
      await setPayoutAddress(address.trim());
      onAddressSaved(address.trim());
      setMessage('受け取りアドレスを保存しました。');
    } catch (e) {
      setError(`保存できませんでした: ${String((e as Error)?.message || e)}`);
    }
  };

  return (
    <>
      <GlassCard>
        <CardLabel>QOMの受け取りアドレス</CardLabel>
        <Text style={styles.note}>
          QOMを受け取る QL1 のアドレスを登録します。GuppyWallet などのウォレットで作ったアドレスを使ってください。
        </Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="0x…"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!localOnly}
        />
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <PrimaryButton title="アドレスを保存する" onPress={() => void save()} disabled={localOnly} />
        {localOnly ? <Text style={styles.note}>サーバー未接続のため、いまは保存できません。</Text> : null}
      </GlassCard>

      <GlassCard>
        <CardLabel>アカウント</CardLabel>
        {accountId ? <Text style={styles.mono}>ID: {accountId.slice(0, 8)}…</Text> : null}
        {recoveryCode ? (
          <Text style={styles.note}>
            復旧コード: {recoveryCode}
            {'\n'}機種変更のときに必要です。メモしておいてください。
          </Text>
        ) : (
          <Text style={styles.note}>復旧コードは登録時に表示されます。</Text>
        )}
        <PrimaryButton title="アカウントを削除する（準備中）" disabled />
        <Text style={styles.note}>削除機能は準備中です。公開までに使えるようにします。</Text>
      </GlassCard>

      <GlassCard>
        <CardLabel>正直な注意書き</CardLabel>
        <Text style={styles.note}>・ポイントは遊んだ分の小さなごほうびです。お金が稼げるものではありません。</Text>
        <Text style={styles.note}>・QOMは暗号資産で、価格が変動します。受け取ったあとの値段は保証されません。</Text>
        <Text style={styles.note}>・スコアはサーバーで再計算して確認しています。端末で表示される数字と違う場合は、サーバーの数字が正しいものです。</Text>
        <Text style={styles.note}>・いまは検証版です。ポイントとQOMの交換レートはまだ決まっていません。</Text>
        <Text style={styles.mono}>接続先: {API_BASE_URL || '(未設定)'}</Text>
      </GlassCard>
    </>
  );
}
