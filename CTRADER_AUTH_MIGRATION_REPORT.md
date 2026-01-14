# cTrader統合認証移行 - 実装レポート

**日付**: 2026-01-14  
**ブランチ**: `copilot/migrate-to-ctrader-oauth`  
**ステータス**: フェーズ1〜4完了（70%完了）

---

## 完了した実装

### ✅ フェーズ1: Prismaスキーマ更新

**変更内容:**
- `User` テーブルから `email`, `passwordHash`, `refreshToken` フィールドを削除
- `User` テーブルに `primaryAccountId` フィールドを追加（cTraderアカウントIDを保存）
- `CTraderToken` テーブルに `userId` 外部キーを追加
- 1ユーザー : N cTraderアカウントの関係を確立

**マイグレーションファイル:**
- `prisma/migrations/20260114050906_ctrader_only_auth/migration.sql`
- 既存ユーザーデータをクリアするSQLスクリプトを含む
- ⚠️ **注意**: マイグレーション実行時は既存ユーザーデータが削除されます

### ✅ フェーズ2: バックエンド認証サービス

**新規ファイル:**
- `src/backend/services/auth/sessionService.ts`
  - JWT生成・検証
  - Cookie設定・削除
  - セッション管理の一元化

**更新ファイル:**
- `src/backend/services/ctrader/ctraderAuthService.ts`
  - `exchangeCodeAndLogin()` メソッド追加
  - 認証コード→トークン交換
  - ユーザー自動作成（新規登録時）
  - JWT発行
  - `AuthResult` インターフェース定義

### ✅ フェーズ3: APIエンドポイント

**更新エンドポイント:**
- `POST /api/auth/ctrader/callback` - OAuth認証完了後の処理
  - codeを受け取り、トークン交換
  - User自動作成（初回ログイン時）
  - JWT発行とCookie設定
  - ユーザー情報を返却

**新規エンドポイント:**
- `GET /api/auth/me` - ログインユーザー情報取得
  - Cookie または Authorization ヘッダーからJWTを検証
  - ユーザー情報 + cTraderアカウント一覧を返却

- `POST /api/auth/logout` - ログアウト
  - Cookie削除
  - セッション無効化

**ミドルウェア更新:**
- `src/middleware/authMiddleware.ts`
  - Cookie からのJWT取得に対応
  - Bearer token との併用サポート
  - SessionService を使用した検証

**Express設定:**
- `src/app.ts`
  - `cookie-parser` ミドルウェア追加
  - CORS設定に `credentials: true` を確認

### ✅ フェーズ4: フロントエンド認証

**新規ファイル:**
- `src/frontend/contexts/AuthContext.tsx`
  - React Context によるグローバル認証状態管理
  - `useAuth` カスタムフック
  - `login()`, `logout()`, `refreshUser()` メソッド
  - 自動ユーザー情報取得（初回ロード時）

- `src/frontend/app/login/page.tsx`
  - cTrader OAuth専用ログインページ
  - 美しいUI（グラデーション、アニメーション）
  - OAuth認証フロー説明
  - セキュリティ情報表示

**更新ファイル:**
- `src/frontend/app/layout.tsx`
  - `AuthProvider` でアプリ全体をラップ
  - 全ページで認証状態にアクセス可能

- `src/frontend/app/auth/ctrader/callback/page.tsx`
  - `/api/auth/ctrader/callback` エンドポイント呼び出し
  - Cookie 受け取り対応（`credentials: 'include'`）
  - 成功時は `/` にリダイレクト
  - 失敗時は `/login` にリダイレクト

---

## 未完了タスク（残り30%）

### 🔲 フェーズ3: APIエンドポイント削除（残タスク）

以下の旧認証エンドポイントを削除する必要があります:

**削除対象:**
- `POST /api/auth/register` - email/password登録（廃止）
- `POST /api/auth/login` - email/passwordログイン（廃止）
- `PUT /api/auth/password` - パスワード変更（廃止）
- `POST /api/auth/refresh` - リフレッシュトークン（廃止）

**ファイル:**
- `src/routes/authRoutes.ts` - 旧認証ルート（削除推奨）
- `src/backend/services/authService.ts` - 旧AuthService（削除推奨）

### 🔲 フェーズ4: ProtectedRoute実装

**必要な実装:**
- `src/frontend/components/ProtectedRoute.tsx` の作成
- 未認証時に `/login` へリダイレクト
- ローディング中の表示
- 使用例:
  ```tsx
  export default function DashboardPage() {
    return (
      <ProtectedRoute>
        <div>ダッシュボードコンテンツ</div>
      </ProtectedRoute>
    );
  }
  ```

### 🔲 フェーズ5: マルチアカウント対応

