# TradeAssist MVP - UI 設計・デザインガイド

---

## 0. デザインコンセプト: "Focus & Immersion"

### 🎯 コンセプト概要

> **集中と没入 - トレーダーの思考を邪魔しない、プロフェッショナルなダークUI**

TradeAssist は **ダークモードをデフォルト** とし、ネオングラデーションをアクセントに使用した
「集中」と「没入」を促すデザインを採用します。

### 🖼️ デザインモックアップ

#### デスクトップ版（3カラムレイアウト）
```
┌─────────────────────────────────────────────────────────────────┐
│  TradeAssist                                                    │
├──────────┬──────────────────────────┬──────────────────────────┤
│ サイドバー │      メインコンテンツ      │      詳細パネル          │
│          │                          │                          │
│ 🏠 ホーム │  ダッシュボード            │  トレード詳細: USD/JPY   │
│ 🔔 通知  │  ┌────────────────────┐  │                          │
│ 📝 ノート │  │ 通知一覧          →│  │     ┌─────┐             │
│ 📥 インポート│  │ トレードノート    →│  │     │ 85  │ ← ScoreGauge│
│ ⚙️ 設定  │  │ ノートマッチング  →│  │     └─────┘             │
│          │  │ バックテスト一覧  →│  │  [順張り] [上昇トレンド]  │
│          │  └────────────────────┘  │                          │
│          │                          │  AI の分析               │
│          │  市場サマリー             │  現在の市場は上昇トレンド │
│          │  ┌────────────────────┐  │  にあり、RSIは高水準...  │
│          │  │  ┌───┐ 順張り     │  │                          │
│          │  │  │85 │ 上昇トレンド│  │  IndicatorChart          │
│          │  │  └───┘            │  │  ═══════════════════════ │
│          │  │  RSIは高水準を維持。│  │  RSI/MACD               │
│          │  └────────────────────┘  │                          │
└──────────┴──────────────────────────┴──────────────────────────┘
```

#### モバイル版（ボトムナビゲーション）
```
┌─────────────────────┐
│ ≡  TradeAssist  🔔¹ │
├─────────────────────┤
│                     │
│  通知一覧        →  │
│  トレードノート  →  │
│  ノートマッチング→  │
│  バックテスト一覧→  │
│                     │
│  市場サマリー       │
│  ┌───────────────┐  │
│  │ ┌──┐ 順張り   │  │
│  │ │85│上昇トレンド│  │
│  │ └──┘          │  │
│  │ 現在の市場は...│  │
│  └───────────────┘  │
│                 [+] │ ← FAB
├─────────────────────┤
│ 🏠   🔔   📝   ⚙️  │ ← ボトムナビ
│ホーム 通知 ノート設定│
└─────────────────────┘
```

---

## 1. UI に必ず実装が必要なページとコンポーネント

### 📄 ページ一覧

#### 現在実装済み ✅
| ページ | パス | 機能概要 | バックエンド連携 |
|--------|------|----------|------------------|
| ホーム | `/` | ダッシュボード、ナビゲーション | - |
| 通知一覧 | `/notifications` | 未読/既読通知、スコア表示 | `GET /api/notifications` |
| 通知詳細 | `/notifications/[id]` | 一致理由、スコアゲージ | `GET /api/notifications/:id` |
| ノート一覧 | `/notes` | トレードノートリスト | `GET /api/trades/notes` |
| ノート詳細 | `/notes/[id]` | AI 要約、承認フロー | `GET /api/trades/notes/:id`, `POST .../approve` |
| インポート | `/import` | CSV アップロード | `POST /api/trades/import/upload-text` |
| オンボーディング | `/onboarding` | 初回ユーザー導入 | - |

