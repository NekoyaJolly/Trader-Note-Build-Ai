# Railway デプロイ状態確認スクリプト (PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Railway Production デプロイテスト" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$RailwayUrl = "https://trader-note-build-ai-production.up.railway.app"

# [1/3] Health Check
Write-Host "[1/3] Health Check..." -ForegroundColor Yellow
Write-Host "URL: $RailwayUrl/health"
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "$RailwayUrl/health" -UseBasicParsing -ErrorAction Stop
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)"
    Write-Host ""
    Write-Host "✅ Health check 成功" -ForegroundColor Green
} catch {
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "❌ Health check 失敗" -ForegroundColor Red
    
    # 詳細エラー情報
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body:" -ForegroundColor Yellow
        Write-Host $responseBody
    }
    
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "デバッグ: Railway ダッシュボードでログを確認してください"
    Write-Host "1. https://railway.app にアクセス"
    Write-Host "2. プロジェクトを開く"
    Write-Host "3. Deployments → 最新デプロイ → View Logs"
    Write-Host "=========================================="
    exit 1
}

Write-Host ""

# [2/3] cTrader 認証 URL
Write-Host "[2/3] cTrader 認証 URL 取得..." -ForegroundColor Yellow
Write-Host "URL: $RailwayUrl/api/auth/ctrader/url"
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "$RailwayUrl/api/auth/ctrader/url" -UseBasicParsing -ErrorAction Stop
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)"
    Write-Host ""
    Write-Host "✅ cTrader 認証 URL 取得成功" -ForegroundColor Green
} catch {
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "❌ cTrader 認証 URL 取得失敗" -ForegroundColor Red
}

Write-Host ""

# [3/3] ユーザー情報（認証なし - 401期待）
Write-Host "[3/3] ユーザー情報取得（認証なし - 401期待）..." -ForegroundColor Yellow
Write-Host "URL: $RailwayUrl/api/auth/me"
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "$RailwayUrl/api/auth/me" -UseBasicParsing -ErrorAction Stop
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Yellow
    Write-Host "Response: $($response.Content)"
    Write-Host ""
    Write-Host "⚠️ 認証なしでアクセスできました（予期しない動作）" -ForegroundColor Yellow
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status Code: $statusCode" -ForegroundColor Green
    
    if ($statusCode -eq 401) {
        Write-Host "✅ 認証エラー（期待通り）" -ForegroundColor Green
    } else {
        Write-Host "⚠️ 予期しないステータスコード" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "テスト完了" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "次のステップ:"
Write-Host "1. 全てのテストが成功 → フロントエンドからログイン試行"
Write-Host "2. 502 エラーが継続 → RAILWAY_DEPLOY_CHECK.md を参照"
Write-Host "3. Railway ダッシュボードでデプロイログを確認"
