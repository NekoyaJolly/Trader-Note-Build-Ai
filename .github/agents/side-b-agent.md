# Side-B Agent（TradeAssistant-AI 実装担当）

## 目的

TradeAssistant-AI（Side-B）の実装を担当するAgent。
AIによる市場リサーチ・トレードプラン生成・仮想トレード実行を安全に実装する。

---

## 役割

### ✅ すること
- Side-B のバックエンド実装（`src/side-b/`配下）
- Side-B のフロントエンド実装（`src/frontend/app/side-b/`配下）
- AIプロンプトの実装・調整
- Zodスキーマによるバリデーション実装
- DBマイグレーション（Side-B用テーブル）
- テスト追加
- ドキュメント更新（`docs/side-b/`配下）

### ❌ しないこと
- **自動売買・自動発注の実装**（本プロジェクト最重要禁止事項）
- Side-A のコード改変（共通ライブラリ利用は可）
- 本番DBへの破壊的操作
- AIモデルの変更（gpt-4o, gpt-4o-mini 以外）
- 無断でのライブラリ追加

---

## 設計ドキュメント（必読）

| ドキュメント | 内容 |
|--------------|------|
| `docs/side-b/TradeAssistant-AI.md` | Side-B 全体概要 |
| `docs/side-b/phase-a-trade-plan.md` | Phase A 詳細設計（★最優先） |
| `docs/side-b/phase-b-virtual-trading.md` | Phase B 設計 |
| `docs/side-b/phase-c-ai-trade-note.md` | Phase C 設計 |
| `docs/side-b/phase-d-integration.md` | Phase D 設計 |

---

## AIアーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  Research AI (gpt-4o-mini) → DB → Plan AI (gpt-4o)     │
└─────────────────────────────────────────────────────────┘
```

### 責務分離
| AI | モデル | 責務 | コスト |
|----|--------|------|--------|
| Research AI | gpt-4o-mini | 市場データ構造化・12次元特徴量生成 | 〜$0.01 |
| Plan AI | gpt-4o | トレードシナリオ立案 | 〜$0.10 |

### DB経由パイプライン
- リサーチ結果を `market_research` テーブルにキャッシュ
- 有効期限内はキャッシュを使用（コスト削減）
- プランは `ai_trade_plans` テーブルに保存

---

## ディレクトリ構造

```
src/side-b/
├── controllers/
│   ├── researchController.ts
│   └── planController.ts
├── services/
│   ├── researchAIService.ts
│   ├── planAIService.ts
│   ├── aiOrchestrator.ts
│   └── promptBuilder.ts
├── models/
│   ├── featureVector.ts
│   ├── marketResearch.ts
│   ├── tradePlan.ts
│   └── schemas.ts
├── repositories/
│   ├── researchRepository.ts
│   └── planRepository.ts
└── routes/
    └── sideBRoutes.ts

src/frontend/app/side-b/
├── page.tsx
├── research/
│   ├── page.tsx
│   └── [id]/page.tsx
└── plans/
    ├── page.tsx
    └── [id]/page.tsx
```

---

## 実装順序（Phase A）

```
1. 型定義・Zodスキーマ
   └── src/side-b/models/

2. DBマイグレーション
   └── prisma/schema.prisma

3. Research AI
   ├── promptBuilder.ts
   ├── researchAIService.ts
   └── researchRepository.ts

4. Plan AI
   ├── promptBuilder.ts
   ├── planAIService.ts
   └── planRepository.ts

5. オーケストレーター
   └── aiOrchestrator.ts

6. API実装
   ├── controllers/
   └── routes/

7. フロントエンド
   └── src/frontend/app/side-b/

8. テスト
```

---

## 12次元特徴量

Side-Aと同じ基準で市場を評価するための特徴量ベクトル。

```typescript
interface FeatureVector12D {
  // トレンド系（4次元）
  trendStrength: number;        // 0-100
  trendDirection: number;       // 0-100 (50=横ばい)
  maAlignment: number;          // 0-100
  pricePosition: number;        // 0-100

  // モメンタム系（3次元）
  rsiLevel: number;             // 0-100
  macdMomentum: number;         // 0-100
  momentumDivergence: number;   // 0-100

  // ボラティリティ系（3次元）
  volatilityLevel: number;      // 0-100
  bbWidth: number;              // 0-100
  volatilityTrend: number;      // 0-100

  // 価格構造系（2次元）
  supportProximity: number;     // 0-100
  resistanceProximity: number;  // 0-100
}
```

---

## APIエンドポイント

### リサーチ
- `POST /api/side-b/research/generate` - リサーチ実行
- `GET /api/side-b/research/latest?symbol=XAUUSD` - 最新取得
- `GET /api/side-b/research/:id` - 詳細取得

### プラン
- `POST /api/side-b/plans/generate` - プラン生成
- `GET /api/side-b/plans` - 一覧取得
- `GET /api/side-b/plans/:id` - 詳細取得

---

## 品質基準

| 指標 | 基準 |
|------|------|
| リサーチ生成時間 | 10秒以内 |
| プラン生成時間 | 20秒以内 |
| AI出力パース成功率 | 95%以上 |
| テストカバレッジ | 新規コード80%以上 |

---

## Side-A 利用可能リソース

| 機能 | ファイル |
|------|---------|
| OHLCV取得 | `src/infrastructure/ohlcvRepository.ts` |
| インジケーター計算 | `src/services/indicatorService.ts` |
| OpenAI連携 | `src/services/openaiService.ts` |
| 認証 | `src/middleware/authMiddleware.ts` |

---

## 最重要ルール

1. **日本語**: コメント・ドキュメントは日本語
2. **型安全**: `any`/`unknown` 禁止、Zodでバリデーション
3. **コスト意識**: Research AI は gpt-4o-mini、Plan AI は gpt-4o
4. **キャッシュ活用**: リサーチは4時間キャッシュ
5. **自動売買禁止**: 仮想トレードのみ、実際の発注は絶対にしない

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-04 | 初版作成 |
