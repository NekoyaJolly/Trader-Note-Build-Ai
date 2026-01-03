# Phase C: AIトレードノート

## 概要

Phase Cでは、仮想トレードの結果をAIが自動分析し、「AIトレードノート」として記録・蓄積する機能を実装する。

### 目的
- AIの仮想トレード結果を構造化して記録
- AIが自己分析を行い、学びを蓄積
- 人間が参考にできる知見をまとめる

---

## Side-A（人間のノート）との違い

| 項目 | Side-A（TradeNote） | Side-B（AITradeNote） |
|------|---------------------|----------------------|
| 作成者 | 人間 | AI |
| トレード | 実トレード | 仮想トレード |
| 分析 | 人間の振り返り | AIの自己分析 |
| 感情記録 | あり（心理状態） | なし（感情なし） |
| 学び | 人間の気づき | AIの統計的学習 |

---

## 機能要件

### 必須機能（MVP）

| ID | 機能 | 説明 |
|----|------|------|
| C-1 | ノート自動生成 | 仮想トレード決済時に自動でノート作成 |
| C-2 | 結果分析 | 勝敗の理由をAIが分析 |
| C-3 | パターン検出 | 過去のノートとの類似パターン検出 |
| C-4 | 学び抽出 | 成功/失敗から学びを言語化 |
| C-5 | ノート表示 | AIノートをUIで閲覧 |

### 追加機能（後続改善）

| ID | 機能 | 説明 |
|----|------|------|
| C-6 | 週次/月次サマリー | 期間ごとの振り返りレポート |
| C-7 | 傾向分析 | 時間帯/曜日/レジーム別の成績分析 |
| C-8 | 改善提案 | AIが次回プランへの改善を提案 |
| C-9 | ナレッジベース | 学びを検索可能なDBとして構築 |

---

## データモデル

### AITradeNote（AIトレードノート）

```typescript
interface AITradeNote {
  id: string;                       // UUID
  
  // 関連
  virtualTradeId: string;           // 仮想トレードID
  planId: string;                   // 元のプランID
  
  // 基本情報
  date: string;                     // YYYY-MM-DD
  symbol: string;
  direction: 'long' | 'short';
  
  // 結果サマリー
  result: {
    outcome: 'win' | 'loss' | 'breakeven';
    pnlPips: number;
    pnlPercentage: number;
    riskRewardActual: number;       // 実際のRR
    holdingDuration: number;        // 保有時間（分）
  };
  
  // エントリー分析
  entryAnalysis: {
    timing: 'good' | 'fair' | 'poor';
    priceVsPlan: number;            // 計画との乖離(pips)
    marketConditionAtEntry: string; // エントリー時の市場状況
    evaluation: string;             // AIの評価コメント
  };
  
  // 決済分析
  exitAnalysis: {
    type: 'take_profit' | 'stop_loss' | 'manual' | 'other';
    timing: 'optimal' | 'early' | 'late';
    missedPotential?: number;       // 逃した利益（pips）
    evaluation: string;
  };
  
  // プラン評価
  planEvaluation: {
    scenarioAccuracy: 'accurate' | 'partial' | 'inaccurate';
    levelAccuracy: 'accurate' | 'partial' | 'inaccurate';
    directionCorrect: boolean;
    evaluation: string;
  };
  
  // 市場分析
  marketReview: {
    regimeActual: string;           // 実際のレジーム
    regimePredicted: string;        // 予測したレジーム
    keyEventsImpact: string[];      // 影響したイベント
    volatilityNote: string;
  };
  
  // 学び
  learnings: {
    whatWorked: string[];           // うまくいったこと
    whatDidntWork: string[];        // うまくいかなかったこと
    keyInsight: string;             // 主要な気づき
    actionItems: string[];          // 次回への改善項目
  };
  
  // 類似パターン
  similarPatterns?: {
    noteId: string;
    similarity: number;             // 0-100
    outcome: 'win' | 'loss';
  }[];
  
  // メタ
  createdAt: Date;
  aiModel: string;
}
```

