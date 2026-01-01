# テスト用CSVファイル一覧

このディレクトリには、TradeAssist のテストと検証用のCSVファイルが含まれています。

## 必須カラム

```csv
timestamp,symbol,side,price,quantity
```

オプションカラム: `fee`, `exchange`

## ファイル一覧

### 基本テスト用

| ファイル | 件数 | 用途 |
|----------|------|------|
| `sample_trades.csv` | 5 | 基本動作確認（BTC, ETH） |
| `test_trades_recent.csv` | 10 | 最新市場価格テスト（2024年12月） |
| `test_trades_multi.csv` | 15 | 大量データ・複数取引所テスト |
| `test_trades_minimal.csv` | 3 | 必須フィールドのみ |
| `test_trades_invalid.csv` | 7 | 異常系・バリデーションテスト |

### 追加テスト用

| ファイル | 用途 |
|----------|------|
| `test.csv` | 汎用テスト |
| `test_import.csv` | インポート処理テスト |
| `test_import4.csv` | インポート処理テスト（パターン4） |
| `test_import5.csv` | インポート処理テスト（パターン5） |
| `crash_test.csv` | クラッシュ耐性テスト |
| `final_test.csv` | 最終検証テスト |

## 使用例

### CLI からインポート

```bash
# スクリプト経由
npx ts-node scripts/import-trades.ts data/trades/sample_trades.csv
```

### API 経由

```bash
# ファイル名指定（サーバー上のファイル）
curl -X POST http://localhost:3100/api/trades/import/csv \
  -H "Content-Type: application/json" \
  -d '{"filename": "sample_trades.csv"}'

# CSV テキスト直接送信
curl -X POST http://localhost:3100/api/trades/import/upload-text \
  -H "Content-Type: application/json" \
  -d '{"filename": "my_trades.csv", "csvText": "timestamp,symbol,side,price,quantity\n2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1"}'
```

### UI からインポート

1. ブラウザで http://localhost:3102/import を開く
2. CSV ファイルを選択してアップロード
3. 生成されるノートの内容と件数を確認

## 期待される結果

| CSV | 取り込み | スキップ | ノート生成 |
|-----|---------|---------|-----------|
| sample_trades.csv | 5 | 0 | 5 |
| test_trades_recent.csv | 10 | 0 | 10 |
| test_trades_multi.csv | 15 | 0 | 15 |
| test_trades_minimal.csv | 3 | 0 | 3 |
| test_trades_invalid.csv | 0-1 | 6-7 | 0-1 |

## 異常系テストの詳細

`test_trades_invalid.csv` に含まれるエラーパターン:

- 極小値（0.00001）
- 不正な symbol 形式
- 不正な side（`invalid_side`）
- 負の価格・数量
- 不正な timestamp 形式
- 数値でない quantity

これらはエラーログが出力されることが正常です。

## 注意事項

- 実際の本番環境では、ユーザーが各ブローカーからエクスポートした実データを使用
- CSV フォーマットは MT4/MT5 の標準的な出力形式に準拠
- タイムスタンプは UTC (ISO 8601 形式) を推奨
