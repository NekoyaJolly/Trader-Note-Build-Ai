# 手動トリガー playbook(Critical-1/7/1.5 動作確認)

> 作成日: 2026-04-30
> 用途: PR #63 デプロイ後、本日中にエージェント連鎖が `screening_passed` まで進むことを確認する

---

## 前提

- PR #60 / #61 / #62 / #63 すべて本番反映済み
- 本番 DB の現状: `not_testable` 72 件 / `unverified` 0 件(2026-04-30 15:48 UTC ベースライン)
- `CRON_SECRET` は本番のみのため、Nekoさん がローカルから curl

---

## ステップ 1: 過去 72 件を unverified に戻す(救済)

### 全件リセット

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}' \
  https://trader-note-571157808050.asia-northeast1.run.app/api/cron/side-b/reset-not-testable
```

### 期待レスポンス

```json
{ "success": true, "message": "72件を unverified に戻しました", "data": { "affected": 72, "statusNotePrefix": null } }
```

### 部分リセット(エラー種別ごとに段階的にやりたい場合)

```bash
# Critical-1 のエラーで倒れた 66 件のみ
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"statusNotePrefix":"Materialization失敗"}' \
  https://trader-note-571157808050.asia-northeast1.run.app/api/cron/side-b/reset-not-testable

# Critical-1.5 のエラーで倒れた 6 件のみ
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"statusNotePrefix":"OHLCV補完失敗"}' \
  https://trader-note-571157808050.asia-northeast1.run.app/api/cron/side-b/reset-not-testable
```

---

## ステップ 2: screening を一巡

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://trader-note-571157808050.asia-northeast1.run.app/api/cron/side-b/run-screening
```

### 期待レスポンス(成功時)

```json
{
  "success": true,
  "message": "processed=10 passed=N rejected=M not_testable=K errors=0",
  "data": { "processed": 10, "passed": N, "rejected": M, "notTestable": K, "errors": 0 }
}
```

### 注意

- `screeningMaxPerRun=10`(scheduler 既定値)のため、1 回の実行で最大 10 件
- 72 件すべて回すには **8 回連続実行**(または scheduler 設定変更)が必要
- 各回 5-30 秒程度(Side-A BT 実行時間に依存)

### 全件ループ実行例

```bash
for i in $(seq 1 8); do
  echo "=== Run $i/8 ==="
  curl -sH "Authorization: Bearer $CRON_SECRET" \
    https://trader-note-571157808050.asia-northeast1.run.app/api/cron/side-b/run-screening
  echo
  sleep 5
done
```

---

## ステップ 3: screening_passed が出たら full validation

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://trader-note-571157808050.asia-northeast1.run.app/api/cron/side-b/run-full-validation
```

### 期待レスポンス

```json
{
  "success": true,
  "message": "processed=N confirmed=A rejected=B not_testable=C errors=0",
  "data": { "processed": N, "confirmed": A, "rejected": B, "notTestable": C, "errors": 0 }
}
```

`confirmed >= 1` または `rejected >= 1` で **PDCA-2 が一巡したことの決定的証拠**。

---

## ステップ 4: 結果共有

各ステップのレスポンス JSON を私(Claude Code)に貼っていただければ、本番DB を SELECT して即時分析・レポート化します。

最低限欲しい情報:
- ステップ 1 の `data.affected`
- ステップ 2 の各回の `data.{processed, passed, rejected, notTestable, errors}`
- ステップ 3 の `data.{processed, confirmed, rejected}`(該当があれば)

---

## 想定される失敗パターン

| パターン | statusNote / エラー | 対応 |
|---|---|---|
| 既存と同じエラー再発 | `Materialization失敗: ATR が...` | Critical-1 修正が反映されていない → 別の経路で agentMemory snapshot を使っている疑い、要追加調査 |
| OHLCV API 別エラー | `OHLCV補完失敗: ...(multi 以外)` | 上流データソースの問題。仮説の `symbols[0]` が cTrader/Twelve Data で扱えないシンボル |
| BT 結果取得失敗 | `BT 結果取得失敗 (runId=...)` | Side-A backtestService の挙動。別途調査 |
| screening が rejected 連発 | metrics: pf < 1.0 等 | 仮説の品質問題。Critical-3(Registry 拡大)後の改善で対処 |

---

## 24h 自動観察を組む場合(Supabase MCP 接続後)

`https://claude.ai/customize/connectors` で **Supabase MCP** を接続する。
接続情報には Supabase プロジェクト ID `rmsylwmqxyeqgplysqoa` と、**原則 read-only の専用キー（anon + RLS で SELECT のみ許可）** を指定してください。

> ⚠️ **セキュリティ注意**: `service_role` キーはすべての RLS をバイパスする最高権限キーです。万一漏洩した場合のデータ被害が甚大なため、通常の観察・分析用途では使用しないこと。  
> 読み取り専用の anon キー（または SELECT 専用 DB ロール）で要件を満たせない場合のみ、service_role を **最終手段として一時的に** 使用し、作業後は即時無効化 or ローテーションを検討してください。

接続後、以下を Claude Code で `/schedule` 実行:

```
create "Critical-1/7/1.5 24h 効果検証" daily-once 09:30 JST

明日朝の自然 plan サイクル後の本番 DB を観察し、Critical-1/7/1.5 の効果判定レポートを生成。
Supabase MCP で SELECT クエリ:
- EdgeHypothesis status / timeframes / statusNote 分布
- 直近24h の status 遷移
- PromptVersion 使用統計
- AITradePlan の scenarios / overallConfidence / warnings
出力: docs/diagnostics/critical_1_5_7_24h_observation.md
```