**未実装機能:**
- ユーザーダッシュボードでのcTraderアカウント一覧表示
  - GET /api/auth/me のレスポンスに含まれる `ctraderAccounts` を表示
  - アカウントごとの有効期限表示
  - アカウント削除機能

- 複数アカウント追加機能
  - 既存ユーザーが別のcTraderアカウントを追加
  - 同一 `userId` に複数 `CTraderToken` を紐付け

- プライマリアカウント選択
  - `User.primaryAccountId` の変更機能
  - リアルタイム接続で使用するアカウントの選択

### 🔲 フェーズ6: リアルタイムチャート統合

**必要な変更:**
- `src/infrastructure/market/CTraderProvider.ts` の更新
  - グローバルトークン取得から、ユーザーごとのトークン取得に変更
  - AuthContext からユーザー情報を取得
  - `userId` に紐付いた `primaryAccountId` のトークンを使用

- ログイン完了時の自動接続
  - `/` ページで `useEffect` によりリアルタイム接続を開始
  - 認証済みユーザーのみ接続を許可

### 🔲 フェーズ7: テスト・検証

**テスト項目:**
1. ログインフロー
   - `/login` → cTrader認証 → Callback → `/` リダイレクト
   - 初回ログイン時のUser自動作成
   - 2回目以降のログイン

2. セッション管理
   - Cookie の有効期限（7日間）
   - ページリロード時のセッション維持
   - ログアウト後のアクセス制限

3. マイグレーション
   - 既存Userデータの削除
   - 外部キー制約の確認
   - Prisma Client の再生成

4. 既存機能との互換性
   - トレードノート機能
   - リアルタイム通知
   - バックテスト機能

### 🔲 フェーズ8: ドキュメント更新

**更新対象:**
- `README.md`
  - cTrader認証のみの説明
  - セットアップ手順の更新
  - 環境変数の説明（JWT_SECRET追加）

- `AGENTS.md`
  - 認証フロー図の更新
  - 旧認証方式の削除

- `docs/API.md`
  - 新しい認証エンドポイントの説明
  - `/me`, `/logout` の仕様
  - Cookie認証の説明

---

## 実行手順（次のステップ）

### 1. マイグレーション実行

```bash
# 1. Prisma Client を生成
cd /home/runner/work/Trader-Note-Build-Ai/Trader-Note-Build-Ai
npx prisma generate

# 2. マイグレーション実行（既存データを削除）
npx prisma migrate deploy

# 3. データベース確認
npx prisma studio
```

### 2. ビルド確認

```bash
# バックエンドビルド
npm run build:backend

# フロントエンドビルド
cd src/frontend && npm run build
```

### 3. 動作確認

```bash
# 開発サーバー起動
npm run dev

# テスト
# 1. http://localhost:3102/login にアクセス
# 2. 「cTraderでログイン」をクリック
# 3. cTrader認証後、コールバックされることを確認
# 4. `/` ページにリダイレクトされることを確認
# 5. `/api/auth/me` でユーザー情報が取得できることを確認
```

### 4. 環境変数確認

`.env` ファイルに以下が設定されていることを確認:

```env
# JWT設定（本番環境では必ず変更）
JWT_SECRET=your-strong-secret-key-minimum-32-characters

# cTrader OAuth設定
CTRADER_CLIENT_ID=your_client_id
CTRADER_CLIENT_SECRET=your_client_secret
CTRADER_REDIRECT_URI=http://localhost:3102/auth/ctrader/callback
```

---

## 既知の問題・注意点

### ⚠️ 重要: データ消失

- このマイグレーションは **既存ユーザーデータをすべて削除** します
- 本番環境で実行する前に、必ずバックアップを取得してください
- 開発環境でのテスト実行を推奨します

### 🔧 設定必須項目

1. **JWT_SECRET**: 必ず32文字以上の強力な秘密鍵を設定
2. **cTrader OAuth**: cTrader Open API での登録が必要
3. **Cookie Domain**: 本番環境ではドメイン設定が必要な場合があります

### 🚀 パフォーマンス

- JWT有効期限: 7日間（長めに設定）
- Cookie: httpOnly, secure（本番）, sameSite=lax
- セッション管理: ステートレス（DBへのアクセス不要）

---

## 技術スタック

- **認証方式**: OAuth 2.0（cTrader）
- **セッション管理**: JWT（Cookie ベース）
- **Cookie ライブラリ**: cookie-parser
- **バリデーション**: Zod
- **ORM**: Prisma
- **フロントエンド**: Next.js 15 App Router
- **状態管理**: React Context API

---

## 参考リソース

- [cTrader Open API ドキュメント](https://openapi.ctrader.com/)
- [Prisma マイグレーションガイド](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Next.js Authentication](https://nextjs.org/docs/app/building-your-application/authentication)

---

**最終更新**: 2026-01-14  
**作成者**: GitHub Copilot  
**レビュアー**: @NekoyaJolly
