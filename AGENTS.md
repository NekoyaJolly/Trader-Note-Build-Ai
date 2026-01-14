# AGENTS.md - TradeAssist AI エージェント指示書

> **優先度**: 本ファイルは README.md よりも優先度が高いエージェント向け仕様書です。  
> **目的**: AI エージェントが迷わず安全に開発を進めるための公式ガイド。

---

## クイックスタート（最初に実行）

```bash
# 1. 依存関係インストール
npm install
cd src/frontend && npm install && cd ../..

# 2. 環境変数設定
cp .env.example .env
# .env を編集: DATABASE_URL, AI_API_KEY, MARKET_API_KEY

# 3. DB セットアップ
npm run prisma:generate
npm run prisma:migrate

# 4. 開発サーバー起動
npm run dev
# → Backend: http://localhost:3100
# → Frontend: http://localhost:3102
```

---

## 開発コマンド一覧

| コマンド | 説明 |
|----------|------|
| `npm run dev` | Backend(3100) + Frontend(3102) 同時起動 |
| `npm run dev:backend` | Backend のみ起動 |
| `npm run dev:frontend` | Frontend のみ起動 |
| `npm run build` | 本番ビルド |
| `npm test` | Jest テスト実行 |
| `npm run prisma:migrate` | DBマイグレーション |
| `npm run prisma:generate` | Prisma クライアント生成 |

---

## プロジェクト概要

**TradeAssist** は2つのサブシステムで構成される取引支援ツールです。

### Side-A: TradeAssist（人間用・MVP完成済み）
- トレード履歴からの**自動トレードノート生成**
- リアルタイム市場データとの**一致判定**
- 通知 + **発注支援 UI**（自動売買は禁止）

### Side-B: TradeAssistant-AI（AI用・計画中）
- AIによる日次トレードプラン生成
- 仮想トレード実行・記録
- AI用トレードノートによる学習ループ

> ⚠️ **重要**: 自動売買は一切行わない。判断の質を高める支援ツール。

---

## プロジェクト構造

```
/
├── AGENTS.md              # ← 今読んでいるファイル（エージェント指示書）
├── README.md              # プロジェクト概要・セットアップ
├── NOTE.md                # ★ドメイン仕様（ノート定義の正規リファレンス）
├── package.json           # npm スクリプト・依存関係
├── prisma/
│   └── schema.prisma      # DB スキーマ定義
├── src/
│   ├── index.ts           # エントリーポイント
│   ├── app.ts             # Express アプリ設定
│   ├── backend/           # Side-A バックエンド
│   │   ├── api/           # エンドポイント定義
│   │   ├── services/      # ビジネスロジック
│   │   └── tests/         # テストファイル
│   ├── controllers/       # リクエストハンドラ
│   ├── services/          # 共通サービス
│   ├── models/            # 型定義・スキーマ
│   ├── domain/            # ドメインロジック
│   ├── infrastructure/    # 外部接続（DB, API）
│   ├── routes/            # Express ルート定義
│   ├── middleware/        # Express ミドルウェア
│   ├── utils/             # ユーティリティ
│   ├── config/            # 設定ファイル
│   ├── frontend/          # Next.js フロントエンド
│   └── side-b/            # Side-B 実装予定ディレクトリ
├── docs/
│   ├── ARCHITECTURE.md    # ★実装仕様（NoteEvaluator等）
│   ├── API.md             # API仕様
│   ├── side-b/            # Side-B 設計ドキュメント
│   │   ├── TradeAssistant-AI.md
│   │   ├── phase-a-trade-plan.md
│   │   ├── phase-b-virtual-trading.md
│   │   ├── phase-c-ai-trade-note.md
│   │   └── phase-d-integration.md
│   └── phase{N}/          # 各フェーズの設計資料
├── indicators/            # インジケーター概念定義（実装は ARCHITECTURE.md 参照）
├── scripts/               # 運用スクリプト
└── data/                  # ローカルデータ（Git管理外推奨）
```

---

## 仕様ドキュメント参照先

| ドキュメント | 内容 | 優先度 |
|--------------|------|--------|
| [NOTE.md](NOTE.md) | ノートのドメイン仕様 | ★最優先 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | NoteEvaluator・Service連携 | 高 |
| [docs/API.md](docs/API.md) | REST API 仕様 | 高 |
| [docs/side-b/](docs/side-b/) | Side-B 設計ドキュメント | 中 |
| [indicators/README.md](indicators/README.md) | インジケーター概念思想 | 参考 |

> **ルール**: 実装前に必ず該当ドキュメントを確認。不明点があれば先に確認。

---

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| **Backend** | Node.js + Express + TypeScript |
| **Frontend** | Next.js 15+ (App Router) + TypeScript |
| **Database** | PostgreSQL + Prisma ORM |
| **Validation** | Zod（ランタイムバリデーション必須） |
| **AI** | OpenAI API（軽量モデル優先） |
| **Market Data** | Twelve Data API |
| **Notification** | Web Push (web-push) |
| **Task Queue** | BullMQ |

---

