#!/bin/bash

# TradeAssist E2Eテストシステム検証スクリプト
# 目的: Playwright環境が正しくセットアップされているか確認

echo "🔍 TradeAssist E2Eテストシステム検証"
echo "======================================"
echo ""

# カラーコード
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# チェック関数
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 がインストールされています"
        return 0
    else
        echo -e "${RED}✗${NC} $1 が見つかりません"
        return 1
    fi
}

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 が存在します"
        return 0
    else
        echo -e "${RED}✗${NC} $1 が見つかりません"
        return 1
    fi
}

check_directory() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 ディレクトリが存在します"
        return 0
    else
        echo -e "${RED}✗${NC} $1 ディレクトリが見つかりません"
        return 1
    fi
}

# 1. 前提条件チェック
echo "1. 前提条件チェック"
echo "-------------------"
check_command node
check_command npm
echo ""

# 2. ファイル存在確認
echo "2. 設定ファイル確認"
echo "-------------------"
check_file "playwright.config.ts"
check_file "package.json"
check_file ".github/workflows/e2e-tests.yml"
check_file "docs/TESTING.md"
echo ""

# 3. テストディレクトリ確認
echo "3. テストディレクトリ確認"
echo "------------------------"
check_directory "tests"
check_directory "tests/e2e"
check_directory "tests/ai-orchestrator"
check_directory "tests/fixtures"
echo ""

# 4. E2Eテストファイル確認
echo "4. E2Eテストファイル確認"
echo "------------------------"
check_file "tests/e2e/auth.spec.ts"
check_file "tests/e2e/dashboard.spec.ts"
check_file "tests/e2e/trade-notes.spec.ts"
check_file "tests/e2e/market-data.spec.ts"
check_file "tests/e2e/notifications.spec.ts"
echo ""

# 5. AIオーケストレーター確認
echo "5. AIオーケストレーター確認"
echo "---------------------------"
check_file "tests/ai-orchestrator/ai-test-runner.ts"
check_file "tests/ai-orchestrator/claude-computer-use.ts"
check_file "tests/fixtures/test-data.ts"
echo ""

# 6. package.jsonスクリプト確認
echo "6. npmスクリプト確認"
echo "--------------------"
if grep -q "test:e2e" package.json; then
    echo -e "${GREEN}✓${NC} test:e2e スクリプトが定義されています"
else
    echo -e "${RED}✗${NC} test:e2e スクリプトが見つかりません"
fi

if grep -q "test:ai" package.json; then
    echo -e "${GREEN}✓${NC} test:ai スクリプトが定義されています"
else
    echo -e "${RED}✗${NC} test:ai スクリプトが見つかりません"
fi
echo ""

# 7. 依存関係確認
echo "7. 依存関係確認"
echo "---------------"
if grep -q "@playwright/test" package.json; then
    echo -e "${GREEN}✓${NC} @playwright/test が package.json に含まれています"
else
    echo -e "${RED}✗${NC} @playwright/test が package.json にありません"
fi

if grep -q "openai" package.json; then
    echo -e "${GREEN}✓${NC} openai が package.json に含まれています"
else
    echo -e "${YELLOW}⚠${NC} openai が package.json にありません（AIテストには必要）"
fi

if grep -q "@anthropic-ai/sdk" package.json; then
    echo -e "${GREEN}✓${NC} @anthropic-ai/sdk が package.json に含まれています"
else
    echo -e "${YELLOW}⚠${NC} @anthropic-ai/sdk が package.json にありません（Claude Computer Useには必要）"
fi
echo ""

# 8. node_modulesチェック
echo "8. インストール状態確認"
echo "-----------------------"
if [ -d "node_modules/@playwright" ]; then
    echo -e "${GREEN}✓${NC} Playwright がインストールされています"
else
    echo -e "${YELLOW}⚠${NC} Playwright がインストールされていません"
    echo "   実行: npm install"
fi
echo ""

# 9. 環境変数チェック
echo "9. 環境変数確認（オプション）"
echo "----------------------------"
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env ファイルが存在します"
    
    if grep -q "OPENAI_API_KEY" .env; then
        echo -e "${GREEN}✓${NC} OPENAI_API_KEY が .env に設定されています"
    else
        echo -e "${YELLOW}⚠${NC} OPENAI_API_KEY が .env にありません（AIテストには必要）"
    fi
    
    if grep -q "ANTHROPIC_API_KEY" .env; then
        echo -e "${GREEN}✓${NC} ANTHROPIC_API_KEY が .env に設定されています"
    else
        echo -e "${YELLOW}⚠${NC} ANTHROPIC_API_KEY が .env にありません（Claude Computer Useには必要）"
    fi
else
    echo -e "${YELLOW}⚠${NC} .env ファイルが見つかりません"
    echo "   実行: cp .env.example .env"
fi
echo ""

# 最終結果
echo "======================================"
echo "検証完了！"
echo ""
echo "次のステップ:"
echo "1. npm install を実行して依存関係をインストール"
echo "2. npx playwright install chromium でブラウザをインストール"
echo "3. npm run test:e2e でE2Eテストを実行"
echo ""
echo "詳細なガイドは docs/TESTING.md を参照してください。"
