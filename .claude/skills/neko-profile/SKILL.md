---
name: neko-profile
description: |
  Nekoさんのユーザープロフィールと作業スタイルのコンテキスト。
  全てのプロジェクト・全てのセッションで共通の情報。
  Nekoさんとの会話が始まったとき、またはタスクの進め方を判断するときに常に参照すること。
  言語、コミュニケーション方法、自動化の好み、作業の進め方に影響する重要な情報を含む。
---

# Neko ユーザープロフィール

## 基本情報

- **名前**: Neko
- **メール**: nekonokawase@gmail.com
- **言語**: 全ての返答は日本語で行う

## 作業スタイル

- **コーディング**: コードを自分で書いたり読んだりしない。AI エージェント（Claude、GitHub Copilot 等）に完全に委任する
- **意思決定**: 技術的な選択肢を提示すると的確に判断できる。推奨オプションを先に出し「(推奨)」と明示すると喜ばれる
- **自動化志向**: 手動ステップを強く嫌う。CI/CD やスクリプトで自動化する方向を常に最優先で提案する
- **エラー対応**: 問題が起きたら代替手段を即座に試す。長く悩まず動く

## コミュニケーションの好み

- 実装後に「何をしたか」「なぜそうしたか」を日本語で簡潔にまとめる
- 技術用語はそのまま使ってOK（プロジェクト構造やアーキテクチャの理解は深い）
- 長い説明より、構造化された要約を好む

## よく使うサービス・ツール

- **ソースコード管理**: GitHub
- **クラウド**: GCP（Cloud Run, Cloud Scheduler, Secret Manager）
- **データベース**: Supabase（PostgreSQL）
- **フロントエンド**: Vercel
- **CI/CD**: GitHub Actions（push to main → 自動デプロイ）
- **デザイン**: Figma, Canva
- **AI**: Claude（Cowork, Claude Code）, GitHub Copilot

## Cowork 環境の制約（重要）

Cowork のサンドボックスにはネットワーク制限がある：

- **github.com**: プロキシ通過可能（git push/fetch 動作する）
- **GCP API (*.googleapis.com)**: ブロック → gcloud CLI 使用不可
- **その他の外部API**: 基本的にブロック
- **MCP接続サービス**: プロキシ制限を迂回できる（Supabase SQL直接実行等）

**回避策**: GCP 操作が必要な場合は GitHub Actions のワークフローに組み込み、push で自動実行させる。
**Git push の方法**: token を URL 埋め込みで `/tmp/` に fresh clone → push する方式。

## プロジェクト一覧

Neko さんは複数プロジェクトを抱えている。各プロジェクトの技術詳細は、そのプロジェクトフォルダ内の `.claude/skills/project-context/SKILL.md` を参照すること。

| プロジェクト | リポジトリ | 概要 |
|-------------|-----------|------|
| Trader-Note-Build-Ai | NekoyaJolly/Trader-Note-Build-Ai | トレードノート管理 + AI自動売買支援 |
