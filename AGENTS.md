> ## 最優先 5 原則 (全エージェント / 全ディレクトリ共通)
> 1. **勝手に決めない**: 設計判断はユーザーに必ず確認する
> 2. **`any` 型も `unknown` 型も書かない** (テスト・スクリプトのみ例外。外部入力は Zod で即具体型に narrow する)
> 3. **指定範囲を超えない**: 「ついで」「ちなみに」の追加実装は禁止
> 4. **既存APIを壊さない**: 後方互換必須。破壊的変更はユーザー承認が必要
> 5. **ディレクトリ跨ぎ作業時は、対象ディレクトリの `AGENTS.md` を読み、必ずルート `/AGENTS.md` に戻る**

> **注記**: 本ファイル (ルート `/AGENTS.md`) では §5 を「ディレクトリ跨ぎ時の往復ルール」として記述している。サブディレクトリの `AGENTS.md` (例: `/src/side-b/AGENTS.md`) では同じ #5 を「このファイルを読んだ後、ルート `/AGENTS.md` も必ず読む」と記述しており、両者は意図的に対称 (どちらの方向にもルートに戻る) である。

---

# AGENTS.md - 全エージェント共通ルール (正本)

> **位置づけ**: 本ファイルが TradeAssist プロジェクトにおける全エージェント (Claude Code / Cursor / Gemini 等) 共通ルールの**単一の正本**である。
> **対象**: 全ディレクトリ・全作業者
> **シム**: `/CLAUDE.md` `/.cursorrules` `/GEMINI.md` は本ファイルを参照する誘導用シム

---

## このファイルの位置づけ

- 全エージェント・全ディレクトリで通用する規約 (G: Global) は本ファイルに集約する
- side-b 固有ルールは `/src/side-b/AGENTS.md` に分離 (本ファイルから読み込み義務)
- フロントエンド固有 UI ルールは `/DESIGN.md` (および将来 `/src/frontend/AGENTS.md`)
- ADK 段階導入の採用範囲・撤退基準は `docs/architecture/ADK_ADOPTION.md`

---

## 1. 読み込み義務

### 1.1 作業着手前

作業着手前に必ず以下を順番に読む:

1. **本ファイル** (`/AGENTS.md`) — 全エージェント共通の正本
2. **作業対象ディレクトリの `AGENTS.md`** — 該当する場合 (例: `/src/side-b/AGENTS.md`、`/src/side-b/adk/AGENTS.md`)
3. **`docs/architecture/ADK_ADOPTION.md`** — ADK 領域に触れる場合
4. **該当フェーズの設計書** — `docs/design/phase_N_specification.md` 等

### 1.2 ディレクトリ跨ぎ時

- サブディレクトリの `AGENTS.md` を読んだ後、**必ずルート `/AGENTS.md` に戻る**
- サブディレクトリ規約はルール上書きではなく**特化追加**

### 1.3 読了宣言

作業着手前に以下を宣言する:

> 「最優先5原則を確認しました。作業対象: {ディレクトリ}、フェーズ: {N}、チケット: {ID}」

---

## 2. TypeScript 型安全規約

**原則**: 型安全規約は本セクションで方針を述べ、**具体的な検出と強制は CI (ESLint + tsc) が行う**。

- **`any` 型を絶対に書かない** (最優先5原則 §2)
- **`unknown` 型も書かない** (最優先5原則 §2、tests/scripts のみ例外)
- **`@ts-ignore` `@ts-nocheck` を禁止する** (一切の例外なし)
- **`@ts-expect-error` は description (10 文字以上) 付きで限定的に許可** (テスト等の意図的な型エラー検証用途のみ)
- **外部入力 (API レスポンス、AI 出力、ユーザー入力) は必ず Zod でランタイム検証する**
- **手動 if バリデーションは使わない** (Zod スキーマで一元管理)

CI で `error` レベルで強制される ESLint ルールの詳細は §「CI で強制されているルール (参考)」を参照。

### 2.1 unknown 型禁止の確定方針 (2026-05-12)

**確定方針**: `unknown` 型は本番コード上では**禁止**する。例外は `**/*.test.ts`, `**/*.spec.ts`, `tests/**/*.ts`, `scripts/**/*.ts` のみ。型不明な外部入力は最初から Zod スキーマで具体型に narrow する。

