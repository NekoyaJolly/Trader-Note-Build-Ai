# インジケーター定義

TradeAssist で使用するインジケーターの定義ドキュメント。

> **実装仕様**: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) を参照

## サポートインジケーター（23種類）

### Momentum（モメンタム系）

| ID | 名称 | 役割 | 定義 |
|----|------|------|------|
| `rsi` | RSI | 過熱判定（買われすぎ/売られすぎ） | [RSI.md](RSI.md) |
| `macd` | MACD | トレンド変化の兆候検出 | [MACD.md](MACD.md) |
| `stochastic` | Stochastic | 価格の相対位置（過熱判定） | [STOCHASTIC.md](STOCHASTIC.md) |
| `williamsR` | Williams %R | 買われすぎ/売られすぎ（反転型） | [WILLIAMS_R.md](WILLIAMS_R.md) |
| `cci` | CCI | 平均価格からの乖離度 | [CCI.md](CCI.md) |
| `roc` | ROC | 価格変化率 | [ROC.md](ROC.md) |

### Trend（トレンド系）

| ID | 名称 | 役割 | 定義 |
|----|------|------|------|
| `sma` | SMA | トレンド方向の判定（主軸） | [SMA.md](SMA.md) |
| `ema` | EMA | トレンド方向の判定（反応重視） | [EMA.md](EMA.md) |
| `dema` | DEMA | 高速移動平均（ラグ軽減） | [DEMA.md](DEMA.md) |
| `tema` | TEMA | 超高速移動平均（最小ラグ） | [TEMA.md](TEMA.md) |
| `aroon` | Aroon | トレンド強度と方向 | [AROON.md](AROON.md) |
| `adx` | ADX | **トレンドの強さ**を測定 | [ADX.md](ADX.md) |
| `psar` | Parabolic SAR | トレンド方向とストップレベル | [PSAR.md](PSAR.md) |
| `supertrend` | Supertrend | ATRベースのトレンドフォロー | [SUPERTREND.md](SUPERTREND.md) |
| `ichimoku` | 一目均衡表 | 総合トレンド分析 | [ICHIMOKU.md](ICHIMOKU.md) |

### Volatility（ボラティリティ系）

| ID | 名称 | 役割 | 定義 |
|----|------|------|------|
| `bb` | Bollinger Bands | ボラティリティと価格位置 | [BB.md](BB.md) |
| `atr` | ATR | ボラティリティ測定 | [ATR.md](ATR.md) |
| `kc` | Keltner Channel | ATRベースのバンド | [KC.md](KC.md) |

### Volume（出来高系）

| ID | 名称 | 役割 | 定義 |
|----|------|------|------|
| `obv` | OBV | 出来高の累積方向 | [OBV.md](OBV.md) |
| `vwap` | VWAP | 出来高加重平均価格 | [VWAP.md](VWAP.md) |
| `mfi` | MFI | 出来高加重RSI | [MFI.md](MFI.md) |
| `cmf` | CMF | 資金流入/流出強度 | [CMF.md](CMF.md) |

### Support/Resistance（サポレジ系）

| ID | 名称 | 役割 | 定義 |
|----|------|------|------|
| `pivot` | Pivot Points | 自動S/Rレベル計算 | [PIVOT.md](PIVOT.md) |

## インジケーター間の優先順位

矛盾時の判断ルール：

1. **SMA/EMA/Ichimoku（トレンド軸）** - 最優先。大局の方向を決定
2. **ADX（トレンド強度）** - トレンドの有無を判定。ADX<20ならレンジ戦略へ
3. **RSI/Stochastic/MFI（過熱軸）** - トレンドと逆行時は見送り推奨
4. **MACD/Aroon/Supertrend（変化兆候）** - 補助。単独判断禁止
5. **BB/KC/ATR（ボラティリティ）** - 補助。タイミング精度向上用
6. **OBV/CMF（出来高確認）** - 補助。トレンドの信頼性確認
7. **Pivot Points（サポレジ）** - 利確/損切りレベルの参考

## 共通ルール

- **単独判断禁止**: どのインジケーターも単独で売買判断しない
- **矛盾時は見送り**: トレンド系と過熱系が矛盾 → エントリー見送り推奨
- **Layer構造**: Layer1（生データ）→ Layer2（特徴量）→ Layer3（言語化）

## 定義ファイル構成

各インジケーター定義ファイルは以下の統一フォーマット：

1. **基本情報** - ID、カテゴリ、役割、出力範囲
2. **計算式** - 数式 + TypeScript実装例
3. **ユーザー設定** - パラメータ、デフォルト値、範囲
4. **マッチング特徴量** - 類似度判定に使用する特徴量
5. **類似度計算** - 重み配分と計算ロジック
6. **禁止事項** - 誤用防止ルール
