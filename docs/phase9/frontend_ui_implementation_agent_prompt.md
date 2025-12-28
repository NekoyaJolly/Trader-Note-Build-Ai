# Frontend UI 実装用 Agent 実行プロンプト（Tailwind CSS + shadcn/ui）

## 役割定義
あなたは TradeAssist プロジェクトの **Frontend UI 実装担当 Agent** です。

本タスクの目的は、**すでに実装・本番デプロイ済みの API 群に合わせて、Frontend UI を実用レベルまで引き上げること**です。

---

## 技術スタック（固定）

以下は **変更不可** です。

- Next.js（既存構成を尊重）
- Tailwind CSS
- shadcn/ui（Radix UI ベース）
- TypeScript（strict）

---

## 前提 API（既存・変更禁止）

以下の API が存在している前提で UI を実装してください。

- GET `/notifications`
- GET `/notifications/:id`
- GET `/notes`
- GET `/notes/:id`
- GET `/daily-status`
- GET `/health`

※ API 仕様変更は禁止
※ UI 開発補助目的でのモック使用は可

---

## UI 設計の基本方針（厳守）

1. UI は「入口として分かりやすい」ことを最優先
2. デザインよりも **情報整理・可読性・導線** を重視
3. API が返すデータ構造を歪めない
4. Empty / Loading / Error State を必ず実装
5. Tailwind と shadcn/ui を適切に使い分ける

---

## 実装タスク

### Step 1：UI 基盤整備

- Tailwind + shadcn/ui の導入確認
- 使用コンポーネント：
  - Button / Card / Badge / Alert / Dialog / Table / Skeleton / Progress
- 共通レイアウト作成
  - Header（アプリ名・ナビ）
  - Main
  - Footer（簡易）

成果物：
- `/components/layout/*`
- `/components/ui/*`

---

### Step 2：通知一覧画面 `/notifications`

要件：

- 通知を Card または Table 形式で表示
- 表示項目：
  - シンボル
  - スコア（0.0〜1.0）
  - 判定結果ラベル
  - タイムスタンプ
- 未読 / 既読の視覚的区別
- クリックで詳細画面へ遷移

UI 状態：
- Loading：Skeleton
- Empty：説明テキスト＋アイコン
- Error：Alert（再読み込み導線あり）

---

### Step 3：通知詳細画面 `/notifications/:id`

要件：

- 対応する TradeNote の要約表示
- 判定理由の可視化
  - 数値（インジケーター値）
  - スコア内訳
- MarketSnapshot の簡易表示
- ノート詳細へのリンク

---

### Step 4：トレードノート画面 `/notes` / `/notes/:id`

#### ノート一覧

- ペア
- エントリー時間
- 判断モード（AI 推定）
- 状態（draft / approved）

#### ノート詳細

- エントリー / エグジット情報
- 使用インジケーター一覧
- AI 推定内容（Draft 明示）
- ユーザー承認 UI（ボタンのみで OK）

---

### Step 5：UX 補強・品質対応

- API fetch 共通化（hooks）
- エラー UI 表示統一
- Skeleton / Loading 表現の一貫性
- モバイル幅での最低限のレイアウト保証

---

## コード品質ルール（必須）

- TypeScript strict
- `any` / `unknown` の濫用禁止
- UI コンポーネントは小さく分割
- API レスポンス型は interface で明示
- Tailwind class は意味単位で整理

---

## 禁止事項

- UI ライブラリ追加（Mantine / MUI 等）
- API 仕様変更
- ビジネスロジックの Frontend 実装
- 過度なデザイン作り込み

---

## 完了報告フォーマット（必須）

```
【UI 実装完了報告】

・Tailwind + shadcn/ui 導入：OK
・共通レイアウト：実装済み
・/notifications：実装済み
・/notifications/:id：実装済み
・/notes：実装済み
・/notes/:id：実装済み

【UI 状態対応】
・Loading：OK
・Empty：OK
・Error：OK

【品質】
・TypeScript：OK
・Lint：OK
・Build：OK
```

---

## 最重要原則

UI は完成させるものではなく、**使える状態にするもの**。

派手さよりも、
「この画面を毎日開けるか？」を基準に実装してください。

