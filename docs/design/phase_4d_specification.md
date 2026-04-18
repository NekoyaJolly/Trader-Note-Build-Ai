# フェーズ4d 発注仕様書: Side-B 検証UI 完全実装

> **期間目安**: 2〜3週間
> **目的**: Side-B 仮説検証システムの完全な UI を実装し、人間とAIの協業環境を完成させる
> **前提**: フェーズ1-3 完了、フェーズ4a 完了、フェーズ4b 縮小版 完了、フェーズ4c 完了
> **前提読み物**:
> - `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`
> - `docs/design/phase_4c_specification.md`(API仕様の前提)
> - `src/frontend/README.md`(既存フロントエンド構造)
> - `src/frontend/frontend_ui_architecture_specification`(UI 全体ポリシー)

---

## 0. このフェーズの位置づけ

### 0.1 UI 実装の哲学

このフェーズで実装するのは **人間(Side-A)と AI(Side-B)の協業環境の完成形**。既存の Side-A UI に干渉せず、Side-B 専用の画面群を新設する。

設計原則(既存 README.md より):
- **判断はユーザーが行う** ― UI は情報提供、決定は人間
- **UI は説明責任を果たす** ― AI の判断過程を人間が検証できる表示
- **「当たる」より「納得できる」** ― 結果だけでなく根拠の可視化

Side-B の UI はこの原則を特に強く適用する。仮説検証の各段階(screening → walkForward → montecarlo → buyAndHold)の全てを可視化し、**なぜその仮説が confirmed/rejected になったか** を人間が確認できる形にする。

### 0.2 既存 UI 資産の活用

既存資産として以下を全面活用する:

**UIライブラリ**:
- shadcn/ui ベースのコンポーネント群
- Card, Button, Badge, Alert, Progress, Skeleton
- NeonCard, NeonButton(Neon Dark テーマのカスタムコンポーネント)

**デザインシステム**:
- Neon Dark テーマ(slate-900 背景、slate-800 サーフェス、pink-500/violet-500 グラデーション)
- グラスモーフィズム効果、ホバーグロー、シマーエフェクト
- 統一されたフォントサイズとスペーシング

**技術スタック**:
- Next.js 16 App Router
- TypeScript
- Tailwind CSS

**既存ページ**:
- `/` Home
- `/backtest` バックテスト(Side-A 用、Phase 4d では触らない)
- `/notes` ノート一覧
- `/notifications` 通知
- `/strategies` 戦略
- その他

### 0.3 新設する Side-B UI 領域

```
/side-b                      新設、Side-B のランディング
/side-b/hypotheses           仮説一覧(台帳の可視化)
/side-b/hypotheses/[id]      仮説詳細(検証履歴、結果可視化)
/side-b/validation           検証画面(手動トリガー、進行中一覧)
/side-b/dashboard            ダッシュボード(台帳メトリクス、進化状況)
```

---

## 1. このフェーズのゴール

Side-B の仮説検証システムをブラウザから完全に操作・観察できる UI を提供する。人間が:
- 仮説一覧を閲覧できる
- 個別仮説の詳細(検証結果、レンズスナップショット、類似ノート)を確認できる
- 手動で仮説検証をトリガーできる
- 検証進行状況をリアルタイムに近い形で確認できる
- 検証完了後の統合レポート(4ツールの結果)を理解できる
- 台帳全体の成長をダッシュボードで把握できる

---

## 2. 完了条件

以下の全てを満たす:

- [ ] `/side-b` ランディングページが実装されている
- [ ] `/side-b/hypotheses` 仮説一覧画面が実装されている(フィルタ・ソート含む)
- [ ] `/side-b/hypotheses/[id]` 仮説詳細画面が実装されている
- [ ] `/side-b/validation` 検証画面が実装されている(手動トリガー可能)
- [ ] `/side-b/dashboard` ダッシュボードが実装されている
- [ ] 全画面が Neon Dark テーマで統一されている
- [ ] 既存の Side-A UI に一切の変更を加えていない
- [ ] レスポンシブ対応(デスクトップ・タブレット・モバイル)
- [ ] ローディング・エラー状態のハンドリング
- [ ] 既存コンポーネント(Card, Button, NeonCard等)を最大限活用
- [ ] 全新規コンポーネントにユニットテスト(最低限)
- [ ] 既存テスト全通過

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)

