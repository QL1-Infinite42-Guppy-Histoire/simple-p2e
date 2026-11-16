# 簡素版P2E（QOM報酬）— Phase 1

スキル勝負のスタック積み上げゲーム。スコアがそのままポイントになり、
貯まったポイントを QOM（QL1）に交換する想定のプロジェクトです。
設計の正は [DESIGN.md](./DESIGN.md)。M2E歩数アプリとは別物です。

**Phase 1 の範囲**: 共有シミュレーション＋サーバー＋アプリをローカルで
一巡させるところまで。**払い出しは無効**（鍵なし・レート未決定）。

**Phase 2a (2026-11-17)**: GitHub リポジトリ公開＋サーバーを XServer VPS
へデプロイ済み（M2E とは別サービス・別 DB・ポート 8788、公開 URL は
Tailscale Funnel の `https://vps-2026-11-12-16-49-27.tail303bfa.ts.net:8443`）。
検証用 APK v0.1.0 を GitHub Release で配布。**払い出しは引き続き無効**です。

## ⚠️ 数値はすべて「仮値・未決定」

ゲームの係数、1日の回数・獲得上限、保留期間など、コード内にある数字は
すべてテスト用の暫定値です（`shared/sim.js` の `GAME_CONFIG` と
`server/src/config.js` に集約し、コメントで明示）。
**pt→QOM レートは未決定のため `null`（払い出し不可）** です。
アプリ名も「スタックP2E（仮称）」という仮称です。

## 構成

```
shared/   純粋JSの決定的シミュレーション。アプリとサーバーが同一物を import
  sim.js    三角波の位置関数 / PERFECT・切り落とし・ゲームオーバー / スコア計算
  test/     sim のユニットテスト
server/   Node + SQLite (依存ゼロ、Node 24 組み込みのみ)
  src/app.js    API 本体 (登録 / play start・submit / ランキング / 台帳 / 管理)
  src/payout.js 払い出しモジュール骨組み (Phase 1 では常に無効を返す)
  schema.sql    accounts / ledger(append-only) / play_sessions / play_results / daily_bests
app/      Expo / React Native (Android)。土台は M2E アプリと同じ形
  src/api.ts        サーバー接続 (端末トークンは SecureStore)
  src/gameLogic.ts  共有 sim の再 export + シェア文・順位差分の純粋ロジック
  src/screens/      Play / Ranking / History / Settings
```

## スコア検証（リプレイ検証）

クライアントは **タップ時刻列だけ** を送ります。サーバーが
`shared/sim.js` で再計算したスコアを正式スコアとし、自己申告スコアは
無視します（サーバーの統合テストで、偽の申告スコア 999,999,999 を
送っても再計算値だけが記録されることを確認済み）。
ブロック位置は経過時間の決定的関数なので、通信遅延は無関係です。

## 動かし方

```bash
# テスト全部 (sim 10件 / server 13件 / app 7件)
npm test

# サーバー起動 (http://127.0.0.1:8788、DB は server/data/)
cd server && ADMIN_SECRET=<任意の長い文字列> node src/main.js

# アプリ (依存インストール後)
cd app && npm install && npx expo start
# app.json の extra.apiBaseUrl が接続先。既定は http://127.0.0.1:8788
# (プレースホルダ)。実機では PC の LAN アドレス等に差し替える。
# サーバーに届かない場合は端末内だけの仮登録モードで起動する。
```

## Phase 2 以降

- ✅ GitHub リポジトリ作成と CI での APK ビルド（Phase 2a）
- ✅ VPS へのデプロイ（M2E とは別サービス・別 DB で同居。手順は `server/deploy/`）
- 払い出しの有効化（配布ウォレット準備・レート決定が前提。ユーザー側作業）
- 数値の本決定（ゲーム係数・上限・保留期間・pt→QOM レート。プレイしてから決める）
