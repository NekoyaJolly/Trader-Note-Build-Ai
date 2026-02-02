# Cloud Run Job を作成/更新するスクリプト
# 目的: 本番DBマイグレーションを Cloud Run Job に分離
param(
  [string]$ProjectId = "ai-note-486020",
  [string]$Region = "asia-northeast1",
  [string]$Image = "gcr.io/ai-note-486020/trader-note:latest",
  [string]$JobName = "trader-note-migrate",
  [string]$ServiceAccount = "cloud-run-trader-note@ai-note-486020.iam.gserviceaccount.com",
  [string]$CloudSqlInstance = "ai-note-486020:asia-northeast1:trader-note-postgres"
)

Write-Host "[Cloud Run Job] 作成/更新を開始します: $JobName" -ForegroundColor Cyan

# 既存Jobがあれば削除（存在チェックのみ）
$null = gcloud run jobs describe $JobName --region $Region --project $ProjectId 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "既存Jobを削除します..." -ForegroundColor Yellow
  gcloud run jobs delete $JobName --region $Region --project $ProjectId --quiet
}

# Job 作成（DATABASE_URL は Secret Manager を参照）
gcloud run jobs create $JobName `
  --image $Image `
  --region $Region `
  --project $ProjectId `
  --command npx `
  --args prisma `
  --args migrate `
  --args deploy `
  --set-cloudsql-instances $CloudSqlInstance `
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" `
  --service-account $ServiceAccount `
  --memory 2Gi `
  --cpu 2 `
  --task-timeout 3600

if ($LASTEXITCODE -ne 0) {
  throw "Cloud Run Job の作成に失敗しました。"
}

Write-Host "Job 作成完了: $JobName" -ForegroundColor Green
Write-Host "次のコマンドで Job を実行してください:" -ForegroundColor Cyan
Write-Host "gcloud run jobs execute $JobName --region $Region --project $ProjectId" -ForegroundColor Gray