### AINoteSummary（期間サマリー）

```typescript
interface AINoteSummary {
  id: string;
  
  // 期間
  period: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
  
  // 統計
  statistics: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    averageWin: number;             // 平均勝ちpips
    averageLoss: number;            // 平均負けpips
    largestWin: number;
    largestLoss: number;
    totalPnl: number;
  };
  
  // 分析
  analysis: {
    bestPerformingSetup: string;    // 最も成功したセットアップ
    worstPerformingSetup: string;   // 最も失敗したセットアップ
    regimePerformance: {
      regime: string;
      winRate: number;
      avgPnl: number;
    }[];
    timeOfDayPerformance: {
      session: string;
      winRate: number;
      avgPnl: number;
    }[];
  };
  
  // 総括
  summary: {
    overallAssessment: string;      // 総合評価
    keyLearnings: string[];         // 期間の学び
    recommendations: string[];      // 改善推奨
    focusForNext: string;           // 次期間の焦点
  };
  
  createdAt: Date;
}
```

---

## ノート生成フロー

```
┌─────────────────────────────────────────────────────────────┐
│                    AIノート生成フロー                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. トリガー: 仮想トレード決済完了                            │
│     │                                                       │
│     ▼                                                       │
│  2. データ収集                                               │
│     ┌─────────────────────────────────────────────────┐     │
│     │ - 仮想トレード情報                               │     │
│     │ - 元のAIプラン                                   │     │
│     │ - 市場データ（エントリー〜決済間）               │     │
│     │ - 過去の類似ノート                               │     │
│     └─────────────────────────────────────────────────┘     │
│     │                                                       │
│     ▼                                                       │
│  3. AI分析実行                                              │
│     ┌─────────────────────────────────────────────────┐     │
│     │ - エントリー/決済タイミング評価                  │     │
│     │ - プラン精度評価                                 │     │
│     │ - 市場分析の振り返り                             │     │
│     │ - 学びの抽出                                     │     │
│     └─────────────────────────────────────────────────┘     │
│     │                                                       │
│     ▼                                                       │
│  4. ノート保存                                              │
│     │                                                       │
│     ▼                                                       │
│  5. ナレッジベース更新（パターン登録）                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## AIプロンプト設計

### ノート生成プロンプト（案）

```
あなたはプロフェッショナルなトレードアナリストです。
仮想トレードの結果を分析し、トレードノートを作成してください。

## 分析観点
1. エントリータイミングの評価（計画との乖離、市場状況）
2. 決済タイミングの評価（最適か、早すぎ/遅すぎか）
3. プランの精度評価（シナリオは正しかったか）
4. 市場分析の振り返り（レジーム判定は正しかったか）
5. 学びの抽出（次回に活かすべきポイント）

## 入力データ
【仮想トレード情報】
{virtualTradeData}

【元のAIプラン】
{originalPlan}

【市場データ（トレード期間中）】
{marketData}

【類似パターンの過去ノート】
{similarNotes}

## 出力形式
指定されたJSON形式で出力してください。
客観的かつ建設的な分析を心がけてください。
```

### 期間サマリープロンプト（案）

```
過去{period}のトレードノートを分析し、期間サマリーを作成してください。

## 分析観点
1. 統計的パフォーマンス評価
2. 最も効果的だったセットアップの特定
3. 改善が必要な領域の特定
4. レジーム別・時間帯別のパフォーマンス
5. 次期間への具体的な改善提案

## 入力データ
{periodNotes}

