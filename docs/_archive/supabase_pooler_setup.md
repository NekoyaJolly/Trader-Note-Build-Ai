# Supabase プーラー接続設定ガイド

> **背景**: 直接接続（port 5432）だと Cloud Run + Prisma で DB 接続枯渇（60接続上限）が発生する。Transaction モード（port 6543）を使用して接続を効率化する。

---

## なぜプーラーでエラーが出たか（推測）

過去にプーラー接続でエラーが出ていた場合、主な原因は以下と考えられる：

1. **`pgbouncer=true` の未設定**  
   Transaction モードは prepared statements をサポートしていない。Prisma はデフォルトで prepared statements を使うため、`?pgbouncer=true` を付ける必要がある。

2. **Session モード（5432）と Transaction モード（6543）の混同**  
   Session モードは接続を長時間保持するため、サーバーレスでは不向き。Cloud Run では Transaction モードを使う。

---

## 正しい設定

### 接続文字列の対応

| 用途 | 接続先 | ポート | パラメータ |
|------|--------|--------|------------|
| **アプリ実行** (DATABASE_URL) | Transaction モード | 6543 | `?pgbouncer=true` |
| **マイグレーション** (DIRECT_URL) | 直接接続 | 5432 | なし |

### DATABASE_URL（Transaction モード）

```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true
```

- ホストは直接接続と同じ `db.xxx.supabase.co`
- **ポートを 5432 → 6543 に変更**
- **`?pgbouncer=true` を付与**（Prisma の prepared statements を無効化）

### DIRECT_URL（直接接続・マイグレーション用）

```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

- そのまま変更なし（`prisma migrate` は直接接続必須）

---

## 参考文献

- [Supabase: Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) - Transaction mode
- [Supabase: Prisma troubleshooting](https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting) - pgbouncer=true
- [supavisor Prisma](https://supabase.github.io/supavisor/orms/prisma/) - Named Prepared Statements の無効化
