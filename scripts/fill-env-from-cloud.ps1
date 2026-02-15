param(
  [string]$EnvFile = ".env",
  [string]$VercelFile = ".env.vercel"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Placeholder {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) { return $true }
  $v = $Value.Trim()

  if ($v -eq "") { return $true }
  if ($v -match '^your-.*-change-in-production$') { return $true }
  if ($v -eq 'sk-xxxx') { return $true }
  if ($v -eq 'xxxx') { return $true }

  return $false
}

if (-not (Test-Path $EnvFile)) {
  throw "対象の .env ファイルが存在しません: $EnvFile"
}

# GCP Secret Manager のシークレット名一覧を取得（取得不能時は空配列）
$gcpSecretNames = @()
try {
  $gcpSecretNames = @(gcloud secrets list --format="value(name)" 2>$null)
} catch {
  $gcpSecretNames = @()
}

# Vercel環境変数ファイルを辞書化
$vercelMap = @{}
if (Test-Path $VercelFile) {
  Get-Content $VercelFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line -match '^[A-Za-z_][A-Za-z0-9_]*=') {
      $idx = $line.IndexOf('=')
      $k = $line.Substring(0, $idx)
      $v = $line.Substring($idx + 1)
      $vercelMap[$k] = $v
    }
  }
}

$lines = Get-Content $EnvFile
$updated = New-Object System.Collections.Generic.List[string]
$updatedCount = 0
$updatedFromVercel = 0
$updatedFromGcp = 0

foreach ($line in $lines) {
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $key = $matches[1]
    $currentValue = $matches[2]

    if (Test-Placeholder $currentValue) {
      $newValue = $null

      if ($vercelMap.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($vercelMap[$key])) {
        $newValue = $vercelMap[$key]
        $updatedFromVercel++
      } elseif ($gcpSecretNames -contains $key) {
        try {
          $secretValue = gcloud secrets versions access latest --secret=$key 2>$null
          if (-not [string]::IsNullOrWhiteSpace($secretValue)) {
            $newValue = $secretValue
            $updatedFromGcp++
          }
        } catch {
          # 取得不能のキーはスキップ
        }
      }

      if ($null -ne $newValue) {
        $updated.Add("$key=$newValue")
        $updatedCount++
        continue
      }
    }
  }

  $updated.Add($line)
}

Set-Content -Path $EnvFile -Value $updated -Encoding UTF8

# 未設定・プレースホルダ項目を収集
$remaining = @()
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $k = $matches[1]
    $v = $matches[2]
    if (Test-Placeholder $v) {
      $remaining += $k
    }
  }
}

$remaining = $remaining | Sort-Object -Unique

Write-Output "UPDATED_TOTAL=$updatedCount"
Write-Output "UPDATED_FROM_VERCEL=$updatedFromVercel"
Write-Output "UPDATED_FROM_GCP=$updatedFromGcp"
Write-Output "REMAINING_PLACEHOLDERS=$($remaining.Count)"
if ($remaining.Count -gt 0) {
  Write-Output "REMAINING_KEYS=$($remaining -join ',')"
}