**ページ**:
- `src/frontend/app/side-b/page.tsx` (ランディング)
- `src/frontend/app/side-b/layout.tsx` (Side-B 共通レイアウト)
- `src/frontend/app/side-b/hypotheses/page.tsx`
- `src/frontend/app/side-b/hypotheses/[id]/page.tsx`
- `src/frontend/app/side-b/validation/page.tsx`
- `src/frontend/app/side-b/dashboard/page.tsx`

**コンポーネント(Side-B 専用)**:
- `src/frontend/components/side-b/HypothesisList.tsx`
- `src/frontend/components/side-b/HypothesisCard.tsx`
- `src/frontend/components/side-b/HypothesisDetail.tsx`
- `src/frontend/components/side-b/ValidationReport.tsx`
- `src/frontend/components/side-b/ValidationToolResult.tsx`
- `src/frontend/components/side-b/ValidationTrigger.tsx`
- `src/frontend/components/side-b/ValidationProgressBar.tsx`
- `src/frontend/components/side-b/LedgerStats.tsx`
- `src/frontend/components/side-b/HypothesisFilters.tsx`
- `src/frontend/components/side-b/StatusBadge.tsx`
- `src/frontend/components/side-b/LensSnapshotView.tsx`
- `src/frontend/components/side-b/DashboardCharts.tsx`

**API クライアント**:
- `src/frontend/lib/sideBApi.ts`

**型定義**:
- `src/frontend/types/sideB.ts`

**テスト**:
- `src/frontend/__tests__/side-b/` 以下に新規コンポーネントのテスト

### 触っていい(改修)
- `src/frontend/app/layout.tsx` ― ナビゲーションに Side-B リンク追加(最小限)
- `src/frontend/components/layout/` 内のナビゲーションコンポーネント ― Side-B エントリポイント追加

### 触ってはいけない
- `src/frontend/app/backtest/`(Side-A バックテスト UI、一切変更禁止)
- `src/frontend/app/notes/`(Side-A ノート UI)
- `src/frontend/app/strategies/`(戦略管理 UI)
- `src/frontend/app/notifications/`(通知)
- `src/frontend/app/settings/`(設定)
- `src/frontend/app/orders/`(注文)
- `src/frontend/components/` の既存コンポーネント(Side-A で使われるもの)
- `src/frontend/components/ui/` の既存コンポーネント(共通 UI は拡張のみ、既存変更禁止)
- バックエンドコード全般
- Phase 4c で実装済みの API(このフェーズでは API 呼び出し側のみ)

---

## 4. 実装仕様

### 4.1 Side-B ランディングページ

**Route**: `/side-b`

**役割**: Side-B エリアのハブ。4つのサブページへのナビゲーション。

**構成**:
```
Header: "Side-B: AI 自律検証システム"
Description: 1-2行の簡潔な説明

4つの NeonCard(グリッドレイアウト):
  - 仮説一覧 (hypotheses): アイコン 📋, purple
  - 検証実行 (validation): アイコン ⚙️, cyan
  - ダッシュボード (dashboard): アイコン 📊, green
  - 設定 (将来): アイコン ⚙️, slate(現時点ではコミングスーン扱い)

最下部: 現状サマリー
  - 総仮説数
  - confirmed 件数
  - 今週の新規仮説数
  - 直近検証完了時刻
```

**使用コンポーネント**: NeonCard, Card, Badge

### 4.2 仮説一覧画面

**Route**: `/side-b/hypotheses`

**役割**: EdgeLedger 内の全仮説を一覧表示、フィルタ・ソート・検索機能付き。

**構成**:

