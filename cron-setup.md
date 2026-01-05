# Railway Cron設定
# 
# 目的: Side-B自動化のためのスケジュールされたジョブを定義
# 
# エンドポイント:
#   - /api/cron/side-b/daily-plan: 日次プラン生成
#   - /api/cron/side-b/monitor: 監視実行
#
# 認証: Authorization: Bearer <CRON_SECRET>
# 
# Railway Cronの仕様:
#   - cron.json または railway.json の cron セクションで定義
#   - UTCタイムゾーン
#   - 標準的なcron式をサポート
#
# 参考: https://docs.railway.app/reference/cron-jobs

# ==================================================
# 重要: Railway Cron の設定方法
# ==================================================
# 
# 方法1: Railway Dashboard での設定（推奨）
# 1. Railway Dashboardにログイン
# 2. プロジェクト → Settings → Cron Jobs
# 3. 以下のジョブを追加:
#    
#    ジョブ1: 日次プラン生成
#      - Name: daily-plan
#      - Schedule: 0 0 * * * (毎日 00:00 UTC = 09:00 JST)
#      - Command: curl -X GET -H "Authorization: Bearer ${CRON_SECRET}" "${RAILWAY_PUBLIC_DOMAIN}/api/cron/side-b/daily-plan"
#    
#    ジョブ2: 監視実行（毎時）
#      - Name: monitor
#      - Schedule: 0 * * * * (毎時0分)
#      - Command: curl -X GET -H "Authorization: Bearer ${CRON_SECRET}" "${RAILWAY_PUBLIC_DOMAIN}/api/cron/side-b/monitor"
#
# 方法2: GitHub Actions での代替（cron.yml参照）
#   - .github/workflows/cron.yml を使用
#   - GitHub Actionsのスケジュール機能を利用
#
# ==================================================
# 本番URL確認
# ==================================================
# Railway API: https://trader-note-api.up.railway.app
# 
# テスト用コマンド:
# curl -X GET -H "Authorization: Bearer YOUR_CRON_SECRET" \
#   "https://trader-note-api.up.railway.app/api/cron/health"
#
# ==================================================