#### 追加実装が必要 🔧
| ページ | パス | 機能概要 | 対応 API |
|--------|------|----------|----------|
| **ダッシュボード拡張** | `/` | 統計サマリー、直近一致、未読数 | 複合クエリ |
| **発注確認画面** | `/orders/confirm` | 発注プリセット表示、確認フロー | `GET /api/orders/preset/:noteId`, `POST /api/orders/confirmation` |
| **マッチング履歴** | `/matching/history` | 一致判定履歴、フィルタリング | `GET /api/matching/history` |
| **設定画面** | `/settings` | 通知設定、閾値調整、タイムフレーム選択 | 新規 API |
| **インジケーター表示** | `/market/[symbol]` | RSI/MACD/BB 可視化 | `IndicatorService` |

---

### 🧩 コンポーネント一覧

#### 現在実装済み ✅
| コンポーネント | ファイル | 用途 |
|---------------|----------|------|
| `ScoreGauge` | `components/ScoreGauge.tsx` | 一致スコアの円形ゲージ |
| `MatchReasonVisualizer` | `components/MatchReasonVisualizer.tsx` | 一致理由の可視化 |
| `MarketSnapshotView` | `components/MarketSnapshotView.tsx` | 市場状況表示 |
| `OnboardingIntro` | `components/OnboardingIntro.tsx` | 初回導入オーバーレイ |
| UI 基盤 | `components/ui/*` | Alert, Badge, Button, Card, Progress, Skeleton |

#### 追加実装が必要 🔧
| コンポーネント | 用途 | 優先度 |
|---------------|------|--------|
| **`IndicatorChart`** | RSI/MACD/BB のチャート表示 | 高 |
| **`TrendBadge`** | 上昇/下降/横ばいトレンドバッジ | 高 |
| **`DecisionModeBadge`** | 順張り/逆張り/ニュートラル表示 | 高 |
| **`OrderPresetCard`** | 発注プリセット確認カード | 中 |
| **`FeatureVectorViz`** | 特徴量ベクトルの可視化（レーダーチャート） | 中 |
| **`NotificationBell`** | ヘッダー未読バッジ付き通知アイコン | 高 |
| **`TimeframePicker`** | 時間足選択（1h/4h/1d） | 中 |
| **`SymbolSelector`** | 銘柄選択ドロップダウン | 中 |
| **`StatCard`** | ダッシュボード統計カード | 中 |
| **`JobProgressBar`** | 再評価ジョブの進捗表示 | 低 |
| **`EmptyState`** | 空状態の共通コンポーネント | 高 |
| **`ErrorBoundary`** | エラーハンドリング共通化 | 高 |

---

## 2. デザインシステム: "Neon Dark"

### 🎨 カラーパレット

#### プライマリカラー（ネオングラデーション）
```css
/* Neon Gradient - メインアクセント */
--neon-gradient: linear-gradient(135deg, #EC4899, #8B5CF6);
/* Pink-500 → Violet-500 */

/* 使用箇所: ScoreGauge、アクティブ状態、重要なCTA */
```

#### ベースカラー
| 名前 | HEX | CSS変数 | 用途 |
|------|-----|---------|------|
| **Neon Gradient** | `#EC4899 → #8B5CF6` | `--neon-gradient` | スコアゲージ、アクティブ状態 |
| **Primary Blue** | `#3B82F6` | `--primary` | リンク、ボタン |
| **Success Green** | `#22C55E` | `--success` | 上昇トレンド、利益 |
| **Danger Red** | `#EF4444` | `--danger` | 下降トレンド、損失 |
| **Background** | `#0F172A` | `--bg-dark` | Slate-900、メイン背景 |
| **Surface** | `#1E293B` | `--surface-dark` | Slate-800、カード背景 |
| **Text Primary** | `#FFFFFF` | `--text-primary` | 見出し、重要テキスト |
| **Text Secondary** | `#9CA3AF` | `--text-secondary` | Gray-400、補足テキスト |