```
上部: HypothesisFilters
  - ステータスフィルタ(マルチセレクト): unverified / screening_passed / testing / confirmed / rejected / stale / insufficient_data / not_testable
  - カテゴリフィルタ: time / level / event / correlation / positioning / volatility / structure / other
  - ソースフィルタ: ai_generated / reflection / user_input / backtest / discovery
  - シンボルフィルタ: プロジェクトで扱うシンボル
  - 検索バー: statement に含まれるテキスト検索
  - ソート: 最新順 / 古い順 / 確信度順 / 観測数順

中央: HypothesisList
  - 各仮説を HypothesisCard として表示
  - 無限スクロール or ページネーション(20件ずつ)
  
カード内容(HypothesisCard):
  - ステータスバッジ(StatusBadge)
  - カテゴリバッジ
  - statement(短縮、40文字まで)
  - ソース表示
  - 観測数 / 勝率 / PF(あれば)
  - 最終検証日時
  - クリックで詳細ページへ
```

**状態管理**:
- フィルタ状態は URL query string に保存(ブックマーク可能)
- `useSearchParams` を使用

**使用コンポーネント**: 既存の Card, Button, Badge, Skeleton + 新規 HypothesisCard, StatusBadge, HypothesisFilters

**API**:
```typescript
GET /api/side-b/hypotheses?status=...&category=...&sort=...&page=...&limit=20
```

### 4.3 仮説詳細画面

**Route**: `/side-b/hypotheses/[id]`

**役割**: 個別仮説の全情報を表示。検証履歴、結果の可視化、類似ノート。

**構成**:

```
ヘッダー部:
  - ステータスバッジ(大)
  - statement(全文)
  - カテゴリ、ソース、作成日時
  - 観測実績サマリー(観測数、勝率、PF、平均RR)

検証ステータスセクション:
  - 現在のステータスを視覚化(ステップ UI):
    unverified → screening_passed → testing → confirmed/rejected
  - 各段階の完了時刻、結果サマリー

検証レポートセクション(ValidationReport):
  - 4つの検証ツール結果を並列表示
    - BacktestScreening
    - WalkForward
    - MonteCarlo
    - BuyAndHold
  - 各ツールは ValidationToolResult コンポーネント
    - Passed/Failed バッジ
    - 主要メトリクス
    - 解釈テキスト
    - 展開で詳細メトリクス

LLM 解釈セクション(confirmed/rejected の場合):
  - Strategist Agent の解釈
  - 改善提案(あれば)

条件セクション:
  - MachineReadableCondition[] を読みやすく表示
  - defaultRiskManagement 表示

レンズスナップショット:
  - 仮説登録時のレンズ出力を表示(LensSnapshotView)
  - 各レンズの主要特徴量

関連 Note:
  - materializedTradeNoteIds から取得した TradeNote へのリンク
  - relatedNoteIds から関連 AITradeNote へのリンク

アクションボタン:
  - 「再検証する」(手動トリガー、ValidationTrigger)
  - 「編集」(現時点では非表示、将来対応)
  - 「棄却する」(管理者のみ、手動 reject)
```

**使用コンポーネント**: Card, Badge, Progress, Alert + 新規多数

**API**:
```typescript
GET /api/side-b/hypotheses/:id
GET /api/side-b/hypotheses/:id/validation-history
POST /api/side-b/hypotheses/:id/validate
```

### 4.4 検証画面

**Route**: `/side-b/validation`

**役割**: 手動検証トリガー、進行中の検証一覧、検証待ちキュー。

**構成**:

```
セクション1: 検証待ち(screening_passed)
  - 一覧表示(HypothesisCard の軽量版)
  - 各カードに「今すぐ検証」ボタン
  - 全選択して「バッチ検証」ボタン(上限10件)

セクション2: 検証中(testing)
  - リアルタイム進捗表示(polling、10秒間隔)
  - 各検証の開始時刻、経過時間、実行中ツール
  - ValidationProgressBar コンポーネントで進行表示

セクション3: 最近の検証結果(過去24時間)
  - confirmed になった仮説(グリーン)
  - rejected になった仮説(レッド)
  - 各結果のサマリー

セクション4: 手動検証実行エリア
  - 仮説 ID 入力(または画面1から選択)
  - 「検証開始」ボタン
  - 開始後、進行状況をリアルタイム表示
```

