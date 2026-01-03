# TradeAssistant-AI（Side-B）

## プロジェクト概要

**TradeAssistant-AI** は、TradeAssist（Side-A）と連携する **AIベースのトレードプラン生成・仮想検証システム** です。

### コンセプト

> **「AIと一緒に成長するトレードノート」**

- AIが毎日のトレードプランを生成
- AIが仮想的にトレードを執行・記録
- AIが自己分析して学習を蓄積
- 人間はAIの知見を参考に、最終判断を自分で行う

---

## Side-A / Side-B の関係

```
┌─────────────────────────────────────────────────────────────┐
│                    TradeAssist エコシステム                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │     Side-A          │    │     Side-B          │        │
│  │   TradeAssist       │◄──►│  TradeAssistant-AI  │        │
│  │  （人間のノート）    │    │  （AIのノート）      │        │
│  └─────────────────────┘    └─────────────────────┘        │
│           │                          │                      │
│           ▼                          ▼                      │
│    実トレード記録              仮想トレード記録              │
│    人間の学び                  AIの学び                     │
│    戦略ルールの管理            プラン生成・検証              │
│                                                             │
│           └──────────┬───────────┘                         │
│                      ▼                                      │
│              相互参照・比較分析                              │
│              双方の成長に活用                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心的な差別化ポイント

### 1. 自動売買ではない
- AIは「仮想的に」トレードするだけ
- 実資金は動かない → 投資助言業規制を回避
- 人間が最終判断を行う

### 2. AIの強みをフル活用
| AIが担当 | 人間が担当 |
|---------|-----------|
| 大量のシナリオ検証 | 最終的な執行判断 |
| 24時間監視・記録 | リスク許容度の設定 |
| 過去パターンとの照合 | 相場の「空気」を読む |
| 感情なしの一貫した検証 | 「今日はやめとく」の判断 |

### 3. 知識の「見える化」
- AIの判断根拠がすべて記録される
- 成功/失敗の理由が分析される
- 人間が学べる形式で提示される

---

## 実装フェーズ

| Phase | 名称 | 内容 | 詳細 |
|-------|------|------|------|
| **A** | トレードプラン生成 | 毎朝AIがその日のプランを生成 | [phase-a-trade-plan.md](./phase-a-trade-plan.md) |
| **B** | 仮想トレード執行 | AIがプランに沿って仮想トレード | [phase-b-virtual-trading.md](./phase-b-virtual-trading.md) |
| **C** | AIトレードノート | 仮想トレード結果の記録・自己分析 | [phase-c-ai-trade-note.md](./phase-c-ai-trade-note.md) |
| **D** | 統合・相互参照 | Side-AとSide-Bの連携・比較分析 | [phase-d-integration.md](./phase-d-integration.md) |

---

## 1日の運用フロー（完成イメージ）

```
┌─────────────────────────────────────────────────────────────┐
│                       朝（市場開始前）                       │
├─────────────────────────────────────────────────────────────┤
│ 1. AI: 市場データ分析（レジーム判定、相関チェック等）        │
│ 2. AI: トレードプラン生成                                   │
│    「XAU/USDは上昇レジーム、3250でロング狙い」              │
│ 3. AI: 仮想エントリー条件を設定                             │
│ 4. 人間: AIプランを確認、参考にする                         │
├─────────────────────────────────────────────────────────────┤
│                       日中（市場時間）                       │
├─────────────────────────────────────────────────────────────┤
│ 5. AI: 条件達成で仮想エントリー執行                         │
│ 6. 人間: 自分の判断でリアルトレード（AIプラン参考）         │
│ 7. AI: 仮想ポジション監視、条件達成で仮想決済               │
├─────────────────────────────────────────────────────────────┤
│                       夜（市場終了後）                       │
├─────────────────────────────────────────────────────────────┤
│ 8. AI: AI用トレードノートに結果を記録                       │
│ 9. 人間: 実トレードの結果をノートに記録                     │
│ 10. AI: 自己分析「今日のプラン精度は68%、改善点は...」      │
│ 11. 人間: AI分析を参考に振り返り                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 技術スタック

Side-Aと共通の技術基盤を使用：

- **Backend**: Node.js + Express（既存API拡張）
- **Frontend**: Next.js（既存UI拡張）
- **Database**: PostgreSQL（新規テーブル追加）
- **AI**: OpenAI API（GPT-4 / Claude）
- **Market Data**: 既存のOHLCV取得機能を活用

---

## ドメインモデル（概要）

```typescript
// AIトレードプラン
interface AITradePlan {
  id: string;
  date: string;
  marketAnalysis: MarketAnalysis;
  scenarios: AITradeScenario[];
  overallConfidence: number;
  createdAt: Date;
}

// 市場分析
interface MarketAnalysis {
  regime: 'trend_up' | 'trend_down' | 'range' | 'volatile';
  keyLevels: { support: number[]; resistance: number[] };
  correlations: { symbol: string; correlation: number }[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

// AIトレードシナリオ
interface AITradeScenario {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entryCondition: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  rationale: string;  // AIの判断根拠
}

// 仮想トレード
interface VirtualTrade {
  id: string;
  scenarioId: string;
  entryTime: Date;
  entryPrice: number;
  exitTime?: Date;
  exitPrice?: number;
  status: 'pending' | 'open' | 'closed';
  pnl?: number;
}

// AIトレードノート
interface AITradeNote {
  id: string;
  date: string;
  planId: string;
  virtualTrades: VirtualTrade[];
  performance: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
  };
  selfAnalysis: string;  // AIの自己分析
  learnings: string[];   // 学んだこと
}
```

---

## 成功指標

### Phase A 完了時
- [ ] AIが毎朝トレードプランを生成できる
- [ ] プランがUIで確認できる

### Phase B 完了時
- [ ] 仮想トレードが自動執行される
- [ ] リアルタイムでポジション状況が確認できる

### Phase C 完了時
- [ ] AIトレードノートが自動生成される
- [ ] AIの自己分析が表示される

### Phase D 完了時
- [ ] Side-AとSide-Bのノートが相互参照できる
- [ ] 人間 vs AI のパフォーマンス比較ができる

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| AIのプラン精度が低い | 最初は「参考」として位置づけ、人間判断を優先 |
| API料金が高騰 | 1日1回のプラン生成に限定、キャッシュ活用 |
| 仮想と実際の乖離 | スリッページ・スプレッドを仮想でも考慮 |
| 過学習のリスク | 定期的に検証期間を設けて評価 |

---

## 関連ドキュメント

- [Side-A: README.md](../../README.md) - TradeAssist本体
- [Side-A: ARCHITECTURE.md](../ARCHITECTURE.md) - 既存アーキテクチャ
- [Side-A: NOTE.md](../../NOTE.md) - トレードノート仕様

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-04 | 初版作成 |