#### ダークモード専用パレット
```
Background:   #0F172A (Slate-900)    - アプリ全体の背景
Surface:      #1E293B (Slate-800)    - カード、パネル背景
Border:       #334155 (Slate-700)    - ボーダー、区切り線
Text Primary: #FFFFFF                 - 見出し、重要テキスト
Text Secondary: #9CA3AF (Gray-400)   - 補足、キャプション
Text Muted:   #6B7280 (Gray-500)     - 非活性テキスト
```

### 📝 タイポグラフィ

```css
/* 見出し階層 */
H1: 24px, bold      /* ダッシュボード */
H2: 20px, bold      /* 市場サマリー */
H3: 18px, medium    /* USD/JPY #123 */
Body: 14px, regular /* 本文テキスト */
Caption: 12px, gray /* スワイプで... */
```

| レベル | サイズ | ウェイト | Tailwind クラス |
|--------|--------|----------|-----------------|
| H1 | 24px | Bold | `text-2xl font-bold` |
| H2 | 20px | Bold | `text-xl font-bold` |
| H3 | 18px | Medium | `text-lg font-medium` |
| Body | 14px | Regular | `text-sm` |
| Caption | 12px | Regular | `text-xs text-gray-400` |

### 🧩 コンポーネントスタイル

#### ScoreGauge（スコアゲージ）
```
Large:  直径 120px - 詳細パネル、カード内
Small:  直径 64px  - リスト表示、コンパクト
Style:  ネオングラデーションのリング（円弧）
        中央に数値（bold）
        精度インジケーター（オプション）
```

#### TrendBadge（トレンドバッジ）
| 状態 | 背景色 | テキスト | アイコン |
|------|--------|----------|----------|
| 上昇トレンド | `bg-green-500/20` | `text-green-400` | ↑ |
| 下降トレンド | `bg-red-500/20` | `text-red-400` | ↓ |
| 横ばい | `bg-gray-500/20` | `text-gray-400` | → |

```tsx
// 実装例
<span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm">
  上昇トレンド
</span>
```

#### DecisionModeBadge（判断モードバッジ）
| モード | 背景色 | テキスト |
|--------|--------|----------|
| 順張り | `bg-blue-500/20` | `text-blue-400` |
| 逆張り | `bg-amber-500/20` | `text-amber-400` |
| ニュートラル | `bg-gray-500/20` | `text-gray-400` |

#### NotificationBadge（通知バッジ）
```
赤い丸 + 数字（未読数）
位置: アイコン右上
サイズ: 16px × 16px
```

### 🗂️ カード & リスト

#### Summary Card（サマリーカード）
```
┌─────────────────────────────────────┐
│  ┌───┐  順張り                      │
│  │85 │  DecisionModeBadge           │
│  └───┘  上昇トレンド                 │
│                                     │
│  現在の市場は上昇トレンドにあり、    │
│  RSIは高水準を維持。主要通貨ペアで   │
│  ボラティリティが増加しています。    │
│                         ↻ アーカイブ │
└─────────────────────────────────────┘

Style:
- 背景: Slate-800
- ボーダー: ネオングラデーション（1px）
- 角丸: 12px
- パディング: 20px
```

#### List Item Card（リストアイテム）
```
┌─────────────────────────────────────┐
│ 🔔  通知に応する                  ⋮ │
│     現在の市場は 日之を 通常支大願...│
│     3804 06-0.6m        ● ● ●      │
└─────────────────────────────────────┘
```

### 📊 IndicatorChart（インジケーターチャート）

#### RSI/MACD 表示
```
RSI/MACD
════════════════════════════════════
     ────────────────────────────  ← RSIライン（紫）
     ────────────────────────────  ← シグナルライン（緑）

MACD
     ▓▓▓▓▓▓▓▓▓▓▓▓                 ← プラス（緑）
                 ░░░░░░░░░░       ← マイナス（赤）
     ────────────────────────────  ← シグナルライン
```

#### MatchReasonVisualizer（一致理由バー）
```
────────────────────────── D  ← 満たした条件（緑/ピンク）
────────────────           D  ← 部分一致（黄）
──────                     D  ← 未達（グレー）
```