**Polling 仕様**:
- testing 状態の仮説があれば10秒ごとにステータス更新
- 全仮説が completed になったらpolling停止
- ブラウザタブ非アクティブ時は polling 間隔を60秒に伸ばす

**使用コンポーネント**: Card, Button, Progress, Alert + 新規 ValidationTrigger, ValidationProgressBar

**API**:
```typescript
GET /api/side-b/hypotheses/pending-validation
GET /api/side-b/hypotheses/testing
GET /api/side-b/hypotheses/recently-validated?hours=24
POST /api/side-b/hypotheses/:id/validate
POST /api/side-b/hypotheses/batch-validate
GET /api/side-b/hypotheses/:id/validation-status
```

### 4.5 ダッシュボード

**Route**: `/side-b/dashboard`

**役割**: 台帳全体の成長・状態を可視化。

**構成**:

```
上段: KPI カード(4つ、LedgerStats コンポーネント)
  - 総仮説数
  - confirmed 数(成長率付き)
  - 今週新規仮説数
  - 直近の検証成功率

中段: グラフ群(DashboardCharts)
  - 時系列グラフ: 月別の confirmed 数推移
  - 円グラフ: ステータス別分布
  - バー: カテゴリ別 confirmed 数
  - ラインチャート: 日別の検証実行数

下段: 最近のアクティビティ
  - 最近 confirmed された仮説 Top 5
  - 最近 rejected された仮説 Top 5
  - Discovery AI の最新レポート(最新1件)

最下部: システム状態
  - Python Docker コンテナのヘルスチェック
  - 最後の日次検証ジョブ実行時刻
  - エラー件数(直近24時間)
```

**使用コンポーネント**: Card, Badge + 新規 LedgerStats, DashboardCharts

**グラフライブラリ**:
- 既存プロジェクトで使用しているもの(Recharts, Chart.js 等)を優先
- なければ Recharts を新規追加(軽量、React 親和性高)

**API**:
```typescript
GET /api/side-b/stats/overview
GET /api/side-b/stats/time-series?period=monthly&limit=12
GET /api/side-b/stats/by-category
GET /api/side-b/stats/validation-activity?days=30
GET /api/side-b/hypotheses/recent-confirmed?limit=5
GET /api/side-b/hypotheses/recent-rejected?limit=5
GET /api/side-b/discovery/latest
GET /api/side-b/system/health
```

**注意**: API の一部は Phase 4c では未実装の可能性がある。その場合、Phase 4d 着手時に不足 API をバックエンド実装する必要がある。詳細は 6. 実装順序で。

### 4.6 新規コンポーネント仕様

**StatusBadge**

```typescript
interface StatusBadgeProps {
  status: EdgeStatus;
  size?: 'sm' | 'md' | 'lg';
}

// ステータスごとの色マッピング:
// unverified: slate(グレー)
// screening_passed: blue(情報)
// testing: yellow(進行中、パルス効果)
// confirmed: green(成功)
// rejected: red(失敗)
// stale: orange(警告)
// insufficient_data: slate
// not_testable: slate(斜線)
```

**HypothesisCard**

```typescript
interface HypothesisCardProps {
  hypothesis: EdgeHypothesis;
  variant?: 'full' | 'compact';  // 一覧用とダッシュボード用
  onClick?: () => void;
  showActions?: boolean;
}
```

**ValidationToolResult**

```typescript
interface ValidationToolResultProps {
  toolName: string;
  result?: ValidationToolResult;
  expanded?: boolean;
}

// パスした場合: グリーン系のカード
// 失敗した場合: レッド系のカード
// 未実行の場合: グレー系のカード
// 展開時: 全メトリクスを表示
```

**ValidationProgressBar**

