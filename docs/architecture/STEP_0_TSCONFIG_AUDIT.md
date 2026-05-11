# STEP_0_TSCONFIG_AUDIT.md - tsconfig strict 強化監査

> **チケット**: Ticket B1
> **作成日**: 2026-05-12
> **対象**: ルート `tsconfig.json` と `src/frontend/tsconfig.json`
> **方針**: 既存エラーは**修正しない**。レポートのみ (KICKOFF.md §B1)

---

## 1. 適用したオプション

両 tsconfig は `strict: true` のみが有効だった。本チケットで以下の 3 オプションを追加した:

| オプション | 値 | 効果 |
|------------|----|----|
| `noUncheckedIndexedAccess` | `true` | 配列/オブジェクト index アクセス結果に `undefined` を含める |
| `noImplicitOverride` | `true` | クラスメソッド override に `override` キーワード必須 |
| `exactOptionalPropertyTypes` | `true` | optional プロパティに明示的 `undefined` を代入禁止 |

`strict: true` には `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict` が含まれる (公式仕様)。本チケットで追加した 3 オプションはこの strict 群に**含まれていない**追加項目である。

---

## 2. エラー件数

| プロジェクト | strict のみベースライン | 3 オプション追加後 | 差分 |
|-------------|-----------------------|-------------------|------|
| ルート (`tsconfig.json`) | 0 | **1044** | +1044 |
| Frontend (`src/frontend/tsconfig.json`) | 0 | **379** | +379 |
| **合計** | **0** | **1423** | **+1423** |

ベースラインがクリーン (0 errors) だったため、検出された 1423 件はすべて新規 3 オプション由来。

---

## 3. エラーコード別内訳

### ルート tsc (1044 errors)

| エラーコード | 件数 | 概要 | 起因オプション |
|-------------|------|------|--------------|
| TS18048 | 244 | `'X' is possibly 'undefined'` | `noUncheckedIndexedAccess` |
| TS2532 | 219 | `Object is possibly 'undefined'` | `noUncheckedIndexedAccess` |
| TS2375 | 150 | exactOptionalPropertyTypes 違反 (代入時) | `exactOptionalPropertyTypes` |
| TS2345 | 136 | Argument type mismatch | (連鎖的影響) |
| TS2322 | 117 | Type assignment mismatch | (連鎖的影響) |
| TS2379 | 91 | exactOptionalPropertyTypes 違反 (戻り値) | `exactOptionalPropertyTypes` |
| TS2412 | 34 | Property type mismatch with exactOptional | `exactOptionalPropertyTypes` |
| TS2339 | 25 | Property does not exist | (連鎖的影響) |
| TS7006 | 16 | Implicit any | (既存) |
| TS2538 | 6 | Cannot find name | (連鎖的影響) |

### Frontend tsc (379 errors)

| エラーコード | 件数 | 概要 | 起因オプション |
|-------------|------|------|--------------|
| TS2532 | 223 | `Object is possibly 'undefined'` | `noUncheckedIndexedAccess` |
| TS18048 | 90 | `'X' is possibly 'undefined'` | `noUncheckedIndexedAccess` |
| TS2375 | 20 | exactOptionalPropertyTypes 違反 (代入時) | `exactOptionalPropertyTypes` |
| TS2322 | 15 | Type assignment mismatch | (連鎖的影響) |
| TS2379 | 12 | exactOptionalPropertyTypes 違反 (戻り値) | `exactOptionalPropertyTypes` |
| TS2339 | 10 | Property does not exist | (連鎖的影響) |
| TS2345 | 9 | Argument type mismatch | (連鎖的影響) |

### 合計

| エラーコード | 合計件数 | 起因 |
|-------------|---------|------|
| TS2532 + TS18048 | **776 (54.5%)** | `noUncheckedIndexedAccess` |
| TS2375 + TS2379 + TS2412 | **307 (21.6%)** | `exactOptionalPropertyTypes` |
| その他 (連鎖的影響など) | **340 (23.9%)** | TS2345, TS2322, TS2339, TS7006 等 |

`noImplicitOverride` 起因のエラーコード (TS4114) は 0 件。影響は限定的。

---

## 4. 影響範囲 (ファイル別 Top 10)

### ルート tsc (Top 10)

| 件数 | ファイル | カテゴリ |
|------|---------|---------|
| 79 | `src/backend/api/strategyRoutes.ts` | API |
| 63 | `src/backend/services/strategyComparisonService.ts` | Service |
| 51 | `src/backend/services/matching/matchEvaluationService.ts` | Service |
| 34 | `src/services/tradeDefinitionService.ts` | Service |
| 32 | `src/side-b/strategy_dsl/surrogateFitnessSimulation.ts` | **side-b** |
| 30 | `src/backend/services/walkForwardService.ts` | Service |
| 30 | `src/backend/api/marketAnalysisRoutes.ts` | API |
| 28 | `src/side-b/controllers/sideBController.ts` | **side-b** |
| 28 | `src/services/tradeNoteService.ts` | Service |
| 23 | `src/services/realtime/realtimeSimilarityService.ts` | Service |

### Frontend tsc (Top 10)