## 出力形式
指定されたJSON形式で出力してください。
```

---

## APIエンドポイント設計

### GET /api/side-b/ai-notes

AIトレードノート一覧を取得。

**Query Parameters:**
- `from`, `to`: 期間フィルター
- `outcome`: 結果フィルター（win, loss, breakeven）
- `symbol`: 銘柄フィルター

**Response:**
```typescript
{
  notes: AITradeNote[];
  total: number;
  stats: {
    winCount: number;
    lossCount: number;
    winRate: number;
  };
}
```

### GET /api/side-b/ai-notes/:id

特定のノート詳細を取得。

### GET /api/side-b/ai-notes/summaries

期間サマリー一覧を取得。

### POST /api/side-b/ai-notes/summaries/generate

期間サマリーを手動生成。

**Request:**
```typescript
{
  period: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
}
```

### GET /api/side-b/ai-notes/learnings

学びの一覧を取得（ナレッジベース検索）。

**Query Parameters:**
- `query`: 検索キーワード
- `category`: カテゴリフィルター

---

## UI設計

### AIノート詳細画面

```
┌─────────────────────────────────────────────────────────────┐
│  🤖 AIトレードノート #127                                    │
│  2026/01/04 | XAUUSD Long | 結果: +24 pips ✅              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  【結果サマリー】                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 勝敗: WIN │ +24 pips (+0.74%)                       │   │
│  │ 実RR: 1.8 │ 保有: 4時間23分                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【エントリー分析】                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ タイミング: ⭐⭐⭐ Good                              │   │
│  │ 計画価格: 3,240 → 実際: 3,242 (+2pips乖離)          │   │
│  │                                                     │   │
│  │ 評価:                                               │   │
│  │ サポートライン到達を待ってのエントリーは適切。      │   │
│  │ RSIの売られすぎ確認も良いタイミングだった。         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【決済分析】                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ タイプ: Take Profit │ タイミング: ⭐⭐ Early        │   │
│  │ 逃した利益: 12 pips                                 │   │
│  │                                                     │   │
│  │ 評価:                                               │   │
│  │ TP到達後も上昇継続。トレーリングストップの          │   │
│  │ 導入を検討すべき場面だった。                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【プラン評価】                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ シナリオ精度: ⭐⭐⭐ Accurate                        │   │
│  │ レベル精度: ⭐⭐⭐ Accurate                          │   │
│  │ 方向: ✅ 正解                                       │   │
│  │                                                     │   │
│  │ 評価:                                               │   │
│  │ 押し目買いシナリオが的中。サポートレベルの          │   │
│  │ 3,235-3,240ゾーンは正確に機能した。                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【学び】                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✅ うまくいったこと                                 │   │
│  │   ・マルチタイムフレーム分析によるサポート特定      │   │
│  │   ・RSIとの組み合わせでエントリー精度向上           │   │
│  │                                                     │   │
│  │ ❌ 改善点                                           │   │
│  │   ・固定TPでの利益機会損失                          │   │
│  │                                                     │   │
│  │ 💡 主要な気づき                                     │   │
│  │   トレンド相場では固定TPより、トレーリングストップ  │   │
│  │   の方が期待値が高い可能性がある。                  │   │
│  │                                                     │   │
│  │ 📋 次回アクション                                   │   │
│  │   ・トレーリングストップのルール検討                │   │
│  │   ・トレンド強度別のTP戦略を検証                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【類似パターン】                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ #089 (類似度: 87%) → WIN +18 pips                   │   │
│  │ #072 (類似度: 82%) → WIN +31 pips                   │   │
│  │ #051 (類似度: 78%) → LOSS -15 pips                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 期間サマリー画面

