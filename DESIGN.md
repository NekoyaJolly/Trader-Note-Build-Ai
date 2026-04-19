# TradeAssist — デザイン仕様（DESIGN.md）

> フロントエンドの**見た目・トークン・プリミティブコンポーネント**の単一参照先。  
> ドメイン思想は [docs/DESIGN_PHILOSOPHY.md](docs/DESIGN_PHILOSOPHY.md)、アーキテクチャは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

---

## 1. この文書の目的

| 対象 | 使い方 |
|------|--------|
| 人間 | 新規画面・コンポーネント追加時に色・階層・CTA のブレを防ぐ |
| AI エージェント | 実装前にトークン／既存 UI を優先し、独自パレットを増やさない |

**やること**: 既存の `globals.css`・`components/ui/*` に合わせる。  
**やらないこと**: 理由なく新しい「メインアクセント」や別テーマを増やす（要仕様・本書更新）。

---

## 2. 参考にした公開情報（ベストプラクティスとの対応）

以下は **本リポジトリが公式に従う義務があるものではなく**、設計判断の参照として採用している。

### 2.1 OpenAI（Apps SDK / UI）

[UI guidelines（OpenAI Developers）](https://developers.openai.com/apps-sdk/concepts/ui-guidelines/) は **Tailwind・CSS 変数によるデザイントークン**、**アクセシビリティ**、**タイポ・余白・階層の一貫性**を推奨している。

TradeAssist は ChatGPT 内アプリではないため **表示モードやチャット UI のルールは直接適用しない**が、次は本プロジェクトでも同じ方向性とする。

- **トークン**: 意味のある名前（背景・本文・危険など）と生値（色コード）を分け、可能なら CSS 変数で集約する  
- **コントラスト**: 本文と背景は WCAG AA を意識する（ダーク UI では特に `text-gray-400` 系の薄さに注意）  
- **一貫性**: 主要 CTA・破壊的操作・補助操作の色を揃え、画面ごとに別ルールを増やさない  

### 2.2 デザイントークン一般（Primitives / Semantic）

コミュニティやオープンライブラリで整理されている **2 層構造**（生値 → 意味付きトークン）に沿って解釈する。

- **Primitives**: `#0F172A` のような具体値  
- **Semantic**: `--background`、`--danger` のように用途で参照  

実装は [src/frontend/app/globals.css](src/frontend/app/globals.css) の `:root` がセマンティック層に近い。Tailwind のユーティリティ（`slate-*` 等）はページ固有レイアウトで併用されている。

### 2.3 Google Material Design など

**Design tokens** という語の整理として [Material Design 3](https://m3.material.io/foundations/design-tokens/overview) の説明も参照可能（色・タイポ・形状のトークン化の考え方）。

---

## 3. ビジュアルアイデンティティ

| 項目 | 内容 |
|------|------|
| テーマ名 | **Neon Dark**（ダークベース + ピンク〜バイオレット系アクセント） |
| 質感 | ガラスモーフィズム（`glass` / `glass-strong` / `glass-surface`）、ネオングロー |
| 格納 | `globals.css` 先頭コメント・ユーティリティクラス |

---

## 4. デザイントークン（CSS 変数）

定義元: [src/frontend/app/globals.css](src/frontend/app/globals.css) の `:root`。

| トークン | 値（概要） | 用途 |
|----------|------------|------|
| `--neon-start` / `--neon-end` | `#EC4899` → `#8B5CF6` | ブランドグラデ・`neon-text`・装飾線 |
| `--neon-gradient` | 135deg 線形グラデ | ボーダー・テキスト |
| `--bg-dark` | `#0F172A` | `body` 背景相当 |
| `--surface-dark` | `#1E293B` | カード・パネル |
| `--border-dark` | `#334155` | 区切り |
| `--success` | `#22C55E` | 成功・利確イメージ |
| `--warning` | `#F59E0B` | 注意 |
| `--danger` | `#EF4444` | 危険・損・エラー |
| `--info` | `#3B82F6` | 情報（shadcn 互換 `--primary` にも使用） |
| `--text-primary` | `#FFFFFF` | 主本文 |
| `--text-secondary` | `#9CA3AF` | 補助 |
| `--text-muted` | `#6B7280` | さらに弱い補助 |

**shadcn 互換**（同ファイル）: `--background`, `--foreground`, `--card`, `--muted-foreground` など。新規で色を足す場合は **まずここにセマンティック名で追加**し、可能なら既存 Tailwind 参照と二重管理を避ける。

---

## 5. テキストカラー（Tailwind 併用の実態）

ページによって CSS 変数と Tailwind が混在する。よく使う **Tailwind テキスト**の意味づけ:

| クラス | 用途の目安 |
|--------|------------|
| `text-white` | 見出し・強調 |
| `text-gray-100` ~ `text-gray-300` | 本文・カード内 |
| `text-gray-400` | サブラベル・メタ情報 |
| `text-gray-500` ~ `text-gray-600` | さらに弱い説明 |
| `text-red-400` / `text-green-400` / `text-cyan-400` 等 | 損益・状態・リンク強調（意味を固定し使い回す） |

---

## 6. ボタン・CTA

### 6.1 `Button`（[src/frontend/components/ui/Button.tsx](src/frontend/components/ui/Button.tsx)）

| variant | 見た目 | 用途 |
|---------|--------|------|
| `default` | `pink-500` → `violet-500` グラデ、白字 | **主 CTA** |
| `secondary` | 緑系ボーダー + 半透明背景 | 承認・ポジティブ副次 |
| `destructive` | 赤系 | 削除・不可逆・危険 |
| `outline` | `slate` ボーダー | 副次 CTA |
| `ghost` | 背景ほぼなし | ターシャリ |
| `link` | `violet` アンダーライン | テキストリンク風 |

フォーカス: `ring-violet-500`、`ring-offset-slate-900`。

### 6.2 `NeonButton`（[src/frontend/components/ui/NeonButton.tsx](src/frontend/components/ui/NeonButton.tsx)）

`NeonCard` と同じ **`GlowColor`** で縁のグロー色が決まる。`solid` / `outline` / `ghost`。

---

## 7. カード・サーフェス・アラート

### 7.1 `Card`

- 背景 `slate-800`、ボーダー `slate-700`、文字 `gray-100`  
- ホバーで軽いヴァイオレット系シャドウ（仕様はコンポーネント内コメント参照）

### 7.2 `NeonCard` / グローカラー一覧

[src/frontend/components/ui/NeonCard.tsx](src/frontend/components/ui/NeonCard.tsx) の `GLOW_COLORS`:

| key | RGB（グロー） | グラデ（ホバー縁） |
|-----|----------------|-------------------|
| `blue` | 59,130,246 | blue → cyan |
| `purple` | 168,85,247 | purple → pink |
| `green` | 34,197,94 | green → emerald |
| `orange` | 249,115,22 | orange → amber |
| `pink` | 236,72,153 | pink → rose |
| `cyan` | 6,182,212 | cyan → teal |
| `slate` | 148,163,184 | slate |

ホームのメニューカード、Side-B ダッシュボードのクイックリンクなど **「行き先のカテゴリ」に合わせて色を揃える**。

### 7.3 `Alert`

| variant | 用途 |
|---------|------|
| `default` | 情報（slate 背景） |
| `destructive` | エラー・失敗（赤系） |

---

## 8. バッジ・トレンド系（ユーティリティクラス）

`globals.css` 内の `.badge-trend-up` / `down` / `neutral`、`.badge-decision-*` は **損益・判定表示**用。新規で同種 UI を作るときはクラス再利用を優先。

---

## 9. タイポグラフィ

| 項目 | 内容 |
|------|------|
| フォント | `Inter` 優先、フォールバック `system-ui` 系（`@theme inline`） |
| モノスペース | `ui-monospace` 系（シンボル・価格表示） |
| 実装の傾向 | 見出し `text-xl`〜`text-3xl`、本文 `text-sm`、注釈 `text-xs` / `text-[11px]` |

---

## 10. レイアウト・スペーシング

- **コンテナ**: 多くの画面で `max-w-lg`（ホーム）〜 `max-w-6xl`（ダッシュボード系）、`px-3 sm:px-4` 等  
- **角丸**: カード・ボタンは `rounded-xl` / `rounded-lg` が中心  
- **区切り**: `border-slate-700`、透明度付きボーダー（サイドバー等）

---

## 11. モーション

`globals.css` で定義: `animate-fade-in`, `animate-slide-up`, `animate-shimmer`, `animate-pulse-glow`, `stagger-children` など。

**原則**: 意味のあるフィードバック（表示・ホバー）に使い、長時間ループは控えめに。

---

## 12. コンポーネント群（ディレクトリマップ）

### 12.1 UI プリミティブ（`src/frontend/components/ui/`）

| コンポーネント | 役割 |
|----------------|------|
| `Button` | 標準 CTA（CVA バリアント） |
| `NeonButton` | ネオングロー付き CTA / リンク |
| `NeonCard` | ホーム・ダッシュボード用タイルリンク |
| `Card` (+ Header/Title/…) | 汎用サーフェス |
| `Alert` | インライン通知・エラー |
| `Badge` | 小ラベル |
| `Progress` | 進捗バー |
| `Skeleton` | ローディングプレースホルダ |

### 12.2 レイアウト（`src/frontend/components/layout/`）

`AppShell`, `Sidebar`, `Header`, `Footer`, `BottomNavigation`, `AuthLayoutWrapper`, `SideToggle` など。**ナビの色カテゴリ**（cyan / purple / green / slate）は `Sidebar.tsx` の `CATEGORY_COLORS` に定義。

### 12.3 ドメイン別（抜粋）

| パス | 内容の目安 |
|------|------------|
| `components/side-b/*` | 仮説・検証・台帳ダッシュボード・レポート |
| `components/strategy/*` | 戦略フォーム・プレビュー |
| `components/chart/*` | チャート枠・描画 |
| `components/trading/*` | ポジション・アカウント表示 |
| 直下の各種 `*Modal.tsx`, `*Panel.tsx` | ノート・バックテスト・インジケーター等 |

新規コンポーネントは **機能ドメインのフォルダ**へ置き、再利用可能な見たしは **`ui/` に昇格**を検討。

---

## 13. アクセシビリティ・インタラクション

- **フォーカス可視**: `Button` の `focus-visible:ring-*` を踏襲。独自ボタンでもキーボード操作を阻害しない。  
- **コントラスト**: ダーク背景 + 薄グレー文字の組み合わせは読みやすさを確認。  
- **押下フィードバック**: `press-scale` ユーティリティ（`globals.css`）。

---

## 14. 関連ファイル・ドキュメント

| ファイル | 内容 |
|----------|------|
| [src/frontend/app/globals.css](src/frontend/app/globals.css) | トークン・アニメーション・ガラス・バッジ |
| [docs/DESIGN_PHILOSOPHY.md](docs/DESIGN_PHILOSOPHY.md) | プロダクト設計思想（市場・ノート） |
| [docs/design/tradeassist_uiux_redesign_plan.md](docs/design/tradeassist_uiux_redesign_plan.md) | UI/UX 再設計（ワークスペース・導線・モバイルチャートファースト） |
| `docs/phase12/UI_DESIGN_GUIDE.md` | `globals.css` から参照あり（リポジトリに無い場合は本書を正とする） |

---

## 15. 変更時のチェックリスト

- [ ] 新しい色は `:root` に意味付きで足せるか検討した  
- [ ] 主 CTA / 危険操作が `Button` の意味と矛盾していない  
- [ ] `NeonCard` の `color` は既存キーから選べる  
- [ ] ドキュメント本文・コメントは日本語（プロジェクト規約）