### 🧭 ナビゲーション

#### サイドバー（デスクトップ）
```
┌──────────────────┐
│ 🏠 ホーム        │ ← アクティブ: bg-slate-700
│ 🔔 通知一覧      │
│ 📝 ノート一覧    │
│ 📥 インポート    │
│ ⚙️ 設定         │
└──────────────────┘

アクティブ状態:
- 背景: Slate-700
- 左ボーダー: ネオングラデーション (3px)
```

#### ボトムナビゲーション（モバイル）
```
┌─────────────────────────────────┐
│  🏠      🔔      📝      ⚙️    │
│ ホーム   通知   ノート   設定   │
└─────────────────────────────────┘

アクティブ: アイコン + ラベルがネオンカラー
インジケーター: 上部に横線（ネオングラデーション）
```

### 🔘 ボタンスタイル

| タイプ | スタイル | 用途 |
|--------|----------|------|
| **Primary** | ネオングラデーション背景、白文字 | メインアクション |
| **Secondary** | 透明背景、ネオンボーダー、白文字 | サブアクション |
| **Icon (FAB)** | 円形、ネオングラデーション、+ アイコン | インポート追加 |

```tsx
// Primary Button
<button className="bg-gradient-to-r from-pink-500 to-violet-500 text-white px-6 py-3 rounded-lg">
  インポート
</button>

// Secondary Button
<button className="border border-pink-500 text-white px-6 py-3 rounded-lg hover:bg-pink-500/10">
  Secondary Button
</button>
```

---

## 3. レイアウト & レスポンシブ設計

---

## 3. レイアウト & レスポンシブ設計

### 📐 グリッドシステム

#### デスクトップ（lg: 1024px+）
```
3カラムレイアウト
├─ サイドバー: 240px（固定）
├─ メインコンテンツ: flex-1
└─ 詳細パネル: 400px（固定、条件付き表示）
```

#### タブレット（md: 768px - 1023px）
```
2カラム + オーバーレイ詳細
├─ サイドバー: 折りたたみ（ハンバーガーメニュー）
├─ メインコンテンツ: 100%
└─ 詳細パネル: スライドオーバー
```

#### モバイル（< 768px）
```
1カラム + ボトムナビ
├─ ヘッダー: ロゴ + ハンバーガー + 通知ベル
├─ メインコンテンツ: 100%
├─ FAB: 右下固定（インポートアクション）
└─ ボトムナビ: 4アイテム
```

### 📱 ブレークポイント

```css
/* Tailwind デフォルト */
sm: 640px   /* モバイル横向き */
md: 768px   /* タブレット縦 */
lg: 1024px  /* タブレット横 / 小型デスクトップ */
xl: 1280px  /* 標準デスクトップ */
2xl: 1536px /* 大型モニター */
```

### 📏 余白規則

| 要素 | サイズ | Tailwind |
|------|--------|----------|
| ページパディング | 24px | `p-6` |
| カード内パディング | 20px | `p-5` |
| コンポーネント間 | 16px | `gap-4` |
| セクション間 | 32px | `space-y-8` |
| リストアイテム間 | 8px | `gap-2` |

### ✨ マイクロインタラクション

| 要素 | アクション | アニメーション |
|------|------------|----------------|
| カード | ホバー | `shadow-lg` + ボーダーグロー |
| ボタン | クリック | `scale(0.98)` + `opacity(0.9)` |
| バッジ | 出現 | `fade-in` (200ms) |
| ScoreGauge | 更新 | 円弧アニメーション (500ms ease-out) |
| パネル | 開閉 | `slide-in-right` (300ms) |
| 通知 | 既読化 | opacity フェード → リスト更新 |

---

## 4. アプリケーションが持つイメージの言語化

### 🎯 コアコンセプト

> **「過去の自分から学び、未来の判断を磨く」**

TradeAssist は、単なる記録ツールではなく、**トレーダーの判断力を育てる伴走者**です。

