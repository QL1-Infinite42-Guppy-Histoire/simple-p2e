import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// API の接続先は app.json の extra.apiBaseUrl で変える。
// いまの値は localhost のプレースホルダ (Phase 1 のローカル確認用)。
// 実機で試すときは、PC の LAN アドレスや公開 URL に差し替えること。
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ?? '';

const KEY_SESSION = 'p2e_session';
const KEY_ACCOUNT_ID = 'p2e_account_id';
const KEY_RECOVERY_CODE = 'p2e_recovery_code';

export interface Balances {
  total: number;
  pending: number;
  confirmed: number;
}

export interface RankingEntry {
  rank: number;
  accountId: string;
  label: string;
  score: number;
}

export interface RankingView {
  totalPlayers: number;
  top: RankingEntry[];
  me: RankingEntry | null;
  above: RankingEntry | null;
  below: RankingEntry | null;
  pointsToNextRank: number | null;
}

export interface MeResponse {
  accountId: string;
  label: string;
  balances: Balances;
  attemptsLeftToday?: number | null; // null = 無制限
  todayBest: number;
  todayEarned: number;
  ranking: RankingView;
  payoutAddress: string | null;
  payoutEnabled: boolean;
  payoutReason: string;
  seasonNotice?: string | null; // サーバーからの告知 (試行シーズン等)
}

export interface SubmitResponse {
  verifiedScore: number;
  floors: number;
  perfects: number;
  maxCombo: number;
  gameOver: boolean;
  isDailyBest: boolean;
  dailyBest: number;
  pointsEarned: number;
  ranking: RankingView;
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_SESSION);
}
export async function getStoredAccountId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_ACCOUNT_ID);
}
export async function getStoredRecoveryCode(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_RECOVERY_CODE);
}

// 端末登録。サーバーに届かない場合は端末内だけの仮登録に切り替える
// (ローカルモード: 遊べるが、スコアはサーバー未検証・仮表示)。
export async function ensureDeviceRegistration(): Promise<{ accountId: string; localOnly: boolean }> {
  const existing = await getStoredToken();
  const existingId = await getStoredAccountId();
  if (existing && existingId && !existing.startsWith('local.')) {
    return { accountId: existingId, localOnly: false };
  }
  if (existing && existingId && existing.startsWith('local.')) {
    // 仮登録のままサーバーに再挑戦する (届けば正式登録に置き換わる)
    try {
      return await registerWithServer();
    } catch {
      return { accountId: existingId, localOnly: true };
    }
  }
  try {
    return await registerWithServer();
  } catch {
    const localId = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY_SESSION, `local.${localId}`);
    await SecureStore.setItemAsync(KEY_ACCOUNT_ID, localId);
    return { accountId: localId, localOnly: true };
  }
}

async function registerWithServer(): Promise<{ accountId: string; localOnly: boolean }> {
  const res = await fetch(`${API_BASE_URL}/register`, { method: 'POST' });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const data = (await res.json()) as { accountId: string; deviceToken: string; recoveryCode: string };
  await SecureStore.setItemAsync(KEY_SESSION, data.deviceToken);
  await SecureStore.setItemAsync(KEY_ACCOUNT_ID, data.accountId);
  await SecureStore.setItemAsync(KEY_RECOVERY_CODE, data.recoveryCode);
  return { accountId: data.accountId, localOnly: false };
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getStoredToken();
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-device-token': token ?? '', ...(init?.headers ?? {}) },
  });
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await authedFetch('/me');
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  return res.json();
}

export async function playStart(): Promise<{
  sessionId: string;
  seed: number;
  dateJst: string;
  expiresAt: number;
  attemptsLeft: number | null; // null = 無制限 (β期間中)
}> {
  const res = await authedFetch('/play/start', { method: 'POST' });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `play/start failed: ${res.status}`);
  }
  return res.json();
}

// 送るのはタップ時刻列だけ。スコアは送らない (サーバーが再計算する)。
export async function playSubmit(sessionId: string, tapTimesMs: number[]): Promise<SubmitResponse> {
  const res = await authedFetch('/play/submit', {
    method: 'POST',
    body: JSON.stringify({ sessionId, tapTimesMs }),
  });
  if (!res.ok) throw new Error(`play/submit failed: ${res.status}`);
  return res.json();
}

export interface PoolStats {
  zapDecimals: number;
  seasonStartJst: string;
  seasonRewardPoolZap: string;
  totalBurnedZap: string;
}

// 報酬プールとバーン総数の公開表示 (サーバーの実績集計のみ。捏造なし)
export async function fetchStats(): Promise<PoolStats> {
  const res = await fetch(`${API_BASE_URL}/stats`);
  if (!res.ok) throw new Error(`stats failed: ${res.status}`);
  return res.json();
}

export async function fetchRanking(kind: 'daily' | 'season'): Promise<RankingView & { dateJst?: string; seasonStartJst?: string }> {
  const res = await authedFetch(`/ranking/${kind}`);
  if (!res.ok) throw new Error(`ranking failed: ${res.status}`);
  return res.json();
}

export async function fetchHistory(): Promise<{
  history: { id: number; type: string; pointsDelta: number; memo: string | null; createdAt: number }[];
}> {
  const res = await authedFetch('/me/history');
  if (!res.ok) throw new Error(`history failed: ${res.status}`);
  return res.json();
}

export async function fetchPayouts(): Promise<{ payouts: unknown[]; payoutEnabled: boolean; reason: string; note: string }> {
  const res = await authedFetch('/me/payouts');
  if (!res.ok) throw new Error(`payouts failed: ${res.status}`);
  return res.json();
}

export async function setPayoutAddress(address: string): Promise<void> {
  const res = await authedFetch('/me/address', { method: 'POST', body: JSON.stringify({ address }) });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `address failed: ${res.status}`);
  }
}
