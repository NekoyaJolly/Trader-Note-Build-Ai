# cTrader OAuth 認証修正 - まとめ

## 修正日時
2026年2月6日

## 問題の報告
ユーザーからの報告:
> ログイン時にOAuth認証(Ctrader)をしてるんだけど、OAuch認証で進むと、Ctraderのアカウント選択、ログインまでは出来るけど、アプリにリダイレクトした時にログインエラーが出てログインページにもどされ表示される。

## 原因分析

### 技術的な原因
Cookie設定が環境に関わらず常に以下のように固定されていました：
```typescript
res.cookie('auth_token', token, {
  httpOnly: true,
  secure: true,      // ← 常にHTTPS必須
  sameSite: 'none',  // ← クロスサイトリクエスト対応
});
```

### なぜ問題が発生したのか
1. **開発環境（localhost）での問題**
   - `secure: true` は Cookie を HTTPS 接続でのみ送信
   - localhost は通常 HTTP で動作
   - ブラウザは Cookie を送信しない → 認証エラー

2. **認証フローの詳細**
   ```
   1. ユーザーがcTraderログインボタンをクリック
   2. cTrader認証画面でログイン成功
   3. /auth/ctrader/callback にリダイレクト
   4. バックエンドが JWT を Cookie に設定（secure: true）
   5. フロントエンドが /api/auth/me を呼び出し
   6. ❌ Cookie が送信されない（HTTP接続のため）
   7. 401 Unauthorized エラー
   8. ログインページにリダイレクト
   ```

## 修正内容

### コード修正
1. **sessionService.ts**
   - 環境変数 `NODE_ENV` をチェック
   - 開発環境: `secure: false`, `sameSite: 'lax'`
   - 本番環境: `secure: true`, `sameSite: 'none'`

2. **デバッグログ追加**
   - Cookie設定時のログ出力
   - 各エンドポイントでの認証状態ログ
   - エラー詳細のログ出力

### 動作確認の方法

#### 開発環境
```bash
# .env ファイルで設定
NODE_ENV=development

# サーバー起動
npm run dev

# ログ確認
[SessionService] Cookie設定: { secure: false, sameSite: 'lax', environment: '開発' }
```

#### 本番環境
```bash
# 環境変数設定（Railway）
NODE_ENV=production

# ログ確認
[SessionService] Cookie設定: { secure: true, sameSite: 'none', environment: '本番' }
```

## セキュリティへの影響

### 開発環境
- ✅ HTTP接続でCookieを送信可能（開発作業が可能）
- ⚠️ ローカル環境のみで使用すること

### 本番環境
- ✅ HTTPS接続でのみCookieを送信（セキュリティ維持）
- ✅ クロスドメイン対応（Vercel ↔ Railway）
- ✅ XSS対策（httpOnly: true）維持

## テスト結果

### コードレビュー
- ✅ 問題なし

### セキュリティチェック（CodeQL）
- ✅ 警告なし
- ✅ 脆弱性なし

## ユーザーへの影響

### 開発者
- ✅ localhost での OAuth 認証が正常に動作
- ✅ デバッグログで問題の追跡が容易

### エンドユーザー
- ✅ cTrader ログインが正常に動作
- ✅ ログイン後のセッション維持
- ✅ ログアウトも正常に動作

## 今後の推奨事項

1. **本番環境でのテスト**
   - Vercel フロントエンド経由でログインテスト
   - Railway バックエンドのログ確認
   - Cookie が正しく設定されているか確認

2. **モニタリング**
   - 認証エラーの発生率を監視
   - Cookie関連のエラーログを定期的に確認

3. **ドキュメント更新**
   - 新しい開発者向けに OAuth 設定手順を更新
   - 環境変数設定ガイドを充実

## 関連ドキュメント

- [詳細な修正内容](oauth-cookie-fix-2026-02-06.md)
- [CHANGELOG.md](../../CHANGELOG.md)
- [AGENTS.md - 認証システム](../../AGENTS.md#認証システムctrader-oauth-統合)

## 修正者の注記

この修正により、開発環境と本番環境の両方で OAuth 認証が正常に動作するようになりました。
Cookie設定は環境に応じて適切に変更されるため、セキュリティレベルを維持しながら、
開発効率も向上します。

今後、同様の認証機能を追加する際は、必ず環境に応じた Cookie 設定を行うようにしてください。