## 最重要ルール

### 1. 言語ルール（★最優先）

**すべての成果物は日本語で記述**

✅ 許可
- ソースコード内コメント: 日本語
- ドキュメント: 日本語
- コミットメッセージ: 日本語 OK

❌ 禁止
- 英語のみのコメント
- 日本語コメント無しでのロジック実装

**例外（英語可）**
- プログラミング言語の予約語
- ライブラリ固有の API 名
- 公式仕様で英語必須な設定キー

### 2. 型安全ルール

❌ **禁止**
- `any` 型の使用
- `unknown` 型の使用（明確な理由＋ユーザー許可がある場合のみ例外）
- 手動if文によるバリデーション（Zodを使用すること）

✅ **必須**
- 適切な型定義
- **Zodスキーマによるランタイムバリデーション**
- APIリクエスト/レスポンスは `src/schemas/` のZodスキーマを使用
- 外部API（OpenAI, Twelve Data等）のレスポンスはZodでパース
- AI出力は必ずZodで検証

### Zodスキーマ配置

```
src/schemas/
├── common.ts      # 共通スキーマ（日付、ページネーション等）
├── api/           # APIエンドポイント別スキーマ
│   ├── trade.ts
│   ├── note.ts
│   ├── profile.ts
│   └── sideB.ts
└── external/      # 外部APIレスポンススキーマ
    ├── twelveData.ts
    └── openai.ts
```

### Zodスキーマの書き方

```typescript
// src/schemas/api/profile.ts
import { z } from 'zod';

// リクエストスキーマ
export const CreateProfileRequestSchema = z.object({
  name: z.string().min(1, 'プロファイル名は必須です'),
  description: z.string().optional(),
  indicators: z.array(IndicatorConfigSchema),
});

// 型はスキーマから推論
export type CreateProfileRequest = z.infer<typeof CreateProfileRequestSchema>;

// ルートでの使用例
router.post('/', async (req, res) => {
  const result = CreateProfileRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.format() });
  }
  const data = result.data; // 型安全
});
```

### 3. 環境変数ルール

❌ **絶対禁止**
- API キーをコードに直接書く
- `.env` ファイルをコミット
- サンプルでも実値を含める

✅ **必須**
- `.env` ファイルで管理
- `.env.example` にはダミー値のみ

```env
DATABASE_URL=postgresql://user:password@localhost:5432/tradeassist
AI_API_KEY=sk-xxxx
MARKET_API_KEY=xxxx
```

---

## コーディング規約

### 関数・変数
- 意味が分かる命名
- 1ファイル1責務
- DRY 原則遵守

### コメント

**必須**: なぜこの処理が必要かを日本語で説明

✅ 良い例
```ts
// RSI が一定以下の場合のみエントリー候補とする
// 理由: 売られすぎ状態からの反発を狙うため
if (rsi < RSI_THRESHOLD) {
  // ...
}
```

❌ 悪い例
```ts
if (rsi < 30) {
  // ...
}
```

---

## テスト手順

### 実行コマンド
```bash
# 全テスト実行
npm test

# 特定ファイルのみ
npm test -- path/to/file.test.ts

# カバレッジ付き
npm test -- --coverage
```

### テストポリシー
- ロジック追加時は必ずテスト追加
- 一致判定ロジックは **正常系 / 境界値 / 異常系** を含める
- テストコメントも日本語

> ⚠️ テスト未実装の変更は **未完了扱い**

---

## Git ワークフロー

### ブランチ命名
```
feature/<機能名>
fix/<バグ名>
docs/<ドキュメント名>
```

### コミットメッセージ
```
feat: ノート一覧画面を追加
fix: 一致判定の閾値バグを修正
docs: AGENTS.md を更新
test: マッチングロジックのテスト追加
```

### 変更前の検証手順
```bash
# 1. ビルド確認
npm run build

# 2. テスト実行
npm test

# 3. 動作確認（必要に応じて）
npm run dev
```

---

## AI エージェントの行動制約

### ✅ Allowed（自由に実行可）
- ファイル読み取り
- コード生成（日本語コメント必須）
- テスト実行
- ビルド実行
- ドキュメント更新

### ⚠️ Ask First（人間確認必須）
- 新規ライブラリ追加（package.json 変更）
- DBスキーマ変更（prisma/schema.prisma）
- git push / release
- 本番デプロイ
- 大規模リファクタリング

### ❌ Forbidden（絶対禁止）
- 自動売買ロジックの実装
- 実際の取引所への注文送信
- 本番環境への無断デプロイ

---

## AI推論品質ガイドライン

AIエージェントが矛盾や誤推論を防ぐための品質基準。複雑な推論・判断が必要なタスクにおいて**必ず適用**すること。

### 1. Self-Verification（出力前矛盾チェック）

**必須対象**: 複数の選択肢・解釈を提示する場合

**実行手順**:
1. 出力内容全体を確認し、以下の2点を矛盾チェック
   - **一貫性**: 書いた内容全体が矛盾なく一貫しているか
   - **指示適合性**: ユーザーの指示と矛盾していないか