### 🌙 デザインフィロソフィー: "Focus & Immersion"

| 要素 | 意図 |
|------|------|
| **ダークモード** | 長時間の市場監視で目の疲れを軽減 |
| **ネオングラデーション** | 重要な情報への視線誘導 |
| **控えめなアニメーション** | 思考を邪魔しない、落ち着いた動き |
| **高コントラスト** | 暗い環境でも視認性を確保 |
| **ミニマルなUI** | 必要な情報だけを、必要なときに |

### 💡 ブランドパーソナリティ

| 属性 | 表現 |
|------|------|
| **信頼性** | データは正確に、判断は慎重に |
| **シンプル** | 必要な情報だけを、必要なときに |
| **専門性** | プロトレーダーが使っても恥ずかしくない |
| **控えめ** | 主張しすぎず、ユーザーの邪魔をしない |
| **育成的** | 失敗を責めず、学びに変える |

### 🌊 ユーザー体験フロー

```
1. 静かな立ち上がり
   ├─ 派手なアニメーションなし
   ├─ 落ち着いたカラー
   └─ 必要最小限の情報表示

2. 信頼の積み上げ
   ├─ 過去トレードの可視化
   ├─ AI の推定結果を「提案」として表示
   └─ ユーザーが最終判断者であることを強調

3. 気づきの提供
   ├─ 「このパターン、前にも見た」
   ├─ 類似トレードからの学び
   └─ 自分の傾向を数値で把握

4. 行動の支援
   ├─ 発注確認で最終チェック
   ├─ 自動売買ではなく「意思決定サポート」
   └─ 責任はユーザーに、情報はアプリから
```

### 🎨 視覚的メタファー

| 要素 | メタファー | 表現方法 |
|------|-----------|----------|
| スコアゲージ | **コンパス** | 方向性を示すが、進むかはユーザー次第 |
| 通知 | **気づき** | 押し売りではなく、静かな提案 |
| トレードノート | **日記** | 振り返りの習慣化 |
| 類似検索 | **記憶の引き出し** | 過去の経験を呼び起こす |
| インジケーター | **道標** | 市場の現在地を示す |

### 📝 トーン & ボイス

#### 使用する表現
```
✓ 「このパターンは過去に5回出現しています」
✓ 「RSI が売られすぎ水準に近づいています」
✓ 「類似した状況での勝率は60%でした」
✓ 「判断の参考にしてください」
```

#### 避ける表現
```
✗ 「今すぐ買うべきです！」
✗ 「絶対に儲かる」
✗ 「この通りにすれば勝てます」
✗ 「AIが最適な答えを出しました」
```

### 🏛️ UI の全体的なトーン

```
医療機器のような信頼感
  × ゲームのような派手さ

プロ向けツールの機能性
  × 初心者向けの過保護さ

データに基づく冷静さ
  × 感情を煽る演出

習慣化を促す自然さ
  × 使用を強制する圧力
```

### 🎯 差別化ポイント

| 従来のトレードツール | TradeAssist |
|---------------------|-------------|
| リアルタイム執行重視 | 振り返り学習重視 |
| 利益最大化を約束 | 判断力向上をサポート |
| 複雑な機能の詰め合わせ | 必要な機能だけをシンプルに |
| 派手なチャート | 読みやすいデータ表示 |
| 自動売買推奨 | 人間の判断を尊重 |

---

## 5. 実装優先度マトリクス

### Phase 1（MVP 必須）
- [ ] ダークモードテーマ適用（globals.css）
- [ ] `ScoreGauge` ネオングラデーション対応
- [ ] `TrendBadge` / `DecisionModeBadge` 新規作成
- [ ] `NotificationBell`（ヘッダー未読バッジ）
- [ ] ボトムナビゲーション（モバイル）
- [ ] `EmptyState` 共通化
- [ ] ダッシュボード統計サマリー