```
┌─────────────────────────────────────────────────────────────┐
│  📊 週次サマリー - 2026/W01 (12/30 - 01/05)                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  【パフォーマンス】                                          │
│  ┌────────┬────────┬────────┬────────┬────────┐            │
│  │トレード│ 勝率   │ PF     │ 合計   │ 最大DD │            │
│  │  21    │ 61.9%  │ 1.54   │+87pips │-34pips │            │
│  └────────┴────────┴────────┴────────┴────────┘            │
│                                                             │
│  【セットアップ別成績】                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🥇 押し目買い: 8勝2敗 (80%) +52 pips                │   │
│  │ 🥈 ブレイクアウト: 3勝2敗 (60%) +18 pips            │   │
│  │ 🥉 レンジ逆張り: 2勝4敗 (33%) -12 pips ⚠️          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【総評】                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 全体的に良好なパフォーマンス。特にトレンドフォロー  │   │
│  │ 系のセットアップが機能。一方、レンジ判定の精度に    │   │
│  │ 課題あり。レンジ相場でのトレード頻度を下げるか、    │   │
│  │ レンジ判定の精度向上が必要。                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【来週のフォーカス】                                        │
│  ・レンジ相場の判定精度向上                                 │
│  ・トレーリングストップの試験運用                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構造

```
src/side-b/
├── services/
│   ├── aiNoteService.ts            # ノート生成・管理
│   ├── noteAnalysisService.ts      # 分析ロジック
│   ├── patternMatchService.ts      # 類似パターン検出
│   └── summaryService.ts           # 期間サマリー生成
├── repositories/
│   ├── aiNoteRepository.ts
│   └── noteSummaryRepository.ts
├── controllers/
│   └── aiNoteController.ts
└── routes/
    └── aiNoteRoutes.ts

src/frontend/app/side-b/
├── ai-notes/
│   ├── page.tsx                    # ノート一覧
│   └── [id]/page.tsx               # ノート詳細
└── summaries/
    └── page.tsx                    # サマリー一覧
```

---

## データベーススキーマ

```sql
-- AIトレードノート
CREATE TABLE ai_trade_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  virtual_trade_id UUID REFERENCES virtual_trades(id),
  plan_id UUID REFERENCES ai_trade_plans(id),
  
  date DATE NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  
  -- 結果
  outcome VARCHAR(20) NOT NULL,       -- 'win' | 'loss' | 'breakeven'
  pnl_pips DECIMAL(10, 2),
  pnl_percentage DECIMAL(10, 4),
  
  -- 分析（JSONB）
  entry_analysis JSONB,
  exit_analysis JSONB,
  plan_evaluation JSONB,
  market_review JSONB,
  learnings JSONB,
  similar_patterns JSONB,
  
  ai_model VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 期間サマリー
CREATE TABLE ai_note_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period VARCHAR(20) NOT NULL,        -- 'daily' | 'weekly' | 'monthly'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  
  statistics JSONB NOT NULL,
  analysis JSONB NOT NULL,
  summary JSONB NOT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(period, start_date, end_date)
);

-- インデックス
CREATE INDEX idx_ai_notes_date ON ai_trade_notes(date);
CREATE INDEX idx_ai_notes_outcome ON ai_trade_notes(outcome);
CREATE INDEX idx_ai_summaries_period ON ai_note_summaries(period, start_date);
```

---

## 実装タスク

### バックエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 1 | 型定義（AITradeNote, Summary） | 高 | 1h |
| 2 | AIノートプロンプト設計 | 高 | 2h |
| 3 | AIノートサービス実装 | 高 | 3h |
| 4 | パターンマッチサービス実装 | 中 | 2h |
| 5 | サマリーサービス実装 | 中 | 2h |
| 6 | リポジトリ実装 | 中 | 2h |
| 7 | コントローラー実装 | 中 | 1h |
| 8 | テスト作成 | 中 | 2h |

### フロントエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 9 | ノート一覧ページ | 中 | 2h |
| 10 | ノート詳細ページ | 中 | 3h |
| 11 | サマリーページ | 中 | 2h |

---

## Phase B との連携

```typescript
// Phase B で仮想トレード決済時にノート生成をトリガー
async function onVirtualTradeClose(trade: VirtualTrade): Promise<void> {
  await aiNoteService.generateNote(trade);
}
```

---

## 成功基準

### Phase C 完了条件

- [ ] 仮想トレード決済時にノートが自動生成される
- [ ] AIの分析結果が構造化されて保存される
- [ ] 類似パターンが検出される
- [ ] ノートがUIで閲覧できる
- [ ] 週次サマリーが生成できる

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-04 | 初版作成 |