2. 矛盾が見つかれば訂正してから出力
3. **1つの回答内で複数の矛盾する解釈を並べない**

**NG例**（矛盾）:
```
以下の3つの解釈が考えられます：
1. 4枚のカード配置
2. 2枚のPanel配置
3. ヘッダー行

→ コード例では解釈3を実装
```
問題: 複数の解釈を提示しながら、実装は1つだけ。ユーザーは選択肢をもらっていない。

**OK例**（一貫性あり）:
```
ユーザーの指示「1行表示している情報カード」は、
PanelコンポーネントをX軸に並べた表示を意図していると解釈します。

根拠: リアルタイム表示で同じLayout実装がある
実装: 〜
```

---

### 2. Uncertainty表示（推論事実の明示）

**基準**: 推測・推論が発生した時点で明示

**推論が起こるケース**:
- ドキュメントに明記されていない仕様の判断
- ユーザー指示が曖昧で解釈が必要
- コード内容から仕様を逆算する推測

**推論時の表現例**:
- ✅ 「これはコード内容からの推測ですが、〜」
- ✅ 「推論: ユーザーの意図は〜」
- ✅ 「推測: 〜の可能性があります」

**避けるべき表現**:
- ❌ 「明らかに〜」（推測を事実として提示）
- ❌ 「〜です」（根拠を明示しない推論）
- ❌ 「当然〜」（確信がない判断）

---

### 3. Backtracking（自己訂正）

**現実的制限**: ガードレール効果は限定的

本ガイドラインで「誤りに気づいたら停止する」と記載されているが、実際には実装を止めず最後まで進行する可能性が高い。

**代替案**:
- 実装完了後、出力前に矛盾が無いか最終チェック（Self-Verificationで補完）
- 複雑なタスクではユーザーに選択肢を提示し、判断を委譲する

---

## トラブルシューティング

### ポートが使用中の場合
```bash
npm run kill:ports
# または
lsof -ti :3100 | xargs kill -9
lsof -ti :3102 | xargs kill -9
```

### Prisma クライアント未生成エラー
```bash
npm run prisma:generate
```

### Frontend ビルドエラー
```bash
cd src/frontend
rm -rf .next node_modules
npm install
npm run build
```

### テストがタイムアウトする場合
```bash
npm test -- --testTimeout=30000
```

---

## ドキュメント更新ルール

**必須**: 仕様変更・新機能追加時は関連ドキュメントを必ず更新

| 変更種類 | 更新対象 |
|----------|----------|
| ノート仕様変更 | NOTE.md |
| アーキテクチャ変更 | docs/ARCHITECTURE.md |
| API 変更 | docs/API.md |
| Side-B 関連 | docs/side-b/ 配下 |

---

## 補足情報

### 現在のテスト状況
- 全テスト: 566 テスト（541 パス、25 失敗 - cTrader 審査待ち）
- 最終確認: 2026/01/06

### 主要ポート
- Backend: 3100
- Frontend: 3102
- PostgreSQL: 5432（デフォルト）

### よく使うファイル
- エントリーポイント: [src/index.ts](src/index.ts)
- Express設定: [src/app.ts](src/app.ts)
- DBスキーマ: [prisma/schema.prisma](prisma/schema.prisma)
- フロントエンド: [src/frontend/](src/frontend/)
- cTrader認証: [src/backend/services/ctrader/ctraderAuthService.ts](src/backend/services/ctrader/ctraderAuthService.ts)
- セッション管理: [src/backend/services/auth/sessionService.ts](src/backend/services/auth/sessionService.ts)
- 認証コンテキスト: [src/frontend/contexts/AuthContext.tsx](src/frontend/contexts/AuthContext.tsx)
- リアルタイムワーカー: [scripts/run-realtime-worker.ts](scripts/run-realtime-worker.ts)

### 認証システム（cTrader OAuth 統合）
- **認証方式**: cTrader OAuth 2.0（email/password 認証は廃止）
- **セッション管理**: JWT（Cookie ベース、7日間有効）
- **マルチアカウント対応**: 複数 cTrader アカウントを1ユーザーに紐付け可能
- **ProtectedRoute**: 全ページに認証を適用（`/login`, `/auth/*` を除く）
- **主要エンドポイント**:
  - `GET /api/auth/ctrader/url` - OAuth 認証URLを取得
  - `POST /api/auth/ctrader/callback` - 認証コールバック処理
  - `GET /api/auth/me` - ログインユーザー情報取得
  - `POST /api/auth/logout` - ログアウト

### リアルタイム通知関連（Phase 2 完了）
- `CTraderProvider`: cTrader WebSocket 接続
- `RollingWindowService`: Tick→OHLCV 集約
- `RealtimeSimilarityService`: リアルタイム類似度チェック
- 詳細: [docs/realtime_similarity_notification_architecture.md](docs/realtime_similarity_notification_architecture.md)

---

> **最終更新**: 2026/01/06  
> **このファイルを信頼し、情報が不足している場合のみ追加の検索を行うこと。**

