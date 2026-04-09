---
name: project-context
description: |
  Trader-Note-Build-Ai プロジェクトの技術スタック、アーキテクチャ、デプロイ構成、DB構造の詳細コンテキスト。
  このプロジェクトでコード変更、DB操作、デプロイ、設計判断をする際に必ず参照すること。
  Supabase、GCP Cloud Run、GitHub Actions CI/CD の構成情報を含む。
---

# Trader-Note-Build-Ai プロジェクトコンテキスト

## プロジェクト概要

トレーディングノート管理 + AI自動売買支援のデュアルシステムプラットフォーム。
Side-A（手動トレードノート）と Side-B（AIトレードアシスタント）の2系統で構成。

- **リポジトリ**: https://github.com/NekoyaJolly/Trader-Note-Build-Ai
- **本番API**: https://trader-note-571157808050.asia-northeast1.run.app

## 技術スタック

| レイヤー | 技術 | バージョン/詳細 |
|---------|------|---------------|
| フロントエンド | Next.js (App Router) + React 19 + Tailwind | 31ページ, 51コンポーネント |
| バックエンドAPI | Express + TypeScript | Node 22, 110+エンドポイント |
| ORM | Prisma | 6.x, 47テーブル, 22マイグレーション |
| データベース | Supabase PostgreSQL | pgBouncer有効, ポート6543 |
| 分析エンジン | Python FastAPI + pandas_ta | 別Cloud Runサービス |
| ジョブキュー | BullMQ | Redis不要（インプロセス） |
| WebSocket | ws | リアルタイムtickデータ |
| MCP | @modelcontextprotocol/sdk | AI連携 |

## GCP構成

- **プロジェクトID**: ai-note-486020
- **リージョン**: asia-northeast1 (東京)
- **Cloud Run サービス**:
  - `trader-note` — メインAPI (Express)
  - `trader-note-analysis-engine` — 分析エンジン (FastAPI)
- **Cloud Run ジョブ**: `trader-note-migrate` — Prismaマイグレーション
- **Cloud Scheduler**:
  - `matching-pipeline-15min` — マッチングパイプライン（15分間隔）
  - 各種Side-B cronジョブ
- **Secret Manager**: DATABASE_URL, CRON_SECRET, AI_API_KEY, VAPID_*, CTRADER_* 等
- **コンテナ**: `gcr.io/ai-note-486020/trader-note:latest`

## Supabase

- **プロジェクトID**: rmsylwmqxyeqgplysqoa
- **テーブル数**: 47（うち27は空テーブル = 今後のフェーズ用）
- **RLS**: 全テーブルで有効（2026-04-09 適用済み。ポリシーなし = anon/authenticated はデフォルト拒否、service_role はバイパス）
- **接続**: pgBouncer Transaction Mode (ポート6543)

## CI/CD パイプライン

```
push to main
  → CI Pipeline (ci.yml)
    → Lint & TypeCheck
    → Unit & Integration Tests (Jest)
    → E2E Tests (Playwright)
  → Production Deployment (deploy.yml) ※CI成功後に自動トリガー
    → analysis-engine デプロイ
    → メインAPI デプロイ
    → DBマイグレーション（prisma/変更時のみ）
    → 本番E2E テスト
    → Cloud Scheduler セットアップ
```

## プロジェクト構造（主要ディレクトリ）

```
src/
├── backend/          # Side-A: API, services, repositories
├── frontend/         # Next.js (app router)
├── side-b/           # AI自動売買: agent, PDCA loop, scheduler
├── services/         # 共通サービス（matching, notification, realtime）
├── domain/           # ドメインロジック（matching/, notification/）
├── backend/api/      # Express ルート（21モジュール、全ルート統一配置）
├── backend/controllers/ # コントローラー（ルートから参照）
├── models/           # TypeScript 型定義
└── config/           # 設定
analysis-engine/      # Python FastAPI
prisma/               # スキーマ + マイグレーション
docs/                 # アーキテクチャドキュメント
```

## Side-A / Side-B

### Side-A（手動トレードノート）
- `TradeNote` モデル: 12次元特徴量ベクトル（featureVector）
- `NoteEvaluator` パターン: ノートが評価の主語
- `LegacyNoteEvaluator`: 12次元コサイン類似度
- `UserIndicatorNoteEvaluator`: ユーザー定義インジケーター（将来）

### Side-B（AI自動売買アシスタント）
- PDCAループ: Research → Plan → VirtualTrade → AITradeNote
- 現在のデータ: 36 research, 33 plans, 114 trades, 64 notes
- 勝ちパターン: 12件（long 8, short 4）XAU/USD
- `SideBNoteEvaluator`: 8次元条件ベクトル（regime, volatility, trend, keyLevels）

### マッチング→通知パイプライン（2026-04-01実装）
- `MatchingService.runMatchingPipeline()`: Side-A/B統合
- `SideBMatchingAdapter`: 勝ちノート読込 → Evaluator生成
- `NotificationTriggerService`: 閾値≥0.75, クールダウン1h, 24h上限30件
- Cron: `GET /api/cron/matching-pipeline`（15分間隔）

## 既存ドキュメント

| ファイル | 内容 |
|---------|------|
| `docs/trader-note-feature-map.md` | 87機能の全体マップ（8ドメイン） |
| `docs/trader-note-tech-debt-assessment.md` | 47件の技術的負債（スコア付き） |
| `docs/matching-pipeline-architecture.md` | マッチング→通知の設計図 |
| `AGENTS.md` | プロジェクト方針・設計思想 |
| `docs/supabase_pooler_setup.md` | DB接続設定 |
| `docs/GCP_PRISMA_BEST_PRACTICES.md` | Prisma + GCP のベストプラクティス |

## 技術的負債（残存）

1. 27空テーブル（D2, 25pt）— 未使用フェーズのテーブル。実害なし、後回しOK
2. 30+ 環境変数の整理不足（I2, 28pt）

### 解消済み（2026-04-09）
- ~~全テーブル RLS 無効（D1, 32pt）~~ → 全48テーブルで RLS 有効化済み
- ~~ルート分散（A2, 24pt）~~ → `src/backend/api/` に統一済み