| 件数 | ファイル | カテゴリ |
|------|---------|---------|
| 183 | `lib/chartIndicators.ts` | ライブラリ (圧倒的多数) |
| 67 | `components/strategy/EntryPreviewMiniChart.tsx` | コンポーネント |
| 28 | `components/chart/DrawingOverlay.tsx` | コンポーネント |
| 22 | `components/layout/Sidebar.tsx` | レイアウト |
| 14 | `components/CandlestickChart.tsx` | コンポーネント |
| 13 | `components/chart/ChartPaneContainer.tsx` | コンポーネント |
| 6 | `components/side-b/ValidationReport.tsx` | コンポーネント (side-b 連携) |
| 6 | `components/side-b/HypothesisFilters.tsx` | コンポーネント (side-b 連携) |
| 4 | `components/strategy/StrategyForm.tsx` | コンポーネント |
| 4 | `__tests__/side-b/HypothesisFilters.test.tsx` | テスト |

### 観察

- **Frontend は `lib/chartIndicators.ts` 単独で 183 errors** (Frontend 全体の 48%)。配列アクセスを多用するチャートインジケーター実装が `noUncheckedIndexedAccess` で大きく影響を受けている
- ルートは API ルーティングと Service 層に集中。エッジ台帳・進化探索などの side-b 中核ロジックも 60 errors 程度を含む
- 連鎖的影響 (TS2345 / TS2322 / TS2339) は他の error を解消すれば自然に減る傾向がある

---

## 5. 推奨される対応

### 5.1 優先順位

KICKOFF.md §B1 の指示「side-b 優先で順次対応」に基づき、以下の優先順位を提案:

| 優先 | 範囲 | 件数 | 別 PR 提案 |
|------|------|------|----------|
| ★1 | `src/side-b/` 配下 (strategy_dsl, controllers 他) | ~60 (ルート) + ~10 (Frontend) | `fix(side-b): strict TS errors resolution` |
| 2 | `src/services/` (tradeDefinition / tradeNote / realtimeSimilarity) | ~85 | `fix(services): strict TS errors resolution` |
| 3 | `src/backend/services/` (strategyComparison / walkForward / matchEvaluation) | ~144 | `fix(backend-services): strict TS errors resolution` |
| 4 | `src/backend/api/` (strategyRoutes / marketAnalysisRoutes 他) | ~109 | `fix(backend-api): strict TS errors resolution` |
| 5 | Frontend `lib/chartIndicators.ts` (183 件、単一ファイル) | 183 | `fix(frontend): chartIndicators strict errors` (大きいので別 PR 推奨) |
| 6 | Frontend コンポーネント群 (EntryPreviewMiniChart 他) | 196 | `fix(frontend-components): strict TS errors` |

### 5.2 対応パターン (参考)

#### `noUncheckedIndexedAccess` (TS2532 / TS18048)
```typescript
// Before
const row = rows[0];
console.log(row.id);  // TS18048: 'row' is possibly 'undefined'

// After
const row = rows[0];
if (!row) throw new Error("rows is empty");
console.log(row.id);
```

#### `exactOptionalPropertyTypes` (TS2375 / TS2379)
```typescript
// 型定義
type ExitSettings = {
  takeProfit?: { value: number; unit: 'percent' };
  maxHoldingMinutes?: number;
};

// Before
const settings: ExitSettings = {
  takeProfit: { value: 1, unit: 'percent' },
  maxHoldingMinutes: undefined,  // TS2375: undefined を明示代入は不可
};

// After (パターン A: 型に undefined を含める)
type ExitSettings = {
  takeProfit?: { value: number; unit: 'percent' } | undefined;
  maxHoldingMinutes?: number | undefined;
};

// After (パターン B: undefined のときは省略)
const settings: ExitSettings = {
  takeProfit: { value: 1, unit: 'percent' },
  // maxHoldingMinutes はキー自体を含めない
};
```

### 5.3 段階的解消方針

- **Step 0 完了時点では既存エラーを修正しない** (本 Phase の方針)
- Step 0 完了後、上記優先順 1〜6 を別 PR として順次解消
- 各 PR で `npx tsc --noEmit` を必須チェックとして PR ゲートに組み込む (Phase B Ticket B3 で扱う)
- side-b の不可侵領域 (EdgeLedger 昇格判定 / Evolution 探索) に触る変更は ADK_ADOPTION.md §6 のレビューを経る

### 5.4 オプションを「とりあえず無効化」しない

KICKOFF.md §B1 の禁止事項に従い、これらのオプションを後から `false` に戻すことはしない。1423 件を抱えたまま PR ゲートを有効化することになるが、Phase B Ticket B3 で CI ゲートを段階導入する際に「既存エラーは許容、新規エラーは error」のような baseline 戦略を検討する必要がある (これは Step 0 範囲外、Phase B 完了後に別議論)。

---

## 6. 監査スナップショット

- 計測日: 2026-05-12
- TypeScript バージョン: `package.json` 記載の devDependencies に従う (本書執筆時点では未確認、必要なら別途記録)
- 計測コマンド: `npx tsc --noEmit -p <tsconfig>` (ルート / src/frontend それぞれ)
- 生ログ: `tmp` 領域に保存 (PR には含めない、本書の数値が正)
