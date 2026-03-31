---
name: neko-context
description: |
  Nekoさんのユーザープロフィール、開発環境、ワークフロー、プロジェクト構成のコンテキスト。
  全てのセッションで自動的に参照し、Nekoさんの好みと制約に沿った対応をするためのメモリ。
  このスキルはNekoさんとの会話が始まったとき、コード作業やプロジェクト関連の作業が発生したときに常に参照すること。
  タスクの進め方、提案の仕方、コミュニケーション言語の選択に影響する重要なコンテキストを含む。
---

# Neko ユーザーコンテキスト

## ユーザープロフィール

- **名前**: Neko (nekonokawase@gmail.com)
- **言語**: 日本語で全て返答する
- **コーディング能力**: コードを自分で書いたり読んだりしない。エージェント（Claude、Copilot等）に完全に委任する
- **意思決定スタイル**: 技術的な選択肢を提示すると的確に判断できる。推奨オプションを先に出すと喜ばれる
- **好み**: 自動化を強く好む。手動ステップは最小限にし、CI/CDやスクリプトで自動化する方向を常に提案する

## メインプロジェクト: Trader-Note-Build-Ai

トレーディングノート管理 + AI自動売買支援のデュアルシステムプラットフォーム。

### アーキテクチャ概要

| レイヤー | 技術 | 場所 |
|---------|------|------|
| フロントエンド | Next.js (App Router) + React 19 + Tailwind | Vercel (自動デプロイ) |
| バックエンドAPI | Express + TypeScript | GCP Cloud Run (asia-northeast1) |
| ORM | Prisma 6.x | 47テーブル |
| データベース | Supabase PostgreSQL | ap-northeast1, pgBouncer有効 |
| 分析エンジン | Python FastAPI + pandas_ta | GCP Cloud Run (別サービス) |
| CI/CD | GitHub Actions | ci.yml → deploy.yml 自動チェーン |
| シークレット管理 | GCP Secret Manager | DATABASE_URL, CRON_SECRET, AI_API_KEY 等 |
| スケジューラ | GCP Cloud Scheduler | 各種cronジョブ |

### GCPプロジェクト

- **プロジェクトID**: ai-note-486020
- **リージョン**: asia-northeast1 (東京)
- **Cloud Runサービス**: trader-note (API), trader-note-analysis-engine (Python)
- **Cloud Runジョブ**: trader-note-migrate (Prismaマイグレーション)
- **本番URL**: https://trader-note-571157808050.asia-northeast1.run.app

### Supabase

- **プロジェクトID**: rmsylwmqxyeqgplysqoa
- **テーブル数**: 47 (うち27は空 = 今後のフェーズ用)
- **RLS**: 現在無効 (技術的負債として認識済み)

### GitHub

- **リポジトリ**: https://github.com/NekoyaJolly/Trader-Note-Build-Ai
- **ブランチ戦略**: mainに直接push → CI自動実行 → デプロイ自動実行
- **CI/CD**: push to main → CI Pipeline (TypeCheck + Jest + E2E) → Production Deployment (Docker build → Cloud Run) → DB Migration (必要時) → 本番E2E

### Side-A / Side-B 構造

- **Side-A**: 手動トレードノートシステム。TradeNoteモデル、12次元特徴量ベクトル、NoteEvaluatorパターン
- **Side-B**: AI自動売買アシスタント。Research → Plan → VirtualTrade → AITradeNote のPDCAループ
- **マッチングパイプライン**: Side-A/Bの勝ちパターンを現在市場と照合 → 類似度が高い時に通知 (2026-04-01実装済み)

### 既存ドキュメント

- `docs/trader-note-feature-map.md` — 87機能の全体マップ
- `docs/trader-note-tech-debt-assessment.md` — 47件の技術的負債リスト
- `docs/matching-pipeline-architecture.md` — マッチング→通知パイプラインの設計図

## Cowork環境での制約

- **ネットワーク**: github.comのみプロキシ通過可能。GCP APIドメイン (*.googleapis.com) はブロック
- **gcloud CLI**: インストール不可（ダウンロード元もブロック）
- **GitHubへのpush**: tokenをURL埋め込みで `/tmp/` にfresh cloneしてpushする方式で成功実績あり
- **MCP接続済みサービス**: Supabase（SQL直接実行可）、GCP Compute Engine（VMのみ）、Vercel、Figma、Canva
- **回避策**: GCP操作が必要な場合はGitHub Actionsに組み込んでpushで自動実行する

## ワークフローの好み

1. **提案時**: 選択肢を出す場合、推奨オプションに「(推奨)」を付けて最初に提示
2. **コードの説明**: 実装後に「何をしたか」「なぜそうしたか」を日本語で簡潔にまとめる
3. **デプロイ**: 手動ステップを避け、可能な限りCI/CDに組み込む
4. **Git操作**: mainに直接push。PR不要（個人プロジェクト）
5. **エラー対応**: 問題が起きたら代替手段を即座に試す。長く悩まない
