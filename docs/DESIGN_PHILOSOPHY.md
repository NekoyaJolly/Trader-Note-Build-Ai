# TradeAssist 設計思想書

> **最重要原則**: 市場は「入力」、ノートは「評価器」

## 📋 目次

1. [設計思想の核心](#1-設計思想の核心)
2. [Side-A フロー](#2-side-a-フロー)
3. [ノートの可変性](#3-ノートの可変性)
4. [バックテスト統合方針](#4-バックテスト統合方針)
5. [実装ガイドライン](#5-実装ガイドライン)

---

## 1. 設計思想の核心

### 「市場は入力、ノートは評価器」

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                    市場データ（共通）                    │
│              ┌─────────────────────────┐               │
│              │  OHLCV + テクニカル指標  │               │
│              │  ・価格（OHLCV）         │               │
│              │  ・RSI, MACD, BB, MA... │               │
│              │  ・出来高                │               │
│              └───────────┬─────────────┘               │
│                          │                              │
│                          │  同じ市場データ              │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│    ┌─────────┐      ┌─────────┐      ┌─────────┐      │
│    │ ノートA │      │ ノートB │      │ ノートC │      │
│    │         │      │         │      │         │      │
│    │ RSI重視 │      │ MA重視  │      │ BB+RSI  │      │
│    │ 閾値70  │      │ GC/DC   │      │ 複合    │      │
│    │ 12次元  │      │ 8次元   │      │ 15次元  │      │
│    └─────────┘      └─────────┘      └─────────┘      │
│                                                         │
│    各ノートが「自分の見方」で市場を評価する              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### なぜこの設計か？

1. **ユーザーごとに手法・戦略が異なる**
   - あるトレーダーはRSIを重視
   - 別のトレーダーはMAクロスを重視
   - 同じ市場を見ても「良いエントリー」の定義が違う

2. **ノートは「そのトレードの成功パターン」を記録**
   - 特定のインジケーター組み合わせ
   - 特定の閾値
   - 特定の市場環境

3. **類似度 = 「今の市場がそのパターンにどれだけ近いか」**
   - ノートごとに異なる特徴量次元
   - ノートごとに異なる閾値
   - だから `NoteEvaluator` が必要

---

## 2. Side-A フロー

### 完全なユーザーフロー

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. ユーザートレード                                     │
│     └─ 実際のトレードを実行                             │
│                                                         │
│         ▼                                               │
│                                                         │
│  2. ノート化                                            │
│     └─ トレード + 市場状況 → 特徴量ベクトル化           │
│     └─ ユーザー定義のインジケーター設定を保存           │
│     └─ AI要約を生成                                     │
│                                                         │
│         ▼                                               │
│                                                         │
│  3. バックテスト（優位性検証）                          │
│     └─ 過去データでノートの有効性を検証                 │
│     └─ 勝率、PF、期待値を算出                          │
│     └─ 優位性があるパターンか判定                      │
│                                                         │
│         ▼                                               │
│                                                         │
│  4. 類似度判定（リアルタイム監視）                      │
│     └─ 現在の市場 vs ノートの特徴量                    │
│     └─ NoteEvaluator.evaluate() で評価                 │
│     └─ 閾値を超えたら「似ている」                       │
│                                                         │
│         ▼                                               │
│                                                         │
│  5. 通知                                                │
│     └─ 「過去の成功パターンに似ています」              │
│     └─ バックテスト結果も添付                          │
│                                                         │
│         ▼                                               │
│                                                         │
│  6. ユーザートレード（次のサイクルへ）                  │
│     └─ 通知を参考にトレード判断                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### フローの目的

| ステップ | 目的 | アウトプット |
|----------|------|-------------|
| 1. トレード | 実践からの学び | 取引履歴 |
| 2. ノート化 | パターンの記録 | TradeNote + 特徴量 |
| 3. バックテスト | 優位性の証明 | 勝率・PF・期待値 |
| 4. 類似度判定 | パターンの検出 | マッチスコア |
| 5. 通知 | 行動への橋渡し | アラート |
| 6. トレード | 学びの活用 | 改善されたトレード |

---

## 3. ノートの可変性

### 特徴量は固定ではない

```typescript
// ❌ 間違った理解
// 「すべてのノートが12次元の特徴量を持つ」

// ✅ 正しい理解
// 「各ノートは自分に必要な特徴量を持つ」

interface NoteEvaluator {
  // ノートが必要とするインジケーターを宣言
  requiredIndicators(): IndicatorSpec[];
  
  // 市場スナップショットからノート固有の特徴量を構築
  buildFeatureVector(snapshot: MarketSnapshot): number[];
  
  // 類似度計算
  similarity(vectorA: number[], vectorB: number[]): number;
  
  // 発火判定
  isTriggered(similarity: number): boolean;
}
```

### 実装クラス

| クラス | 用途 | 次元数 | 閾値 |
|--------|------|--------|------|
| `LegacyNoteEvaluator` | 既存ノート互換 | 12固定 | 0.8固定 |
| `UserIndicatorNoteEvaluator` | ユーザー定義 | 可変 | ユーザー設定 |

### なぜ可変が必要か

```
ユーザーA: 「RSI + MACDだけ見てる」
  → 特徴量: [rsi, macdHist, macdSignal] = 3次元
  
ユーザーB: 「ボリンジャーバンド重視」
  → 特徴量: [bbUpper, bbMiddle, bbLower, bbWidth, price] = 5次元
  
ユーザーC: 「複合分析派」
  → 特徴量: [rsi, macd, bb, sma20, sma50, sma200, atr, volume...] = 15次元
```

**固定次元だと、ユーザーの多様な手法を表現できない**

---

## 4. バックテスト統合方針

### 現状: 2つのバックテストシステム

| システム | 対象 | 評価方式 |
|----------|------|----------|
| `BacktestService` | TradeNote | NoteEvaluator（類似度） |
| `StrategyBacktestService` | Strategy | ConditionGroup（条件） |

### 統合方針

```
┌─────────────────────────────────────────────────────────┐
│             統合 BacktestEngine                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  入力: 評価器（Evaluator）                              │
│  ┌─────────────────────────────────────────┐           │
│  │  interface Evaluator {                   │           │
│  │    evaluate(snapshot): EvaluationResult  │           │
│  │  }                                       │           │
│  └─────────────────────────────────────────┘           │
│                                                         │
│  実装:                                                  │
│  ├─ NoteEvaluator（ノート用・類似度ベース）             │
│  └─ StrategyEvaluator（戦略用・条件ベース）             │
│                                                         │
│  共通機能:                                              │
│  ├─ OHLCVデータ取得                                    │
│  ├─ エントリー/エグジット判定                          │
│  ├─ TP/SL/タイムアウト処理                            │
│  ├─ 資金管理（破産判定）                               │
│  ├─ 2段階検証（Stage1→Stage2）                        │
│  └─ 結果統計（勝率、PF、DD、期待値）                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 統合後のフロー

```typescript
// 統合後のバックテスト呼び出し

// ノート用（類似度ベース）
const noteEvaluator = createNoteEvaluator(note);
const result = await backtestEngine.run({
  evaluator: noteEvaluator,
  ohlcvData,
  params: { takeProfit, stopLoss, ... }
});

// 戦略用（条件ベース）
const strategyEvaluator = createStrategyEvaluator(strategy);
const result = await backtestEngine.run({
  evaluator: strategyEvaluator,
  ohlcvData,
  params: { takeProfit, stopLoss, ... }
});
```

### 統合の優先順位

1. **共通インターフェース定義** - `Evaluator` interface
2. **結果統計の統一** - 同じ計算ロジック
3. **資金管理の追加** - BacktestServiceに破産判定追加
4. **2段階検証の追加** - Stage1→Stage2

---

## 5. 実装ガイドライン

### やるべきこと ✅

```typescript
// ✅ NoteEvaluator を使う
const evaluator = createNoteEvaluator(note);
const result = evaluator.evaluate(snapshot);

// ✅ 市場データは共通形式で取得
const snapshot = await marketDataService.getSnapshot(symbol);

// ✅ ノートの設定を尊重
const threshold = evaluator.getThreshold(); // ノートごとに異なる
```

### やってはいけないこと ❌

```typescript
// ❌ Service で類似度を直接計算
const similarity = cosineSimilarity(noteVector, marketVector);

// ❌ 固定の閾値を使う
if (similarity > 0.8) { ... }

// ❌ 固定の特徴量次元を前提にする
const vector = new Array(12).fill(0);
```

### 新機能追加時のチェックリスト

- [ ] 「市場は入力、ノートは評価器」の原則に沿っているか？
- [ ] NoteEvaluator 経由で評価しているか？
- [ ] 特徴量次元の可変性を考慮しているか？
- [ ] ユーザー定義の閾値を尊重しているか？

---

## 📚 関連ドキュメント

- [ARCHITECTURE.md](./ARCHITECTURE.md) - システムアーキテクチャ
- [precision-metrics.md](./precision-metrics.md) - 精度指標定義
- [MATCHING_ALGORITHM.md](./MATCHING_ALGORITHM.md) - マッチングアルゴリズム

---

## 📝 更新履歴

| 日付 | 変更内容 | 担当 |
|------|---------|------|
| 2026-01-14 | 初版作成 | - |

---

> **この設計思想に疑問がある場合は、必ず議論してから実装してください。**
> 
> 「市場は入力、ノートは評価器」は TradeAssist の根幹です。
