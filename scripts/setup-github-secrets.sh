#!/bin/bash
# GitHub Actions シークレット自動設定スクリプト
# 
# 使い方: 
#   chmod +x scripts/setup-github-secrets.sh
#   ./scripts/setup-github-secrets.sh
#
# 前提条件:
#   - GitHub CLI (gh) がインストール済み
#   - gh auth login で認証済み
#   - リポジトリのルートディレクトリで実行

set -e

echo "🔐 GitHub Actions シークレット設定スクリプト"
echo "================================================"
echo ""

# GitHub CLI の確認
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) がインストールされていません"
    echo "   インストール方法: https://cli.github.com/"
    exit 1
fi

# 認証確認
if ! gh auth status &> /dev/null; then
    echo "❌ GitHub CLI で認証されていません"
    echo "   'gh auth login' を実行してください"
    exit 1
fi

echo "✅ GitHub CLI 認証済み"
echo ""

# ==============================================
# 自動生成可能なシークレット（Copilot Agent が設定）
# ==============================================

echo "📦 テスト用データベースシークレットを設定中..."

# 注意: これらの認証情報は、GitHub Actions の一時的な CI 環境専用です。
# 本番環境や永続的な環境では使用しないでください。
gh secret set TEST_DB_USER --body "postgres"
echo "  ✓ TEST_DB_USER"

gh secret set TEST_DB_PASSWORD --body "postgres"
echo "  ✓ TEST_DB_PASSWORD"

gh secret set TEST_DB_NAME --body "tradeassist_test"
echo "  ✓ TEST_DB_NAME"

echo ""
echo "📦 JWT シークレットを生成・設定中..."

# JWT_SECRET を生成（ランダム64文字）
JWT_SECRET=$(openssl rand -hex 32)
gh secret set JWT_SECRET --body "$JWT_SECRET"
echo "  ✓ JWT_SECRET (自動生成)"

# JWT_REFRESH_SECRET を生成（ランダム64文字）
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
gh secret set JWT_REFRESH_SECRET --body "$JWT_REFRESH_SECRET"
echo "  ✓ JWT_REFRESH_SECRET (自動生成)"

echo ""
echo "📦 VAPID シークレットを生成・設定中..."

# VAPID Subject を設定
gh secret set VAPID_SUBJECT --body "mailto:admin@tradeassist.local"
echo "  ✓ VAPID_SUBJECT"

# VAPID キーペア生成（web-push を使用）
if command -v npx &> /dev/null; then
    echo "  VAPID キーペアを生成中..."
    VAPID_KEYS=$(npx -y web-push generate-vapid-keys --json 2>/dev/null || echo "{}")
    
    if [ "$VAPID_KEYS" != "{}" ]; then
        VAPID_PUBLIC=$(echo "$VAPID_KEYS" | grep -o '"publicKey":"[^"]*"' | cut -d'"' -f4)
        VAPID_PRIVATE=$(echo "$VAPID_KEYS" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)
        
        if [ -n "$VAPID_PUBLIC" ] && [ -n "$VAPID_PRIVATE" ]; then
            gh secret set VAPID_PUBLIC_KEY --body "$VAPID_PUBLIC"
            echo "  ✓ VAPID_PUBLIC_KEY (自動生成)"
            
            gh secret set VAPID_PRIVATE_KEY --body "$VAPID_PRIVATE"
            echo "  ✓ VAPID_PRIVATE_KEY (自動生成)"
        else
            echo "  ❌ VAPID キー生成に失敗しました。"
            echo "     web-push のインストールやネットワーク設定を確認し、再度スクリプトを実行するか、"
            echo "     手動で VAPID_PUBLIC_KEY と VAPID_PRIVATE_KEY を生成して、以下のように設定してください:"
            echo "       gh secret set VAPID_PUBLIC_KEY --body \"YOUR-VAPID-PUBLIC-KEY\""
            echo "       gh secret set VAPID_PRIVATE_KEY --body \"YOUR-VAPID-PRIVATE-KEY\""
            exit 1
        fi
    else
        echo "  ❌ VAPID キー生成に失敗しました。"
        echo "     web-push のインストールやネットワーク設定を確認し、再度スクリプトを実行するか、"
        echo "     手動で VAPID_PUBLIC_KEY と VAPID_PRIVATE_KEY を生成して、以下のように設定してください:"
        echo "       gh secret set VAPID_PUBLIC_KEY --body \"YOUR-VAPID-PUBLIC-KEY\""
        echo "       gh secret set VAPID_PRIVATE_KEY --body \"YOUR-VAPID-PRIVATE-KEY\""
        exit 1
    fi
else
    echo "  ❌ npx が見つかりません。Node.js と npm をインストールし、npx コマンドを使用可能にしてください。"
    echo "     その後、web-push を用いて VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY を生成し、次のように設定してください:"
    echo "       gh secret set VAPID_PUBLIC_KEY --body \"YOUR-VAPID-PUBLIC-KEY\""
    echo "       gh secret set VAPID_PRIVATE_KEY --body \"YOUR-VAPID-PRIVATE-KEY\""
    exit 1
fi

echo ""
echo "✅ 自動設定可能なシークレットの設定完了！"
echo ""

# ==============================================
# 手動設定が必要なシークレット
# ==============================================

echo "================================================"
echo "⚠️  以下のシークレットは手動で設定してください"
echo "================================================"
echo ""
echo "以下のコマンドを実行して、実際の値を設定してください："
echo ""
echo "# OpenAI API キー"
echo "gh secret set AI_API_KEY --body \"sk-YOUR-OPENAI-API-KEY\""
echo ""
echo "# Twelve Data API キー"
echo "gh secret set MARKET_API_KEY --body \"YOUR-TWELVE-DATA-API-KEY\""
echo "gh secret set TWELVE_DATA_API_KEY --body \"YOUR-TWELVE-DATA-API-KEY\""
echo ""
echo "# cTrader API 認証情報"
echo "gh secret set CTRADER_CLIENT_ID --body \"YOUR-CTRADER-CLIENT-ID\""
echo "gh secret set CTRADER_CLIENT_SECRET --body \"YOUR-CTRADER-CLIENT-SECRET\""
echo ""
echo "================================================"
echo ""

echo "📋 現在設定されているシークレット一覧:"
gh secret list

echo ""
echo "🎉 スクリプト実行完了！"
