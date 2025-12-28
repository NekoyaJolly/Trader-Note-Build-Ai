# テスト用CSVファイル一覧

このディレクトリには、TradeAssist のテストと検証用のCSVファイルが含まれています。

## ファイル一覧

### 1. `sample_trades.csv` (既存)
- **用途**: 基本的な動作確認用
- **件数**: 5件
- **特徴**: BTC, ETHの売買履歴（2024年1月）

### 2. `test_trades_recent.csv` (最新データ)
- **用途**: 最近の市場価格を反映したテスト
- **件数**: 10件
- **特徴**: 
  - 2024年12月28日のデータ
  - 多様な通貨ペア（BTC, ETH, SOL, BNB, XRP, ADA, DOGE）
  - 売買両方を含む

### 3. `test_trades_multi.csv` (複数取引所)
- **用途**: 大量データ & 複数取引所のテスト
- **件数**: 15件
- **特徴**:
  - 2024年12月29日のデータ
  - Binance, Coinbase, Kraken 複数取引所
  - 短時間に集中した取引データ
  - より多くの通貨ペア（MATIC, LINK追加）

### 4. `test_trades_minimal.csv` (最小構成)
- **用途**: 必須フィールドのみでの動作確認
- **件数**: 3件
- **特徴**:
  - fee, exchange フィールドなし
  - 最小限のカラムで正常動作を確認

### 5. `test_trades_invalid.csv` (異常系テスト)
- **用途**: バリデーション & エラーハンドリングのテスト
- **件数**: 7件（すべて異常データ）
- **特徴**:
  - 極小値（0.00001）
  - 不正なsymbol
  - 不正なside（invalid_side）
  - 負の価格・数量
  - 不正なtimestamp
  - 数値でないquantity

## 使用例

### 正常系テスト
```bash
# 最近のデータでテスト
bash scripts/verify-e2e.sh  # デフォルトはsample_trades.csv

# 大量データテスト
# スクリプト内のCSV_FILE変数を変更
CSV_FILE="data/trades/test_trades_multi.csv" bash scripts/verify-e2e.sh
```

### UI テスト
1. ブラウザで http://localhost:3102/import を開く
2. 各CSVファイルを選択してアップロード
3. 生成されるノートの内容と件数を確認

### バリデーションテスト
```bash
# 異常系CSVをアップロード
# → スキップ件数と警告メッセージを確認
CSV_FILE="data/trades/test_trades_invalid.csv" bash scripts/verify-e2e.sh
```

## 期待される結果

| CSV | 取り込み件数 | スキップ件数 | 生成ノート数 |
|-----|------------|------------|------------|
| sample_trades.csv | 5 | 0 | 5 |
| test_trades_recent.csv | 10 | 0 | 10 |
| test_trades_multi.csv | 15 | 0 | 15 |
| test_trades_minimal.csv | 3 | 0 | 3 |
| test_trades_invalid.csv | 0-1 | 6-7 | 0-1 |

## 注意事項

- `test_trades_invalid.csv` は意図的にエラーを含むため、エラーログが出力されることが正常です
- 実際の本番環境では、ユーザーが各ブローカーからエクスポートした実データを使用します
- CSVフォーマットはMT4/MT5の標準的な出力形式に準拠しています
