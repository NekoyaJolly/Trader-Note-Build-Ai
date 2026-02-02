# GCP + Prisma 本番運用ベストプラクティス

> **目的**: Prisma の本番マイグレーションを安全に運用するためのガイド

---

## ✅ 推奨アーキテクチャ（Cloud Run Jobs 分離）

```
開発(ローカル) → Gitにマイグレーションを追加
          ↓
Cloud Build でイメージ作成（prisma/同梱）
          ↓
Cloud Run Job で migrate deploy
          ↓
Cloud Run Service でアプリ実行
```

### 理由
- **Prisma 公式**: 本番は `migrate deploy` を推奨
- **Google Cloud 公式**: 管理コマンドを Job に分離
- 複数インスタンス同時起動による競合を回避

---

## ❌ NG パターン

- Service の起動時に `migrate deploy` を実行
- ローカルから本番DBへ直接マイグレーション

---

## ✅ 正しい Dockerfile ポイント

- `prisma/` を必ず同梱
- `CMD` にマイグレーションを含めない

---

## ✅ 環境変数の扱い

- Secret Manager に登録
- Service/Job は `--update-secrets` / `--set-secrets` を使用

---

## 参考
- Prisma: Deploy to production
- Google Cloud: Running database migrations with Cloud Run Jobs