```typescript
interface ValidationProgressBarProps {
  hypothesisId: string;
  currentStage: 'screening' | 'walkForward' | 'monteCarlo' | 'buyAndHold' | 'completed';
  startedAt: Date;
}

// 4段階のプログレス表示(既存 Progress コンポーネント活用)
// 経過時間カウントアップ
```

**LensSnapshotView**

```typescript
interface LensSnapshotViewProps {
  snapshot?: {
    timestamp: string;
    features: Record<string, Record<string, number | string | boolean>>;
  };
  expandedLenses?: string[];  // 初期展開するレンズ
}

// レンズごとにアコーディオン表示
// 数値は適切にフォーマット(少数、パーセント)
// カテゴリ値はバッジで表示
```

**HypothesisFilters**

```typescript
interface HypothesisFiltersProps {
  currentFilters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  availableSymbols: string[];
}

// チェックボックスグループまたはセレクトで各フィルタ実装
// URL query string と同期
```

**DashboardCharts**

```typescript
interface DashboardChartsProps {
  stats: DashboardStats;
}

// 内部で複数のグラフを統合
// Recharts or 既存グラフライブラリで実装
// Neon Dark テーマに合わせた色設定
```

### 4.7 API クライアント

`src/frontend/lib/sideBApi.ts`

既存の `src/frontend/lib/api.ts` と似た構造で Side-B 専用 API ラッパーを実装。

```typescript
import { EdgeHypothesis, ConsolidatedValidationReport } from '@/types/sideB';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export const sideBApi = {
  // 仮説取得
  async listHypotheses(params: {
    status?: EdgeStatus[];
    category?: EdgeCategory[];
    source?: EdgeSource[];
    symbol?: string[];
    search?: string;
    sortBy?: string;
    page?: number;
    limit?: number;
  }): Promise<{ hypotheses: EdgeHypothesis[]; total: number }> {
    // fetch 実装
  },
  
  async getHypothesis(id: string): Promise<EdgeHypothesis> { /* ... */ },
  async getValidationHistory(id: string): Promise<ValidationHistory[]> { /* ... */ },
  
  // 検証トリガー
  async triggerValidation(id: string): Promise<{ jobId: string }> { /* ... */ },
  async batchValidate(ids: string[]): Promise<{ jobIds: string[] }> { /* ... */ },
  async getValidationStatus(id: string): Promise<ValidationStatus> { /* ... */ },
  
  // 一覧系
  async getPendingValidation(): Promise<EdgeHypothesis[]> { /* ... */ },
  async getTestingHypotheses(): Promise<EdgeHypothesis[]> { /* ... */ },
  async getRecentlyValidated(hours: number): Promise<EdgeHypothesis[]> { /* ... */ },
  
  // ダッシュボード統計
  async getOverviewStats(): Promise<OverviewStats> { /* ... */ },
  async getTimeSeriesStats(period: 'daily' | 'monthly', limit: number): Promise<TimeSeriesPoint[]> { /* ... */ },
  async getCategoryStats(): Promise<CategoryStat[]> { /* ... */ },
  async getValidationActivity(days: number): Promise<ActivityPoint[]> { /* ... */ },
  
  // その他
  async getLatestDiscovery(): Promise<DiscoveryReport | null> { /* ... */ },
  async getSystemHealth(): Promise<SystemHealth> { /* ... */ },
};
```

### 4.8 型定義

`src/frontend/types/sideB.ts`

バックエンドの型定義と厳密に一致させる。重複定義を避けるため、可能なら共通型パッケージ化を検討(このフェーズでは単純コピーで可)。

```typescript
export type EdgeStatus = 
  | 'unverified' 
  | 'screening_passed' 
  | 'testing' 
  | 'confirmed' 
  | 'rejected' 
  | 'stale' 
  | 'insufficient_data' 
  | 'not_testable';

export type EdgeCategory = 
  | 'time' | 'level' | 'event' | 'correlation' 
  | 'positioning' | 'volatility' | 'structure' | 'other';

export type EdgeSource = 
  | 'ai_generated' | 'reflection' | 'user_input' 
  | 'backtest' | 'discovery';

// ... EdgeHypothesis, ConsolidatedValidationReport, etc.
```