### Phase 2（UX 向上）
- [ ] 3カラムレイアウト（詳細パネル）
- [ ] `IndicatorChart` コンポーネント（RSI/MACD）
- [ ] `MatchReasonVisualizer` 横バースタイル
- [ ] 発注確認画面 `/orders/confirm`
- [ ] マッチング履歴画面
- [ ] サイドバーアクティブ状態

### Phase 3（拡張機能）
- [ ] `FeatureVectorViz`（レーダーチャート）
- [ ] `JobProgressBar`
- [ ] 設定画面
- [ ] スワイプアクション（モバイル）
- [ ] FAB（フローティングアクションボタン）

---

## 6. API ↔ UI マッピング

| バックエンドサービス | UI コンポーネント |
|---------------------|------------------|
| `IndicatorService` | `IndicatorChart`, `TrendBadge` |
| `EnhancedAISummaryService` | ノート詳細の AI 要約セクション |
| `RevaluationJobService` | `JobProgressBar`, 設定画面 |
| `OrderController.generatePreset()` | `OrderPresetCard`, 発注確認画面 |
| `NotificationService` | `NotificationBell`, 通知一覧 |
| `MatchingService` | `ScoreGauge`, `MatchReasonVisualizer` |

---

## 7. CSS 変数定義（実装用）

```css
/* src/frontend/app/globals.css に追加 */

:root {
  /* Neon Gradient */
  --neon-start: #EC4899;
  --neon-end: #8B5CF6;
  --neon-gradient: linear-gradient(135deg, var(--neon-start), var(--neon-end));
  
  /* Dark Theme Colors */
  --bg-dark: #0F172A;
  --surface-dark: #1E293B;
  --border-dark: #334155;
  
  /* Semantic Colors */
  --success: #22C55E;
  --warning: #F59E0B;
  --danger: #EF4444;
  --info: #3B82F6;
  
  /* Text Colors */
  --text-primary: #FFFFFF;
  --text-secondary: #9CA3AF;
  --text-muted: #6B7280;
}

/* Neon Glow Effect */
.neon-glow {
  box-shadow: 0 0 20px rgba(236, 72, 153, 0.3),
              0 0 40px rgba(139, 92, 246, 0.2);
}

/* Neon Border */
.neon-border {
  border: 1px solid transparent;
  background: linear-gradient(var(--surface-dark), var(--surface-dark)) padding-box,
              var(--neon-gradient) border-box;
}

/* Score Gauge Ring */
.score-gauge-ring {
  stroke: url(#neonGradient);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s ease-out;
}
```

---

## 8. 参考デザインアセット

### モックアップファイル

1. **デザインシステム（コンポーネント一覧）**
   - Colors & Typography
   - Badges, Tags & Indicators
   - Cards & Lists
   - ボタン、ナビゲーション

2. **デスクトップダッシュボード**
   - 3カラムレイアウト
   - サイドバー + メイン + 詳細パネル

3. **モバイル/タブレット版**
   - Pattern B: "Focus & Immersion"
   - ボトムナビゲーション
   - FAB（フローティングアクションボタン）

### デザイントークン

```json
{
  "colors": {
    "neon": {
      "start": "#EC4899",
      "end": "#8B5CF6"
    },
    "background": {
      "dark": "#0F172A",
      "surface": "#1E293B"
    },
    "semantic": {
      "success": "#22C55E",
      "warning": "#F59E0B",
      "danger": "#EF4444"
    }
  },
  "typography": {
    "h1": { "size": "24px", "weight": "bold" },
    "h2": { "size": "20px", "weight": "bold" },
    "h3": { "size": "18px", "weight": "medium" },
    "body": { "size": "14px", "weight": "regular" },
    "caption": { "size": "12px", "weight": "regular" }
  },
  "spacing": {
    "page": "24px",
    "card": "20px",
    "component": "16px",
    "section": "32px"
  },
  "borderRadius": {
    "sm": "8px",
    "md": "12px",
    "lg": "16px",
    "full": "9999px"
  }
}
```
