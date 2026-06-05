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
4. **該当フェーズの設計書** — `docs/architecture/side-b-architecture.html` (Side-B 設計正本) または進行中フェーズの PR description / GitHub Issue (旧 `docs/design/phase_N_specification.md` 形式は 2026-05-15 整理で廃止)

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
    ├── analysisEngine.ts
    ├── ctrader.ts
    ├── eodhd.ts
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

## 5. ドキュメント運用ポリシー (2026-05-15 整備)

### 5.0 ローリング運用 — フェーズ完了で「正本に統合 → サマリー差し替え」

ドキュメントは **正本 + 現在進行中のフェーズの指示書 + サマリー 1 件** の 3 種類で運用する。完了したら正本に統合してアーカイブ / 削除し、**過去のフェーズ作業ノートを溜め込まない**。

#### 構成 (常にこの 3 つだけ)

1. **設計正本** (1 件、不変):
   - HTML: `docs/architecture/side-b-architecture.html` (Side-B 設計正本、1302 行)
2. **現在進行中フェーズの指示書** (0〜1 件):
   - 進行中フェーズの PR description / GitHub Issue / KICKOFF.md に集約
3. **直近完了フェーズのサマリー** (1 件、ローリング):
   - 進捗管理は GitHub Issue + memory ファイル (`project_phase_*.md`) で運用
   - 次フェーズエージェントが起動時に読む唯一の引き継ぎ

#### フェーズ完了時のフロー (必須)

1. 実装完了
2. **HTML 正本に該当フェーズの変更を記述** (これがないと完了とみなさない)
3. 完了フェーズの **新サマリー** を作成 (1 件)
4. 前回サマリーを **削除**
5. 指示書 (`docs/design/phase_N_specification.md` 形式は 2026-05-15 で廃止、現在は PR description / Issue に集約) を運用上保留しているなら **削除またはアーカイブ移動**
6. KICKOFF / NOTES / AUDIT 等の作業ノートも **全部削除**

#### 禁止パターン

- フェーズ完了後に指示書 / 作業ノートを `docs/design/` や `docs/architecture/` に溜め込む
- 「KICKOFF」「SUMMARY」「NOTES」「AUDIT」系の **複数件同居** (= サマリーは常に 1 件まで)
- 進捗・調査・分析の md 化 (チャット返信 / PR description / TaskUpdate で済ます)

