# 実装レポート: GCP + Prisma ベストプラクティス

## 目的
- 本番マイグレーションを Cloud Run Jobs に分離
- Service の安定稼働を優先

## 実施内容
- Dockerfile を再作成（prisma/同梱、CMDでmigrateしない）
- Cloud Run Job 作成スクリプトを追加（PowerShell/Bash）
- デプロイ手順書を追加

## 設計判断
- Prisma 公式推奨の `migrate deploy` を採用
- 競合回避のため Job 分離

## 今後の運用
- スキーマ変更は `prisma migrate dev` で生成
- 本番反映は Cloud Run Job で `migrate deploy`

## 参照
- Prisma Deploy to production
- Google Cloud Cloud Run Jobs