**根拠**: 現行 `eslint.config.mjs` の `no-restricted-syntax` (`TSUnknownKeyword` を error 禁止) と整合する。規約を甘くすると最終的にエラーが多発する傾向にある (Nekoさん判断、2026-05-12 PR #155 マージ時)。

**Phase A 時点の暫定文言を Phase B Ticket B2 で確定したもの**: 旧版 (Phase A) では「unknown は許可するが即 narrow」「最終方針は Phase B でユーザー判断」と保留していた。Phase B Ticket B2 で案B (規約強化) を採用し、本 §2 / 最優先5原則 §2 / 各サブ AGENTS.md の冒頭 blockquote をすべて整合させた。

---

## 3. コード品質規約

### 3.1 関数・変数

- 意味が分かる命名 (省略形は避ける)
- 1ファイル1責務
- DRY 原則遵守

### 3.2 コメント

**原則**: なぜこの処理が必要かを日本語で説明する。コードが「何を」しているかはコード自体が説明する。

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

### 3.3 型定義

- 新規型は対象ドメインのディレクトリに配置 (例: side-b は `src/side-b/models/`)
- 既存型を拡張する場合は**オプショナルフィールドとして追加** (必須フィールド追加は破壊的変更)
- 型には JSDoc コメントを必ず付ける

### 3.4 Zod スキーマの配置

```
src/schemas/
├── common.ts      # 共通スキーマ (日付、ページネーション等)
├── api/           # API エンドポイント別スキーマ
│   ├── trade.ts
│   ├── note.ts
│   ├── profile.ts
│   └── sideB.ts
└── external/      # 外部 API レスポンススキーマ
    ├── twelveData.ts
    └── openai.ts
```

### 3.5 Zod スキーマの書き方

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

### 3.6 環境変数

❌ **絶対禁止**
- API キーをコードに直接書く
- `.env` ファイルをコミット
- サンプルでも実値を含める

✅ **必須**
- `.env` ファイルで管理
- `.env.example` にはダミー値のみ

---

## 4. 言語規約

**すべての成果物は日本語で記述する**。

✅ 許可
- ソースコード内コメント: 日本語
- ドキュメント: 日本語
- コミットメッセージ: 日本語 OK

❌ 禁止
- 英語のみのコメント
- 日本語コメント無しでのロジック実装

**例外 (英語可)**
- プログラミング言語の予約語
- ライブラリ固有の API 名 (関数名・型名)
- 公式仕様で英語必須な設定キー

---

## 5. ドキュメント運用ポリシー

### 5.0 ドキュメント増殖禁止 (最重要、2026-05-15 制定)

**新規 Markdown ドキュメントを作る前に、必ず以下を確認**:

1. 既存の設計正本 (HTML / `DESIGN_DOC_*.md`) に統合できないか
2. AGENTS.md / CLAUDE.md / README.md に統合できないか
3. チャット返信や PR description / PR comment で済まないか
4. TaskUpdate description で進捗集約できないか

**新規 .md 作成が許される条件**: 既存の単一ソース・オブ・トゥルース (= 設計正本) では構造的に表現できない、かつ後から繰り返し参照される情報。

**禁止パターン** (2026-05-15 に 83 件削除した教訓):
- `docs/architecture/STEP_*.md` (フェーズ作業ノート)
- `docs/design/phase_*.md` (各フェーズ仕様)
- `docs/design/pr_*.md` (PR プロンプト保存版)
- `docs/diagnostics/*.md` (障害調査履歴)
- `docs/review/*.md` (レビュー結果)
- 「KICKOFF」「SUMMARY」「NOTES」「AUDIT」系の繰り返し増殖パターン

**Why**: ドキュメント分散 → 単一ソース・オブ・トゥルース喪失 → 後から読んだ AI / 人間が認識ズレを起こす → 設計違反コード混入の温床になる。実例: 設計書 §1.4 で「Discovery は調査員」と明記、`prompts/discovery.md` で「仮説を出さない」と禁止していたのに、コードが仮説挿入していた (Phase D で発覚、PR #213 で修正)。

**正本**:
- HTML 設計書 `docs/architecture/side-b-architecture.html` (整備中)
- `DESIGN_DOC_autonomous_trading_architecture.md` (HTML 統合まで暫定)

進捗・分析・調査結果は **チャット / PR comment / TaskUpdate** で完結させ、md 化しないのが原則。

### 5.1 実装状況セクション運用

設計書 (特に `docs/architecture/ADK_ADOPTION.md` の §7 実装状況) は、Step / フェーズ単位で進捗を反映する。

- 各 Step 完了時に「完了」状態に更新し、完了日を記載
- 実装場所・検証結果を「完了した Step の詳細」セクションに追記
- Step 着手時に「進行中」状態に更新

### 5.2 別 PR 原則

実装と設計書更新は原則として**別 PR**にする。理由:
- 設計書の更新内容を独立にレビューできる
- 実装が差し戻された場合に設計書を巻き戻す必要がない

例外: Step 0 のように設計書のみを変更する作業はその限りでない。

### 5.3 変更種類別の更新対象

| 変更種類 | 更新対象 |
|----------|----------|
| ノート仕様変更 | `NOTE.md` |
| アーキテクチャ変更 | `docs/ARCHITECTURE.md` |
| API 変更 | `docs/API.md` |
| Side-B 関連 | HTML 設計書 (`side-b-architecture.html`、整備中)、暫定で `DESIGN_DOC_autonomous_trading_architecture.md` |
| ADK 採用範囲・実装状況 | `docs/architecture/ADK_ADOPTION.md` |

---

## 6. PR / コミット規約

### 6.1 ブランチ命名

```
feature/<機能名>
fix/<バグ名>
docs/<ドキュメント名>
chore/<作業名>
```

### 6.2 コミットメッセージ

```
feat: ノート一覧画面を追加
fix: 一致判定の閾値バグを修正
docs: AGENTS.md を更新
test: マッチングロジックのテスト追加
chore(step0): overwrite /AGENTS.md with global ruleset (Ticket A2)
```

Step 0 のチケット単位作業では `chore(step0): <内容> (Ticket {ID})` 形式を採用する。

### 6.3 変更前の検証手順

```bash
# 1. ビルド確認
npm run build

# 2. テスト実行
npm test

# 3. 動作確認 (必要に応じて)
npm run dev
```

UI / フロントエンド変更時は dev サーバーを起動し、ブラウザで golden path と edge case を実際に操作確認する (型チェック・テストだけでは feature correctness は確認できない)。

### 6.4 1ファイル1コミット原則 (設計書上書き時)

設計書を**上書き**する作業では、ファイルごとに別コミットにする。レビュー時に1ファイルずつ確認可能にするため。

---

## ドメイン原則 (自律トレーディング AI)

> **由来**: 旧 `/CLAUDE.md` の「Claude Code が守るべき6つの原則」を**文言を変えずに**移植したもの (Ticket A2)。これは Side-B 自律トレーディング AI に固有のドメイン原則であり、最優先5原則と併せて全エージェントが遵守する。

### 1. 既存コードを壊さない
新機能は**ラッパー**や**拡張**として足す。既存の MarketAnalysis, featureVector, AgentMemory, AITradeNote 等のデータ構造を破壊的に変更してはならない。後方互換は必須。

### 2. 指定されたフェーズ範囲を超えない
各フェーズには `phase_N_specification.md` がある。その **完了条件** を超える実装を勝手にしてはならない。「これもついでに作りました」は禁止。余計な作り込みはレビューコストを増やすだけ。

### 3. LLM の役割を拡張しすぎない
LLM には「構造の発見」「解釈」「学習」だけをさせる。「数値最適化」「統計処理」「客観判定」は Python または TypeScript の決定論的コードで実装する。安易に「LLMに判断させればいい」と設計しない。

### 4. レンズは独立・純粋に実装する
新しいレンズを追加する時、そのレンズは **副作用なし、他レンズへの依存なし、決定性あり** であること。レンズ同士の結合を作ると後で進化的探索が回らなくなる。

### 5. エッジ台帳への昇格は厳格に
エッジを `confirmed` に昇格させるコード上の判定は、以下の3条件 **全て** を満たす時だけ true を返す:
- 学習期間バックテスト PF > 1.5
- 検証期間(未知データ)PF > 1.3
- ウォークフォワード過学習スコア < 0.3

閾値は設計書で議論される場合のみ変更可。勝手に緩めない。

### 6. 人間語への翻訳を省略しない
AIが発見したパターンを記録する際、必ず人間語の `label` と `rationale` フィールドを埋める。翻訳できないパターンは採用しない。ブラックボックスを作らない。

### やってはいけないこと一覧

- 既存の `CORE_TRADING_RULES` の「インジケーター優先順位 1〜7」を守る前提でコードを書く (**これは撤廃方針**)
- 「エリオット波動のカウントを一意に決める」アルゴリズムを書く (**確率分布で扱う方針**)
- ユーザーに "エリオット ON/OFF" のスイッチを提供し、それで内部ロジックを分岐させる (**検索時重み付けで実現する方針**)
- LLM に「数値パラメーターを最適化させる」プロンプトを書く (**Python の役割**)
- ブラックボックスなクラスタリング結果を直接エッジ台帳に書き込む (**人間語翻訳必須**)
- 1回の作業で複数フェーズをまたぐ実装を行う (**フェーズごとに独立**)

---

## CI で強制されているルール (参考)

本セクションは**概要のみ**を記述する。具体的なルール一覧と詳細レポートは Phase B 完了後に `docs/architecture/STEP_0_ESLINT_AUDIT.md` および `docs/architecture/STEP_0_TSCONFIG_AUDIT.md` を参照。

CI で `error` レベルで強制 (PR ゲート):
- TypeScript: `tsc --noEmit` (`strict: true` を含む型安全オプションフル装備)
- ESLint: `@typescript-eslint/no-explicit-any`, `no-unsafe-*` 群, `ban-ts-comment` 他

→ Phase B 完了後に詳細表をここに統合する。

---

## AI エージェントの行動制約

### ✅ Allowed (自由に実行可)
- ファイル読み取り
- コード生成 (日本語コメント必須)
- テスト実行
- ビルド実行
- ドキュメント更新

### ⚠️ Ask First (人間確認必須)
- 新規ライブラリ追加 (`package.json` 変更)
- DB スキーマ変更 (`prisma/schema.prisma`)
- `git push` / release
- 本番デプロイ
- 大規模リファクタリング
- ブランチ保護ルール変更 (権限上不可)

### ❌ Forbidden (絶対禁止)
- 本番環境への無断デプロイ
- `.env` ファイルのコミット
- API キーをコードに直書き
- `// @ts-ignore` での型チェック抑止

---

## AI 推論品質ガイドライン

AI エージェントが矛盾や誤推論を防ぐための品質基準。複雑な推論・判断が必要なタスクにおいて**必ず適用**する。

### 1. Self-Verification (出力前矛盾チェック)

**必須対象**: 複数の選択肢・解釈を提示する場合

**実行手順**:
1. 出力内容全体を確認し、以下の2点を矛盾チェック
   - **一貫性**: 書いた内容全体が矛盾なく一貫しているか
   - **指示適合性**: ユーザーの指示と矛盾していないか
2. 矛盾が見つかれば訂正してから出力
3. **1つの回答内で複数の矛盾する解釈を並べない**

**NG 例** (矛盾):
```
以下の3つの解釈が考えられます:
1. 4枚のカード配置
2. 2枚のPanel配置
3. ヘッダー行

→ コード例では解釈3を実装
```
問題: 複数の解釈を提示しながら、実装は1つだけ。ユーザーは選択肢をもらっていない。

**OK 例** (一貫性あり):
```
ユーザーの指示「1行表示している情報カード」は、
Panel コンポーネントを X 軸に並べた表示を意図していると解釈します。

根拠: リアルタイム表示で同じ Layout 実装がある
実装: 〜
```

### 2. Uncertainty 表示 (推論事実の明示)

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
- ❌ 「明らかに〜」 (推測を事実として提示)
- ❌ 「〜です」 (根拠を明示しない推論)
- ❌ 「当然〜」 (確信がない判断)

### 3. Backtracking (自己訂正)

**現実的制限**: ガードレール効果は限定的

「誤りに気づいたら停止する」と記載しても、実際には実装を止めず最後まで進行する可能性が高い。

**代替案**:
- 実装完了後、出力前に矛盾が無いか最終チェック (Self-Verification で補完)
- 複雑なタスクではユーザーに選択肢を提示し、判断を委譲する

---

## 作業完了時セルフチェック

> **由来**: 旧 `/CLAUDE.md` の「作業完了時の自己チェックリスト」を文言保持で移植。

フェーズ・チケットの完了報告を行う前に、以下を確認する:

- [ ] 指定されたフェーズの完了条件を全て満たしているか
- [ ] 既存テストが全て通るか
- [ ] 新規コードにユニットテストを追加したか
- [ ] データ構造の破壊的変更を行っていないか
- [ ] エージェントのシステムプロンプトが外部ファイル化されているか (該当する場合)
- [ ] 設計書の禁止事項に抵触していないか
- [ ] ログ・ドキュメントを日本語で記述したか

---

## 困った時

> **由来**: 旧 `/CLAUDE.md` の「困った時」セクションを文言保持で移植。

- 設計の意図が分からない → `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` を読む
- フェーズの範囲が不明確 → `docs/design/phase_N_specification.md` を読む
- 既存コードの構造が分からない → 勝手に推測せず、ユーザーに確認する
- 新しい設計判断が必要 → 勝手に決めず、ユーザーに確認する

**「勝手に決めない」**。これが最重要 (最優先5原則 §1)。

---

# 開発運用情報

> 以下は本プロジェクトの運用情報 (環境構築・コマンド・ファイル参照等)。規約ではなく**参考情報**。
> 規約は本ファイル §1〜§6 およびドメイン原則を参照。

## クイックスタート

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

## 開発コマンド一覧

| コマンド | 説明 |
|----------|------|
| `npm run dev` | Backend(3100) + Frontend(3102) 同時起動 |
| `npm run dev:backend` | Backend のみ起動 |
| `npm run dev:frontend` | Frontend のみ起動 |
| `npm run build` | 本番ビルド |
| `npm test` | Jest テスト実行 |
| `npm run prisma:migrate` | DB マイグレーション |
| `npm run prisma:generate` | Prisma クライアント生成 |

## プロジェクト概要

**TradeAssist** は2つのサブシステムで構成される取引支援ツール。

### Side-A: TradeAssist (人間用・MVP 完成済み)
- トレード履歴からの**自動トレードノート生成**
- リアルタイム市場データとの**一致判定**
- 通知 + **発注支援 UI**

### Side-B: TradeAssistant-AI (AI 用・計画中)
- AI による日次トレードプラン生成
- 仮想トレード実行・記録
- AI 用トレードノートによる学習ループ
- **AI が自律的に市場を観察し、仮説を立て、検証し、エッジ台帳を育てながら運用する**システムへ段階的に進化させる (ドメイン原則を参照)

## プロジェクト構造

```
/
├── AGENTS.md              # 全エージェント共通ルール (本ファイル、正本)
├── CLAUDE.md              # Claude Code 固有シム
├── .cursorrules           # Cursor 固有シム
├── GEMINI.md              # Gemini 固有シム
├── DESIGN.md              # フロントエンドデザイン仕様
├── README.md              # GitHub 表示用 (最小限)
├── NOTE.md                # ノート定義の正規リファレンス
├── package.json
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── backend/           # Side-A バックエンド
│   ├── controllers/
│   ├── services/
│   ├── models/
│   ├── domain/
│   ├── infrastructure/
│   ├── routes/
│   ├── middleware/
│   ├── utils/
│   ├── config/
│   ├── schemas/           # Zod スキーマ
│   ├── frontend/          # Next.js フロントエンド
│   └── side-b/            # Side-B 実装 (AGENTS.md あり)
│       └── adk/           # ADK サイドカー (AGENTS.md あり)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── architecture/      # ADK 採用関連・Step 0 レポート群
│   │   ├── ADK_ADOPTION.md
│   │   └── STEP_0_*.md
│   ├── design/            # 設計書
│   │   └── DESIGN_DOC_autonomous_trading_architecture.md
│   └── side-b/            # Side-B 設計ドキュメント
├── indicators/
├── scripts/
└── data/                  # ローカルデータ (Git 管理外)
```

## 仕様ドキュメント参照先

| ドキュメント | 内容 | 優先度 |
|--------------|------|--------|
| [NOTE.md](NOTE.md) | ノートのドメイン仕様 | ★最優先 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | NoteEvaluator・Service 連携 | 高 |
| [docs/API.md](docs/API.md) | REST API 仕様 | 高 |
| [docs/design/DESIGN_DOC_autonomous_trading_architecture.md](docs/design/DESIGN_DOC_autonomous_trading_architecture.md) | Side-B 自律 AI 設計の正本 | 高 (Side-B 作業時) |
| [docs/architecture/ADK_ADOPTION.md](docs/architecture/ADK_ADOPTION.md) | ADK 段階導入の採用範囲・撤退基準 | 高 (ADK 領域作業時) |
| [docs/side-b/](docs/side-b/) | Side-B 設計ドキュメント群 | 中 |
| [DESIGN.md](DESIGN.md) | フロントエンドデザイン仕様 | 中 (フロント作業時) |
| [indicators/README.md](indicators/README.md) | インジケーター概念思想 | 参考 |

> **ルール**: 実装前に必ず該当ドキュメントを確認。不明点があれば先に確認。

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| **Backend** | Node.js + Express + TypeScript |
| **Frontend** | Next.js 15+ (App Router) + TypeScript |
| **Database** | PostgreSQL + Prisma ORM |
| **Validation** | Zod (ランタイムバリデーション必須) |
| **AI** | OpenAI API (軽量モデル優先) |
| **Market Data** | Twelve Data API |
| **Notification** | Web Push (web-push) |
| **Task Queue** | BullMQ |

## テスト手順

```bash
# 全テスト実行
npm test

# 特定ファイルのみ
npm test -- path/to/file.test.ts

# カバレッジ付き
npm test -- --coverage
```

**テストポリシー**:
- ロジック追加時は必ずテスト追加
- 一致判定ロジックは **正常系 / 境界値 / 異常系** を含める
- テストコメントも日本語
- レンズには「同じ入力で同じ出力を返す」決定性テストを含める

> ⚠️ テスト未実装の変更は **未完了扱い**

## トラブルシューティング

### ポートが使用中の場合
```bash
npm run kill:ports
# または手動 (Mac/Linux)
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

## 主要ポート

- Backend: 3100
- Frontend: 3102
- PostgreSQL: 5432 (デフォルト)

## よく使うファイル

- エントリーポイント: [src/index.ts](src/index.ts)
- Express 設定: [src/app.ts](src/app.ts)
- DB スキーマ: [prisma/schema.prisma](prisma/schema.prisma)
- フロントエンド: [src/frontend/](src/frontend/)
- cTrader 認証: [src/backend/services/ctrader/ctraderAuthService.ts](src/backend/services/ctrader/ctraderAuthService.ts)
- セッション管理: [src/backend/services/auth/sessionService.ts](src/backend/services/auth/sessionService.ts)
- 認証コンテキスト: [src/frontend/contexts/AuthContext.tsx](src/frontend/contexts/AuthContext.tsx)
- リアルタイムワーカー: [scripts/run-realtime-worker.ts](scripts/run-realtime-worker.ts)
- PDCA ループ: [src/side-b/agent/pdcaLoop.ts](src/side-b/agent/pdcaLoop.ts)
- エージェントメモリ: [src/side-b/agent/agentMemory.ts](src/side-b/agent/agentMemory.ts)

## 認証システム (cTrader OAuth 統合)

- **認証方式**: cTrader OAuth 2.0 (email/password 認証は廃止)
- **セッション管理**: JWT (Cookie ベース、7日間有効)
- **マルチアカウント対応**: 複数 cTrader アカウントを1ユーザーに紐付け可能
- **ProtectedRoute**: 全ページに認証を適用 (`/login`, `/auth/*` を除く)
- **主要エンドポイント**:
  - `GET /api/auth/ctrader/url` - OAuth 認証URLを取得
  - `POST /api/auth/ctrader/callback` - 認証コールバック処理
  - `PUT /api/auth/ctrader/primary` - プライマリアカウント変更
  - `GET /api/auth/me` - ログインユーザー情報取得
  - `POST /api/auth/logout` - ログアウト

## リアルタイム通知関連 (Phase 2 完了)

- `CTraderProvider`: cTrader WebSocket 接続
- `RollingWindowService`: Tick → OHLCV 集約
- `RealtimeSimilarityService`: リアルタイム類似度チェック
- 詳細: [docs/realtime_similarity_notification_architecture.md](docs/realtime_similarity_notification_architecture.md)

## 補足: 現在のテスト状況

- 最終確認: 設計書再編時に旧 AGENTS.md から引き継いだ情報。最新値は CI / `npm test` で確認すること
- 引き継ぎ値: 全 566 テスト中 541 パス、25 失敗 (cTrader 審査待ち、2026/01/06 時点)

---

> **最終更新**: 2026-05-12 (Ticket A2 で全面再編、旧 AGENTS.md / CLAUDE.md からの統合・移植を実施)
> **このファイルを信頼し、情報が不足している場合のみ追加の検索を行うこと。**