**Why**: ドキュメント分散 → 単一ソース・オブ・トゥルース喪失 → 後から読んだ AI / 人間が認識ズレ → 設計違反コード混入の温床。2026-05-15 に 83 件削除して整理 (例: 設計書 §1.4 で「Discovery は調査員」と明記、`prompts/discovery.md` で「仮説を出さない」と禁止していたのにコードが仮説挿入していた → PR #213 で修正)。

### 5.1 設計書の更新義務

- 各フェーズ完了時、HTML 設計正本 (or 暫定 Markdown) に **必ず** 内容を統合
- 統合せずにフェーズ完了とみなすのは禁止 (= サマリー差し替えだけでは不十分)
- 実装 PR と設計書更新は **同 PR でも別 PR でも可** (柔軟に判断、強制しない)

### 5.2 変更種類別の更新対象

| 変更種類 | 更新対象 |
|----------|----------|
| ノート仕様変更 | `NOTE.md` |
| アーキテクチャ変更 | HTML 設計正本 (`side-b-architecture.html`) |
| API 変更 | `docs/API.md` |
| Side-B 関連 | HTML 設計正本 (`side-b-architecture.html`) |
| ADK 採用範囲・実装状況 | `docs/architecture/ADK_ADOPTION.md` |

### 5.3 新規ファイル作成は最終手段 (2026-05-17 制定)

新規ファイルは「作業の副産物」ではなく「設計上の追加物」。実装・修正・検証でファイルを増やす前に、以下を必ず確認する。

1. 既存ファイルへの追記・修正で済まないか
2. 既存テスト / スクリプト / helper / util / service にケース・オプションを追加して統合できないか
3. そのファイルが恒久的に必要か、一時的な調査用か

新規作成が必要な場合は、PR 説明に **責務 / 既存統合しなかった理由 / 恒久 or 一時の別 / 実行 or 参照経路 / 削除条件** を必ず記載する。

一時調査ファイルを `src/` 配下やリポジトリ直下に置かない (`.tmp/` / `tmp/` / `scratch/` を使い、`.gitignore` する)。テストはバグ修正ごとに新ファイルを作らず、既存テストファイルにケース追加するのが原則。

### 5.4 scripts/ ディレクトリの運用

`scripts/` 配下に置くスクリプトは **`scripts/README.md` の登録表に必ず追記**する。追記しないスクリプトは追加してはならない。用途分類は `dev/` `check/` `migrate/` `ci/` `maintenance/` `one-shot/`、one-shot は冒頭に削除予定日を記載する。詳細は [`scripts/README.md`](./scripts/README.md) を参照。

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
各フェーズには明確な完了条件がある (PR description / Issue / 進行中なら KICKOFF.md などに記載)。その **完了条件** を超える実装を勝手にしてはならない。「これもついでに作りました」は禁止。余計な作り込みはレビューコストを増やすだけ。

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

## Last-Mile Shared Context Rule

> **規約本体は `docs/architecture/LAST_MILE_INTEGRATION.md` §5**。本セクションは **発火条件 + 常時有効な安全境界** のみ。日常作業では LAST_MILE_INTEGRATION.md を読まなくてよい。

**発火条件**: UI / UX / API 連携 / DB 状態 / Job 状態に関する **ラストマイル修正** (実行してみたら期待と挙動が違う系) に着手するとき。コードだけで推測修正してはならない。以下の順に実行する:

1. `docs/architecture/LAST_MILE_INTEGRATION.md` を読む (規約 + 取得手段 + Domain ID マッピング)
2. **Last-Mile Bundle** を `.last-mile/latest/` に取得 (CLI / MCP / 手動の 3 経路)
3. `@last-mile-context/core` の `classifyIssue(bundle)` で原因分類してから修正
4. AI に渡す前に `npx lastmile mask --strict` で redaction 再確認
5. 解決後は `tests/e2e/` に Playwright spec で再現手順を残す

**常時有効な安全境界 (ラストマイル作業外でも `window.__AI_DEBUG_CONTEXT__` を触る時に必須)**:
- `__AI_DEBUG_CONTEXT__` に token / cTrader OAuth token / JWT / refresh token / cTrader accountId / 取引額 / 実残高 を入れない (redaction は最終防衛線、そもそも入れない方が安全)
- production 環境への collect は禁止 (`lastmile.config.json` の `environment: 'development'` 固定)

由来: `last-mile-shared-context` Phase 11 (PR #229) で導入。詳細仕様は `docs/architecture/LAST_MILE_INTEGRATION.md` を参照。vendor 配下は `.tgz` パッケージ 8 件のみで `templates/` ディレクトリは未展開。上流: https://github.com/NekoyaJolly/last-mile-shared-context

---

## CI で強制されているルール (参考)

本セクションは**概要のみ**を記述する。Step 0 監査レポート群 (STEP_0_ESLINT_AUDIT.md 等) は 2026-05-15 の整理で削除済。CI ルールの正本は `eslint.config.mjs` および `tsconfig.json` を直接参照。

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

- 設計の意図が分からない → `docs/architecture/side-b-architecture.html` (Side-B 設計正本) または `docs/architecture/ADK_ADOPTION.md` を読む
- フェーズの範囲が不明確 → 進行中フェーズの PR description / GitHub Issue / KICKOFF.md を確認、または Nekoさん に確認
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
# .env を編集: DATABASE_URL, EODHD_API_KEY, ANTHROPIC_API_KEY (必要に応じ OPENAI_API_KEY / AI_API_KEY / MARKET_API_KEY)

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

### Side-B: TradeAssistant-AI (AI 用・本番稼働中 / 自己改善ループ進化中)
- AI による日次トレードプラン生成
- 仮想トレード実行・記録
- AI 用トレードノートによる学習ループ
- **AI が自律的に市場を観察し、仮説を立て、検証し、エッジ台帳を育てる** ループの骨格は実装済み (Phase 6 プロンプト進化 / Phase A EODHD All-In-One + ResearchOutput 永続化 / Phase B Twelve Data → EODHD OHLCV 切替 + 評価ハーネス + EODHD リサーチスキル 6 種)
- SideBScheduler の planGeneration / tradeMonitoring / screening / fullValidation / discovery が本番 LIVE。Top-Level Orchestrator (PR #248 MVP) は env default OFF で段階的に通電中

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
│   ├── backend/           # Side-A バックエンド (controllers / routes はこの配下)
│   ├── services/
│   ├── models/
│   ├── domain/
│   ├── infrastructure/
│   ├── middleware/
│   ├── utils/
│   ├── config/
│   ├── schemas/           # Zod スキーマ
│   ├── shared/            # 横断共有ユーティリティ (indicators, marketdata, timeframes 等)
│   ├── frontend/          # Next.js フロントエンド
│   └── side-b/            # Side-B 実装 (controllers / routes 含む、AGENTS.md あり)
│       └── adk/           # ADK サイドカー (AGENTS.md あり)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── architecture/      # ADK 採用関連・Side-B 設計 HTML 正本・ORCH 設計
│   │   ├── ADK_ADOPTION.md
│   │   ├── side-b-architecture.html
│   │   ├── TOP_LEVEL_ORCHESTRATOR_DESIGN.md
│   │   └── EODHD_INTEGRATION.md
│   ├── diagnostics/       # コードベースレビュー / 棚卸し HTML
│   ├── research/
│   └── _archive/          # 過去フェーズ設計 (design/ と side-b/ はアーカイブ済)
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
| [docs/architecture/side-b-architecture.html](docs/architecture/side-b-architecture.html) | Side-B 自律 AI 設計の正本 (HTML) | 高 (Side-B 作業時) |
| [docs/architecture/ADK_ADOPTION.md](docs/architecture/ADK_ADOPTION.md) | ADK 段階導入の採用範囲・撤退基準 | 高 (ADK 領域作業時) |
| [docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md](docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md) | Top-Level Orchestrator 設計 | 中 (Side-B 作業時) |
| [DESIGN.md](DESIGN.md) | フロントエンドデザイン仕様 | 中 (フロント作業時) |
| [indicators/README.md](indicators/README.md) | インジケーター概念思想 | 参考 |

> **ルール**: 実装前に必ず該当ドキュメントを確認。不明点があれば先に確認。

## 技術スタック

> **重要**: agent はこの表を **本番構成の正本** として扱うこと。「PostgreSQL = Cloud SQL」「AI = OpenAI」など training data の連想で hallucinate しないこと。
> **最終更新**: 2026-06-05 (Supabase / Anthropic / EODHD / Cloud Run / Vercel 明示化)

| カテゴリ | 技術 |
|----------|------|
| **Backend** | Node.js + Express + TypeScript |
| **Frontend** | Next.js 15+ (App Router) + TypeScript |
| **Database** | **Supabase PostgreSQL (managed, asia-northeast-1, project `rmsylwmqxyeqgplysqoa`)** + Prisma ORM。本番接続は Supavisor Transaction Pooler (`aws-0-asia-northeast-1.pooler.supabase.com:6543`) 経由、DIRECT_URL (migration 専用) は `db.[ProjectRef].supabase.co:5432`。**Cloud SQL は使っていない** |
| **Validation** | Zod (ランタイムバリデーション必須) |
| **AI** | **Anthropic Claude API** (extended thinking + prompt caching 配線済、PR #348)。モデルは `config.ai.models.<key>` + `modelFor()` + `AI_MODEL_<KEY>` env で per-agent 切替可能 |
| **Market Data** | **EODHD (本番第一選択)**。Twelve Data は 2026-06-05 (PR #351) で物理削除済 |
| **Notification** | Web Push (`web-push`, VAPID) + In-App Notification (`Notification` テーブル経由) |
| **Task Queue** | BullMQ |
| **Hosting (Backend)** | **GCP Cloud Run** (asia-northeast1, service `trader-note`, max-instances=5)。env は `.github/workflows/deploy.yml` の `--set-env-vars` 列挙が **唯一の真実のソース** (列挙忘れの env は silently OFF になる罠あり) |
| **Hosting (Frontend)** | **Vercel** (`trader-note-build-ai.vercel.app`) |
| **Hosting (Analysis Engine)** | GCP Cloud Run (asia-northeast1, service `trader-note-analysis-engine`、Python FastAPI) |
| **Auth** | cTrader OAuth 2.0 + JWT (Cookie ベース, 7 日間有効、マルチアカウント対応) |
| **Secrets** | GCP Secret Manager (16 件、deploy.yml の `--set-secrets` 列挙が正本) |
| **CI/CD** | GitHub Actions (`.github/workflows/deploy.yml` `ci.yml` 等)。本番 deploy は main マージで自動発火 |
| **Test** | Jest (unit, ~2800 件) + Playwright (E2E、本番 smoke 含む) |
| **Cron** | GitHub Actions Cron + `/api/cron/*` (Bearer `CRON_SECRET` 認証必須)。15 分間隔の matching pipeline 等 |

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

## リアルタイム通知関連 (Phase 2 完了: in-memory 層)

- `CTraderProvider`: cTrader WebSocket 接続
- `RollingWindowService`: Tick → OHLCV 集約
- `RealtimeSimilarityService`: リアルタイム類似度チェック (常駐 Worker 用、in-memory + callback のみ)
- ※ 現状 production の matching 通知は 15 分 cron (`runMatchingPipeline`) 経由。RealtimeSimilarityService の DB / Push 接続は Phase 3 で対応予定
- 詳細: [docs/realtime_similarity_notification_architecture.md](docs/realtime_similarity_notification_architecture.md)

## 補足: 現在のテスト状況

- 最新値は CI / `npm test` で確認すること
- 既知 fail (2026-06-05 時点): Side-B 進化スケジューラ系の一部スイート (`sideBScheduler.evolutionMultiGen` / `evolutionLoop` 等) は main でも timeout 系の既存 fail として認識済 (8 件、pre-existing flake)
- cTrader OAuth は本番稼働中 (旧 AGENTS.md の「審査待ち」表記は完了済み)

---

> **最終更新**: 2026-06-06 (技術スタック / Side-B 本番稼働中 / docs/design 廃止 / ADK 進捗 / Twelve Data 物理削除 / Anthropic Claude 配線 を実コード verify で反映)
> **初版**: 2026-05-12 (Ticket A2 で全面再編、旧 AGENTS.md / CLAUDE.md からの統合・移植を実施)
> **このファイルを信頼し、情報が不足している場合のみ追加の検索を行うこと。**