### 4.9 ナビゲーション統合

既存の `src/frontend/app/layout.tsx` やナビゲーションコンポーネントに Side-B への入口を追加。

**最小変更**:
- ヘッダーまたはサイドバーに「Side-B」リンク追加
- 既存のリンク構造を変えない

**見え方**:
- 既存メニューと並列に "Side-B" が追加される
- Side-B ロゴまたはアイコン(🤖 or 自作)で視覚的に区別

### 4.10 レスポンシブ対応

**ブレークポイント**(Tailwind デフォルト):
- sm: 640px
- md: 768px
- lg: 1024px

**対応方針**:
- デスクトップ(lg以上): フル機能、グリッドレイアウト
- タブレット(md-lg): グリッド縮小、一部機能簡略化
- モバイル(sm-md): カラム縦並び、フィルタは折りたたみ

**モバイル特有の対応**:
- HypothesisList のカードは縦スタック
- ValidationReport は Accordion 展開式
- ダッシュボードのグラフはモバイルで単純化

### 4.11 エラーハンドリング

**ローディング状態**:
- Skeleton コンポーネントを活用
- 既存の Skeleton スタイル(pulse animation)を継承

**エラー状態**:
- Alert コンポーネント(variant="destructive")でエラー表示
- ユーザー向けメッセージは日本語
- 詳細エラーは Dev Console に出力
- リトライボタン提供

**空状態**:
- 仮説ゼロ件の場合は「まだ仮説が登録されていません」とガイド
- Discovery や HypothesisGenerator の実行タイミングを案内

### 4.12 テスト

**必須テスト(最低限)**:
- HypothesisCard: 表示バリエーションの確認
- StatusBadge: 全ステータスの表示確認
- ValidationToolResult: passed/failed/未実行の表示確認
- HypothesisFilters: フィルタ変更が正しく反映されるか
- sideBApi: モック応答に対する正しいデータ変換

**省略可(時間次第)**:
- ページ全体の統合テスト
- E2E テスト

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- Side-A UI の改修(絶対禁止)
- 認証・権限制御(既存の仕組みがあればそれに乗る、なければ Phase 5+ で検討)
- リアルタイム WebSocket 通信(polling で十分)
- 仮説の編集・作成 UI(このフェーズでは閲覧と検証トリガーのみ)
- 実発注連携(Phase 7+)
- AI エージェントの詳細設定画面

### 5.2 デザインの一貫性

**必須事項**:
- 既存の Neon Dark テーマを厳守
- 既存コンポーネント(Card, Button, Badge等)を最大限活用
- 独自の色やフォントサイズを勝手に追加しない
- 既存の spacing パターン(p-3/p-4/p-6)を踏襲

**望ましい事項**:
- NeonCard, NeonButton は Side-B の「特別感」を演出するために積極活用
- グローエフェクトは重要アクション(検証トリガー等)で限定使用

### 5.3 URL 設計

```
/side-b                       ランディング
/side-b/hypotheses            一覧
/side-b/hypotheses?status=... フィルタ付き一覧
/side-b/hypotheses/[id]       詳細
/side-b/validation            検証画面
/side-b/validation?focus=...  特定仮説フォーカス
/side-b/dashboard             ダッシュボード
```

**URL 設計原則**:
- Path パラメータで主要なリソース指定
- Query string でフィルタ・ソート・ページ
- ブックマーク可能な形に

### 5.4 Polling のコスト配慮

検証中の仮説がある間 polling が走るが:
- 同時 polling は同一エンドポイント 1リクエスト/10秒
- 非アクティブタブでは 1/60秒 に減速
- 全仮説が completed になったら即座に stop

### 5.5 Phase 4c との API 整合性

Phase 4c 完了時点で UI が必要とする API が全て揃っているとは限らない。着手時に以下を確認:

- 全ての Side-B API エンドポイントのリスト
- 各エンドポイントのレスポンス形式
- 認証方式(必要なら)

