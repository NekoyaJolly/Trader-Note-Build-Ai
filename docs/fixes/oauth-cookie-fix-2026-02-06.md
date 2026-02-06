# cTrader OAuth認証 Cookie設定修正

## 日付: 2026年2月6日

## 問題の概要

cTrader OAuth認証フローにおいて、ユーザーがcTraderアカウントでログインに成功しても、アプリケーションにリダイレクトされた際にログインエラーが発生し、ログインページに戻されるという問題が発生していました。

## 根本原因

`src/backend/services/auth/sessionService.ts` において、Cookie設定が環境に関わらず常に以下のように設定されていました：

```typescript
res.cookie('auth_token', token, {
  httpOnly: true,
  secure: true,      // ← 常にHTTPS必須
  sameSite: 'none',  // ← クロスサイトリクエスト対応
  maxAge: ...,
  path: '/',
});
```

### なぜこれが問題だったのか

1. **開発環境（localhost）での問題**
   - `secure: true` は Cookie を HTTPS 接続でのみ送信可能にする
   - localhost は通常 HTTP で動作するため、ブラウザは Cookie を送信しない
   - 結果として、認証後に `/api/auth/me` を呼び出してもCookieが送信されず、401エラーが発生

2. **本番環境でのクロスドメイン問題**
   - フロントエンド（Vercel）とバックエンド（Railway）が異なるドメイン
   - `sameSite: 'none'` は `secure: true` との組み合わせが必須
   - しかし、開発環境では機能しない

## 修正内容

### 1. sessionService.ts の修正

環境変数 `NODE_ENV` に基づいてCookie設定を動的に変更するように修正：

```typescript
// 本番環境かどうかを判定
const isProduction = process.env.NODE_ENV === 'production';

setTokenCookie(res: Response, token: string): void {
  // 開発環境では secure: false, sameSite: 'lax'
  // 本番環境では secure: true, sameSite: 'none'（クロスドメイン対応）
  const cookieOptions = {
    httpOnly: true, // XSS 対策
    secure: isProduction, // 本番環境のみ HTTPS 必須
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000,
    path: '/',
  };

  console.log('[SessionService] Cookie設定:', {
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
    environment: isProduction ? '本番' : '開発',
  });

  res.cookie('auth_token', token, cookieOptions);
}
```

### 2. デバッグログの追加

以下のファイルにデバッグログを追加して、問題の追跡を容易にしました：

- `src/backend/api/ctraderAuthRoutes.ts`
  - `/api/auth/ctrader/callback` エンドポイント
  - `/api/auth/me` エンドポイント
- `src/frontend/app/auth/ctrader/callback/page.tsx`

## 環境別の動作

### 開発環境（localhost）
- `NODE_ENV=development`
- Cookie設定: `secure: false`, `sameSite: 'lax'`
- HTTP接続でもCookieが正常に送受信される

### 本番環境（Railway/Vercel）
- `NODE_ENV=production`
- Cookie設定: `secure: true`, `sameSite: 'none'`
- HTTPS接続でクロスドメインでもCookieが送信される

## テスト手順

### 開発環境でのテスト

1. `.env` ファイルに `NODE_ENV=development` を設定
2. バックエンドを起動: `npm run dev:backend`
3. フロントエンドを起動: `npm run dev:frontend`
4. ブラウザで `http://localhost:3102/login` にアクセス
5. cTraderログインボタンをクリック
6. cTraderアカウントでログイン
7. コールバック後にダッシュボードにリダイレクトされることを確認
8. ブラウザの開発者ツール → Application → Cookies で `auth_token` が設定されていることを確認

### 本番環境でのテスト

1. Railway に `NODE_ENV=production` を設定
2. デプロイ後、Vercel フロントエンドからログイン
3. 同様の手順でログインが成功することを確認

## ログ出力例

### 成功時のログ

```
[SessionService] Cookie設定: { secure: false, sameSite: 'lax', environment: '開発' }
[cTraderAuth] コールバック処理開始: { hasCode: true, codeLength: 40, ... }
[cTraderAuth] 認可コード受信: abc123def4...
[cTraderAuth] ログイン成功: ユーザー xxxx-xxxx-xxxx-xxxx, アカウント 12345678
[cTraderAuth] /me エンドポイント: { hasCookie: true, hasAuthHeader: false, ... }
[cTraderAuth] Cookie からトークン取得
[cTraderAuth] JWT検証成功: { userId: 'xxxx-xxxx-xxxx-xxxx' }
[cTraderAuth] ユーザー情報取得成功: { userId: '...', primaryAccountId: '...', accountsCount: 1 }
```

## 影響を受けるファイル

```
src/backend/services/auth/sessionService.ts           # Cookie設定の動的変更
src/backend/api/ctraderAuthRoutes.ts                  # デバッグログ追加
src/frontend/app/auth/ctrader/callback/page.tsx      # デバッグログ追加
```

## 関連ドキュメント

- [MDN: Set-Cookie](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Set-Cookie)
- [MDN: SameSite cookies](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
- [Chrome: SameSite Cookie Changes](https://www.chromium.org/updates/same-site/)

## 今後の推奨事項

1. 本番環境のログを確認し、Cookie設定が正しく動作していることを検証
2. クロスドメインでのセッション管理に問題がないかモニタリング
3. セキュリティレビューを実施（特にCookie設定）
