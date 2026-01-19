# GitHub Actions シークレット設定ガイド

このガイドでは、GitHub Actions でテストを実行するために必要なシークレットの設定方法を説明します。

## 🚀 自動設定スクリプトの使用（推奨）

### 1. 前提条件

- [GitHub CLI](https://cli.github.com/) がインストール済み
- GitHub CLI で認証済み（`gh auth login`）

### 2. スクリプト実行

```bash
# リポジトリのルートディレクトリで実行
./scripts/setup-github-secrets.sh
```

このスクリプトは以下のシークレットを**自動生成・設定**します：

- ✅ `TEST_DB_USER` - テスト用DBユーザー名
- ✅ `TEST_DB_PASSWORD` - テスト用DBパスワード
- ✅ `TEST_DB_NAME` - テスト用DB名
- ✅ `JWT_SECRET` - JWT署名用秘密鍵（自動生成）
- ✅ `JWT_REFRESH_SECRET` - JWTリフレッシュ用秘密鍵（自動生成）
- ✅ `VAPID_PUBLIC_KEY` - Web Push公開鍵（自動生成）
- ✅ `VAPID_PRIVATE_KEY` - Web Push秘密鍵（自動生成）
- ✅ `VAPID_SUBJECT` - Web Push subject

### 3. 手動設定が必要なシークレット

以下のシークレットは、**あなたが取得した値を手動で設定**してください：

#### OpenAI API キー

```bash
gh secret set AI_API_KEY --body "sk-YOUR-OPENAI-API-KEY"
```

取得方法: https://platform.openai.com/api-keys

#### Twelve Data API キー

```bash
gh secret set MARKET_API_KEY --body "YOUR-TWELVE-DATA-API-KEY"
gh secret set TWELVE_DATA_API_KEY --body "YOUR-TWELVE-DATA-API-KEY"
```

取得方法: https://twelvedata.com/

#### cTrader API 認証情報

```bash
gh secret set CTRADER_CLIENT_ID --body "YOUR-CTRADER-CLIENT-ID"
gh secret set CTRADER_CLIENT_SECRET --body "YOUR-CTRADER-CLIENT-SECRET"
```

取得方法: https://openapi.ctrader.com/

---

## 🔍 シークレット確認

```bash
# 設定済みシークレット一覧を表示
gh secret list
```

---

## ⚠️ シークレット未設定時の動作

### GitHub Actions でシークレットが設定されていない場合

シークレットが未設定の場合、以下のような問題が発生します：

#### 1. **必須シークレット（テスト実行に必須）**

以下のシークレットが未設定の場合、**テストは失敗します**：

| シークレット | 未設定時の影響 |
|-------------|---------------|
| `TEST_DB_USER` | DATABASE_URL が不正な形式になり、Prisma セットアップが失敗 |
| `TEST_DB_PASSWORD` | DATABASE_URL が不正な形式になり、Prisma セットアップが失敗 |
| `TEST_DB_NAME` | DATABASE_URL が不正な形式になり、Prisma セットアップが失敗 |
| `JWT_SECRET` | 認証機能のテストが失敗（JWT トークン生成・検証エラー） |
| `JWT_REFRESH_SECRET` | リフレッシュトークン関連のテストが失敗 |

**エラー例**:
```
Error: Invalid `prisma.user.findMany()` invocation:
  Invalid connection string
```

#### 2. **オプションシークレット（一部機能のみ影響）**

以下のシークレットが未設定の場合、**該当機能を使用するテストのみ失敗します**：

| シークレット | 未設定時の影響 |
|-------------|---------------|
| `AI_API_KEY` | AI 関連機能（トレードノート生成等）のテストがスキップまたは失敗 |
| `MARKET_API_KEY` | 市場データ取得のテストがスキップまたは失敗 |
| `TWELVE_DATA_API_KEY` | Twelve Data API 使用のテストがスキップまたは失敗 |
| `VAPID_PUBLIC_KEY` | Web Push 通知機能のテストがスキップまたは失敗 |
| `VAPID_PRIVATE_KEY` | Web Push 通知機能のテストがスキップまたは失敗 |
| `VAPID_SUBJECT` | Web Push 通知機能のテストがスキップまたは失敗 |
| `CTRADER_CLIENT_ID` | cTrader 連携機能のテストがスキップまたは失敗 |
| `CTRADER_CLIENT_SECRET` | cTrader 連携機能のテストがスキップまたは失敗 |

**エラー例**:
```
Error: AI_API_KEY is not defined
Error: Cannot connect to market data API
```

#### 3. **GitHub Actions での確認方法**

シークレットが未設定の場合、GitHub Actions のログに以下のような表示が出ます：

```bash
# シークレットが未設定の場合（空文字列として展開される）
DATABASE_URL: postgresql://://localhost:5432/
                         ↑↑ ユーザー名とパスワードが空
```

### 推奨される対応

1. **まず自動設定スクリプトを実行**
   ```bash
   ./scripts/setup-github-secrets.sh
   ```
   これで必須シークレット（DB、JWT、VAPID）が自動設定されます。

2. **API キーは段階的に設定**
   - 最初は必須シークレットのみでテスト実行
   - AI 機能を使う場合は `AI_API_KEY` を追加
   - 市場データ機能を使う場合は `MARKET_API_KEY` を追加
   - cTrader 連携を使う場合は `CTRADER_*` を追加

3. **テスト実行前に確認**
   ```bash
   gh secret list
   ```
   最低限、以下が設定されているか確認：
   - ✅ TEST_DB_USER
   - ✅ TEST_DB_PASSWORD
   - ✅ TEST_DB_NAME
   - ✅ JWT_SECRET
   - ✅ JWT_REFRESH_SECRET

---

## 🛠️ 手動設定（GUIを使用）

スクリプトを使用しない場合は、以下の手順でGUIから設定できます：

1. GitHub リポジトリページを開く
2. **Settings** → **Secrets and variables** → **Actions** に移動
3. **New repository secret** をクリック
4. 各シークレットを追加

### 必須シークレット一覧

| シークレット名 | 説明 | 例/推奨値 |
|---------------|------|----------|
| `TEST_DB_USER` | テスト用DBユーザー名 | `postgres` |
| `TEST_DB_PASSWORD` | テスト用DBパスワード | `postgres` |
| `TEST_DB_NAME` | テスト用DB名 | `tradeassist_test` |
| `JWT_SECRET` | JWT署名用秘密鍵 | 64文字のランダム文字列 |
| `JWT_REFRESH_SECRET` | JWTリフレッシュ用秘密鍵 | 64文字のランダム文字列 |
| `VAPID_PUBLIC_KEY` | Web Push公開鍵 | `npx web-push generate-vapid-keys` で生成 |
| `VAPID_PRIVATE_KEY` | Web Push秘密鍵 | `npx web-push generate-vapid-keys` で生成 |
| `VAPID_SUBJECT` | Web Push subject | `mailto:admin@tradeassist.local` |
| `AI_API_KEY` | OpenAI API キー | `sk-...` |
| `MARKET_API_KEY` | Twelve Data API キー | 取得したAPIキー |
| `TWELVE_DATA_API_KEY` | Twelve Data API キー | 取得したAPIキー |
| `CTRADER_CLIENT_ID` | cTrader クライアントID | 取得したクライアントID |
| `CTRADER_CLIENT_SECRET` | cTrader クライアントシークレット | 取得したシークレット |

---

## ⚠️ トラブルシューティング

### GitHub CLI がインストールされていない

```bash
# macOS
brew install gh

# Windows
winget install --id GitHub.cli

# Linux (Debian/Ubuntu)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh
```

詳細: https://github.com/cli/cli/blob/trunk/docs/install_linux.md

### 認証エラー

```bash
gh auth login
```

対話形式で認証を行います。GitHubアカウントでログインしてください。

### VAPID キー生成エラー

手動で生成する場合：

```bash
npx web-push generate-vapid-keys
```

出力例：
```
=======================================
Public Key:
BEL...（公開鍵）

Private Key:
abc...（秘密鍵）
=======================================
```

これらの値を使用して、以下のコマンドでシークレットを設定：

```bash
gh secret set VAPID_PUBLIC_KEY --body "BEL..."
gh secret set VAPID_PRIVATE_KEY --body "abc..."
```

### シークレットが反映されない

シークレットを設定後、GitHub Actions ワークフローを再実行してください：

1. GitHub リポジトリの **Actions** タブを開く
2. 失敗したワークフローを選択
3. **Re-run all jobs** をクリック

### データベース接続エラー

テスト用データベースの認証情報が正しく設定されているか確認：

```bash
# 設定内容を確認（値は表示されませんが、設定されているかは確認できます）
gh secret list
```

以下が表示されているか確認：
- `TEST_DB_USER`
- `TEST_DB_PASSWORD`
- `TEST_DB_NAME`

---

## 🔒 セキュリティのベストプラクティス

### ローカル環境とCI環境の分離

- ローカル開発: `.env` ファイルを使用（Git管理外）
- CI環境: GitHub Actions シークレットを使用
- **絶対に `.env` ファイルをコミットしないこと**

### シークレットの定期的な更新

本番環境で使用するAPIキーは定期的に更新することを推奨します：

```bash
# 新しいAPIキーで上書き
gh secret set AI_API_KEY --body "sk-NEW-API-KEY"
```

### 最小権限の原則

各APIキーには必要最小限の権限のみを付与してください。

---

## 📚 参考資料

- [GitHub Actions - 暗号化されたシークレット](https://docs.github.com/ja/actions/security-guides/encrypted-secrets)
- [GitHub CLI - シークレット管理](https://cli.github.com/manual/gh_secret)
- [OpenAI API ドキュメント](https://platform.openai.com/docs)
- [Twelve Data API ドキュメント](https://twelvedata.com/docs)
- [cTrader Open API ドキュメント](https://help.ctrader.com/open-api/)
- [Web Push 仕様](https://www.npmjs.com/package/web-push)

---

## 🆘 サポート

問題が解決しない場合は、以下の情報を含めてIssueを作成してください：

1. 実行したコマンド
2. エラーメッセージ全文
3. 使用している OS とバージョン
4. GitHub CLI のバージョン（`gh --version`）

---

**最終更新**: 2026-01-19