不足している API があれば、Phase 4c 補完として軽微な追加実装が許される(この場合バックエンドファイルを触ることになる、事前に人間の確認取ること)。

### 5.6 翻訳(i18n)

**現時点**: 日本語のみ、ハードコーディング可
**将来**: i18n ライブラリ導入の余地を残す(テキストを定数化する程度)

### 5.7 パフォーマンス配慮

- 仮説一覧は最大100件/ページ
- ダッシュボードのグラフは SSR ではなく CSR(データ取得後にレンダリング)
- 画像最適化は Next.js の標準機能を使う

### 5.8 新規依存関係の追加

必要に応じて以下の追加を許可:
- グラフライブラリ(Recharts 推奨)
- date-fns(日付操作、既に入っていれば再利用)

**禁止**:
- 大きなUIフレームワーク(Ant Design 等)の追加
- 状態管理ライブラリ(Redux 等)の追加 ― React 標準で十分
- 既存と同等機能のライブラリ重複追加

---

## 6. 実装順序

Claude Code に推奨する実装順序:

### ステップ1: API クライアント + 型定義(最初)
1. `src/frontend/types/sideB.ts`
2. `src/frontend/lib/sideBApi.ts`
3. Phase 4c の API とすり合わせ、不足があれば人間に報告

### ステップ2: 共通コンポーネント
1. StatusBadge
2. HypothesisCard
3. ValidationToolResult
4. LensSnapshotView

### ステップ3: ランディング + 一覧(最小実装)
1. `/side-b/page.tsx`
2. `/side-b/hypotheses/page.tsx`
3. HypothesisFilters
4. **ここで一度動作確認**

### ステップ4: 仮説詳細
1. `/side-b/hypotheses/[id]/page.tsx`
2. ValidationReport の詳細表示

### ステップ5: 検証画面
1. `/side-b/validation/page.tsx`
2. ValidationProgressBar
3. ValidationTrigger
4. Polling 実装

### ステップ6: ダッシュボード
1. `/side-b/dashboard/page.tsx`
2. LedgerStats
3. DashboardCharts

### ステップ7: 統合調整
1. ナビゲーション追加
2. レスポンシブ調整
3. エラーハンドリング全面確認

各ステップ終了時にコミットする。これで途中で問題発生時に部分撤退しやすい。

---

## 7. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. 各画面のスクリーンショット(主要状態ごと):
   - ランディング
   - 仮説一覧(データあり、空状態)
   - 仮説詳細(confirmed, rejected, testing)
   - 検証画面(進行中あり、なし)
   - ダッシュボード
3. レスポンシブ確認のスクリーンショット(モバイル、タブレット)
4. 追加した npm 依存関係とそれぞれの選定理由
5. Polling 動作の確認ログ
6. 既存テスト全通過の確認
7. 新規テストの実行結果
8. Phase 5 への引き継ぎメモ(UI 拡張余地、検討事項)

---

## 8. レビュー観点

- 既存 Side-A UI に一切変更がないか(git diff で確認)
- Neon Dark テーマが全画面で一貫しているか
- 既存コンポーネント(Card, Button, NeonCard等)を適切に活用しているか(独自 UI 乱立していないか)
- Polling が意図した頻度で動いているか
- レスポンシブ対応が機能するか
- エラー・空状態・ローディングが全て適切に表示されるか
- 不要な JS バンドル肥大化がないか(import を適切に)
- URL が意図通り機能するか(ブックマーク・リロード)
- Phase 4c の API が正しく呼ばれているか

---

## 9. Phase 5 への引き継ぎ要件

Phase 4d 完了後、Phase 5(進化的探索)の設計に入る。その際:

- UI 拡張として「進化世代の可視化」「戦略集団の比較表示」が必要になる可能性
- 現時点では UI を具体化せず、Phase 5 実装時に検討
- 本フェーズで作ったコンポーネント群は Phase 5 でも流用可能な設計にしておく

引き継ぎメモに記載すべき項目:
- 将来拡張したくなりそうなUI要素のメモ
- 不足に気付いた API(あれば)
- デザインシステムで不足を感じた要素
