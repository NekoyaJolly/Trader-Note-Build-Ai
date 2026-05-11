# STEP_0_ANALYSIS.md - 既存設計書の棚卸し結果

> **チケット**: Ticket A1
> **作成日**: 2026-05-12
> **対象ファイル**: `/AGENTS.md` (492行), `/CLAUDE.md` (115行), `/DESIGN.md` (239行)
> **ステータス**: APPROVED (Q1〜Q7 すべて推奨案で承認、2026-05-12)

---

## 0. 分類カテゴリの定義

| 記号 | 名称 | 再配置先 |
|------|------|----------|
| **G** | Global: 全エージェント・全ディレクトリで通用する汎用規約 | ルート `/AGENTS.md` |
| **D** | Domain: side-b 自律トレーディング AI に関する設計原則 | ルート `/AGENTS.md` ドメイン原則セクション、または `/src/side-b/AGENTS.md` |
| **F** | Frontend: UI/UX、トークン、コンポーネント関連 | `/src/frontend/AGENTS.md` (将来作成) |
| **C** | CI-verifiable: 型安全、Lint、コード品質 | ルート `/AGENTS.md` に「CI で強制」と記載、詳細は ESLint 設定で表現 |

複数分類にまたがるものは `G+D` のように記載。

---

## 1. 分類結果

### 1.1 `/AGENTS.md` (TradeAssist AI エージェント指示書)

| セクション/原則 | 内容要約 | 分類 | 再配置先 |
|-----------------|----------|------|----------|
| クイックスタート | npm install / .env / DB / dev サーバー起動手順 | G | ルート AGENTS.md (運用情報セクション、簡素化) |
| 開発コマンド一覧 | npm run dev, build, test, prisma:* | G | ルート AGENTS.md (運用情報セクション) |
| プロジェクト概要 (Side-A / Side-B) | TradeAssist 全体像 | G+D | ルート AGENTS.md (G: 概要)、Side-B 詳細はドメイン原則へ |
| プロジェクト構造 (ディレクトリツリー) | リポジトリ全体マップ | G | ルート AGENTS.md (参照情報) |
| 仕様ドキュメント参照先 | NOTE.md / ARCHITECTURE.md / API.md / side-b/ / indicators/ | G | ルート AGENTS.md (参照情報) |
| 技術スタック | Node.js+Express+TS / Next.js / PostgreSQL / Prisma / Zod / OpenAI / Twelve Data / Web Push / BullMQ | G | ルート AGENTS.md (運用情報) |
| 最重要ルール §1 言語ルール | 全成果物日本語、英語のみ禁止、例外 (予約語・API名) | G | ルート AGENTS.md §4 言語規約 (KICKOFF.md §A2 構造) |
| 最重要ルール §2 型安全ルール | any 禁止、unknown 禁止 (例外条件付き)、手動 if バリデーション禁止、Zod 必須、スキーマ配置と書き方例 | G+C | ルート AGENTS.md §2 TypeScript 型安全規約 + CI で強制 (詳細は ESLint へ) |
| 最重要ルール §3 環境変数ルール | API キー直書き禁止、.env 管理、.env.example はダミー値のみ | G | ルート AGENTS.md (セキュリティ規約) |
| コーディング規約 (関数・変数) | 命名、1ファイル1責務、DRY | G | ルート AGENTS.md §3 コード品質規約 |
| コーディング規約 (コメント) | なぜを日本語で説明、良い例/悪い例 | G | ルート AGENTS.md §3 + §4 |
| テスト手順・テストポリシー | npm test、正常系/境界値/異常系、未実装は未完了扱い | G | ルート AGENTS.md (テスト規約) |
| Git ワークフロー (ブランチ命名) | feature/, fix/, docs/ | G | ルート AGENTS.md §6 PR/コミット規約 |
| Git ワークフロー (コミットメッセージ) | feat:, fix:, docs:, test: | G | ルート AGENTS.md §6 |
| Git ワークフロー (変更前検証) | build → test → dev | G | ルート AGENTS.md §6 |
| AI エージェント行動制約 (Allowed/Ask First/Forbidden) | 自由実行可 / 人間確認必須 / 絶対禁止 | G | ルート AGENTS.md (エージェント行動制約) |
| AI 推論品質 §1 Self-Verification | 出力前矛盾チェック、NG/OK例 | G | ルート AGENTS.md (AI 品質ガイドライン) |
| AI 推論品質 §2 Uncertainty 表示 | 推論明示、避けるべき表現 | G | ルート AGENTS.md (AI 品質ガイドライン) |
| AI 推論品質 §3 Backtracking | ガードレール限界、代替案 | G | ルート AGENTS.md (AI 品質ガイドライン) |
| トラブルシューティング | ポート、Prisma、Frontend、テストタイムアウト | G | ルート AGENTS.md (運用情報) |
| ドキュメント更新ルール (表) | 変更種類別の更新対象 | G | ルート AGENTS.md §5 設計書の更新義務 |
| 補足情報 (テスト状況) | 566 テスト、最終確認日 | G | ルート AGENTS.md (運用情報、日付要更新) |
| 補足情報 (主要ポート) | 3100, 3102, 5432 | G | ルート AGENTS.md (運用情報) |
| 補足情報 (よく使うファイル) | エントリーポイント等の参照リンク | G | ルート AGENTS.md (運用情報) |
| 補足情報 (認証システム cTrader OAuth) | 認証方式、エンドポイント | G+D | ルート AGENTS.md (Side-A 認証情報) |
| 補足情報 (リアルタイム通知関連) | CTraderProvider、RollingWindowService、RealtimeSimilarityService | G+D | ルート AGENTS.md (Side-A 機能情報) |

---

### 1.2 `/CLAUDE.md` (自律型トレーディングAI アーキテクチャ)

| セクション/原則 | 内容要約 | 分類 | 再配置先 |
|-----------------|----------|------|----------|
| このプロジェクトが目指していること | Side-B = AI 自律観察・仮説・検証・台帳育成 | D | ルート AGENTS.md ドメイン原則 (序文) |
| 6つの原則 §1 既存コードを壊さない | ラッパー/拡張、MarketAnalysis 等のデータ構造破壊禁止、後方互換 | D+G | ルート AGENTS.md ドメイン原則 §1 (**文言保持で移植**) + 最優先5原則 §4 |
| 6つの原則 §2 指定フェーズ範囲を超えない | 完了条件超え禁止、「ついで」禁止 | D+G | ルート AGENTS.md ドメイン原則 §2 (**文言保持で移植**) + 最優先5原則 §3 |
| 6つの原則 §3 LLM の役割を拡張しすぎない | LLM = 構造発見/解釈/学習、数値最適化/統計は決定論的コード | D | ルート AGENTS.md ドメイン原則 §3 (**文言保持で移植**) |
| 6つの原則 §4 レンズは独立・純粋 | 副作用なし、依存なし、決定性あり | D | ルート AGENTS.md ドメイン原則 §4 (**文言保持で移植**) |
| 6つの原則 §5 エッジ台帳への昇格は厳格 | 学習PF>1.5, 検証PF>1.3, WF<0.3 の3条件全て | D | ルート AGENTS.md ドメイン原則 §5 (**文言保持で移植**) |
| 6つの原則 §6 人間語への翻訳を省略しない | label, rationale フィールド必須 | D | ルート AGENTS.md ドメイン原則 §6 (**文言保持で移植**) |
| 実装の基本作法 (ファイル配置の規則) | lenses/, agents/, prompts/, strategy_dsl/, evolution/ | D | `/src/side-b/AGENTS.md` ファイル配置の規則 (移植) |
| 実装の基本作法 (既存との統合ポイント) | pdcaLoop, AgentMemory, strategyBacktestService, walkForwardService | D | `/src/side-b/AGENTS.md` 既存実装との統合ポイント (移植) |
| 実装の基本作法 (型定義の原則) | side-b/models/、オプショナル追加、JSDoc 必須 | D+G | `/src/side-b/AGENTS.md` (D 部分) + ルート AGENTS.md (G: 後方互換、JSDoc) |
| 実装の基本作法 (テスト) | side-b/tests/、レンズの決定性テスト | D | `/src/side-b/AGENTS.md` (テスト規約) |
| プロンプトを編集する時の注意 | prompts/*.md 外部化、ハードコード禁止、編集時確認事項 | D | `/src/side-b/AGENTS.md` (プロンプト編集規約) |
| やってはいけないこと一覧 | CORE_TRADING_RULES 撤廃、エリオット一意決定禁止、ON/OFF スイッチ禁止、LLM 数値最適化禁止、ブラックボックスエッジ禁止、フェーズまたぎ禁止 | D+G | ルート AGENTS.md ドメイン原則 (禁止事項) (**文言保持で移植**) + 最優先5原則 §3 |
| 作業完了時の自己チェックリスト | フェーズ完了条件、テスト、ユニットテスト、データ構造、プロンプト外部化、禁止事項、日本語 | G | ルート AGENTS.md (作業完了時セルフチェック) |
| 困った時 | 設計書参照、推測しない、確認する | G | ルート AGENTS.md (困った時) + 最優先5原則 §1 |

---

### 1.3 `/DESIGN.md` (TradeAssist デザイン仕様)

| セクション | 内容要約 | 分類 | 再配置先 |
|-----------|---------|------|----------|
| §1 文書の目的 | 見た目・トークン・プリミティブの単一参照先 | F | `/src/frontend/AGENTS.md` (将来) |
| §2 参考にした公開情報 | OpenAI UI guidelines、デザイントークン一般、Material Design | F | `/src/frontend/AGENTS.md` (将来) |
| §3 ビジュアルアイデンティティ | Neon Dark テーマ、ガラスモーフィズム | F | `/src/frontend/AGENTS.md` (将来) |
| §4 デザイントークン (CSS 変数) | --neon-start, --bg-dark, --success, --warning 他 | F | `/src/frontend/AGENTS.md` (将来) |
| §5 テキストカラー (Tailwind 併用) | text-white, text-gray-*, text-red-400 他 | F | `/src/frontend/AGENTS.md` (将来) |
| §6 ボタン・CTA (Button, NeonButton) | variant 一覧 (default, secondary, destructive 他) | F | `/src/frontend/AGENTS.md` (将来) |
| §7 カード・サーフェス・アラート | Card, NeonCard GLOW_COLORS, Alert variant | F | `/src/frontend/AGENTS.md` (将来) |
| §8 バッジ・トレンド系 | .badge-trend-up/down/neutral, .badge-decision-* | F | `/src/frontend/AGENTS.md` (将来) |
| §9 タイポグラフィ | Inter、見出し階層、モノスペース | F | `/src/frontend/AGENTS.md` (将来) |
| §10 レイアウト・スペーシング | max-w-*, rounded-*, border-slate-700 | F | `/src/frontend/AGENTS.md` (将来) |
| §11 モーション | animate-fade-in, animate-pulse-glow 他 | F | `/src/frontend/AGENTS.md` (将来) |
| §12 コンポーネント群 (ディレクトリマップ) | ui/, layout/, side-b/, strategy/, chart/, trading/ | F | `/src/frontend/AGENTS.md` (将来) |
| §13 アクセシビリティ・インタラクション | focus-visible:ring-*、コントラスト、press-scale | F | `/src/frontend/AGENTS.md` (将来) |
| §14 関連ファイル・ドキュメント | globals.css, DESIGN_PHILOSOPHY.md 他 | F | `/src/frontend/AGENTS.md` (将来) |
| §15 変更時のチェックリスト | 新色 :root、CTA 整合、NeonCard color、日本語 | F | `/src/frontend/AGENTS.md` (将来) |

---

## 2. 要確認項目

分類または再配置先の判断に Nekoさんの判断を要する事項。**A2 以降に進む前に承認を求める**。

### Q1. `docs/architecture/` ディレクトリの新設について

KICKOFF.md は出力先として `docs/architecture/` を全面採用しているが、現状リポジトリには存在せず、KICKOFF.md 自身は `docs/design/STEP_0_KICKOFF.md` に置かれている。

- **推奨 (採用)**: KICKOFF.md の文言どおり `docs/architecture/` を新設する。本書および ADK_ADOPTION.md, Phase B/C のレポート群を全て `docs/architecture/` 配下に置く。`docs/design/STEP_0_KICKOFF.md` は KICKOFF.md 自身であり既コミット (?) のため移動しない。Step 0 完了後にユーザー判断で `docs/design/STEP_0_KICKOFF.md` を `docs/architecture/` に移動するか検討
- **代替**: 全て `docs/design/` に置く (`docs/architecture/` を作らず KICKOFF.md の文言と相違する)

→ **推奨採用の前提で進めて良いか確認**。本書はすでに `docs/architecture/STEP_0_ANALYSIS.md` に出力済み

### Q2. `/DESIGN.md` の取り扱い

Phase A の対象は `/AGENTS.md` / `/CLAUDE.md` / `/DESIGN.md` だが、A2〜A6 のチケットでは `/DESIGN.md` の処遇が指定されていない。

- **推奨 (現状維持)**: `/DESIGN.md` はルート直下に残し、将来 `/src/frontend/AGENTS.md` を新設する際にそこへ統合または分割する。Phase A では触らない
- **代替 A**: 本 Phase A 内で `/src/frontend/AGENTS.md` を新設し、`/DESIGN.md` を統合または移動
- **代替 B**: シム化して `/src/frontend/AGENTS.md` に誘導

→ KICKOFF.md §2.4 は `/AGENTS.md` `/CLAUDE.md` `/DESIGN.md` の3ファイルを「上書き対象」と明記しているが、A1〜A6 のチケット詳細では `/DESIGN.md` の上書きが指示されていない。**Phase A 内で DESIGN.md は触らない解釈で良いか確認**

### Q3. /CLAUDE.md 原則 §1 §2 と最優先5原則の整合

KICKOFF.md §3.3 の最優先5原則 §3「指定範囲を超えない」「ついで禁止」と /CLAUDE.md 原則 §2「指定フェーズ範囲を超えない」「ついで禁止」は実質同義。同様に最優先5原則 §4「既存APIを壊さない」と原則 §1「既存コードを壊さない」も実質同義。

A2 では「§3.3 の最優先5原則」を冒頭 blockquote に置き、別途「ドメイン原則」セクションに /CLAUDE.md 原則1〜6 を**文言を変えずに**移植する指示。

- **解釈**: 重複を許容し、最優先5原則 (汎用) とドメイン原則 (具体) の両方を併記する (重複が冗長に見えるが、A2 指示の文言保持要求が最優先)
- **疑問**: 重複に見えるが、最優先5原則は「any 禁止」「設計判断確認」「指定範囲超越禁止」「既存API破壊禁止」「ルート AGENTS.md 読み込み義務」の5つで、ドメイン原則 §1 §2 とは粒度・文脈が異なる (ドメイン原則は Side-B 文脈)

→ **重複併記の解釈で進めて良いか確認**。文言は変えない

### Q4. AI 推論品質ガイドラインの所属

`/AGENTS.md` の「AI 推論品質ガイドライン (Self-Verification / Uncertainty / Backtracking)」は Claude Code の癖を意識した記述だが、明示的に Claude 専用とは書かれていない。

- **推奨 (G 分類)**: ルート AGENTS.md (Global) に置き、全エージェント共通として扱う
- **代替**: Claude 固有として `/CLAUDE.md` シムに移す

→ **G 分類で進めて良いか確認**

### Q5. ルート `/AGENTS.md` の運用情報セクションの肥大化

現 `/AGENTS.md` (492行) に含まれる「クイックスタート」「開発コマンド」「ディレクトリ構造」「トラブルシューティング」「補足情報」などはサイズが大きい。

- **推奨 (一括残置)**: ルート `/AGENTS.md` 内に「運用情報」セクションとしてまとめて残す (現状維持的、サイズは増えるが情報の一元性確保)
- **代替**: README.md や docs/ONBOARDING.md に分離する

→ KICKOFF.md §A2 の指示には運用情報の扱いが明記されていない。**一括残置で進めて良いか確認**

### Q6. `/CLAUDE.md` 原則1〜6 の「文言を変えずに移植」の範囲

A2 指示は「既存 CLAUDE.md の原則1〜6 を文言を変えずに移植」とある。「原則1〜6」とは見出し直下の本文 (各原則の説明文) を指すか、それとも見出しと本文の両方か。

- **解釈**: 見出し (例「### 1. 既存コードを壊さない」) を含めて節構造を保持し、本文の文言も変えない。プレフィックス文 (例「Claude Code が守るべき6つの原則」) は新しい AGENTS.md のドメイン原則セクション導入文に置き換え可

→ **この解釈で進めて良いか確認**

### Q7. 既存の未コミット変更の取り扱い

現時点で以下の未コミット変更がある:
- `M scripts/kill-ports.js`
- `M src/frontend/package-lock.json`
- `?? docs/design/STEP_0_KICKOFF.md` (本キックオフ書自体)
- `?? docs/diagnostics/レコーディング 2026-05-12 005124error.mp4` (デバッグ動画)

KICKOFF.md §2.4 は「上書き前に git status でクリーンな状態を確認」を要求している。

- **推奨 (A1 完了後にユーザー対応依頼)**: A1 (本書作成) 自体は git status クリーン要求の対象外 (上書き作業ではないため)。Gate 1 の承認後、A2 着手前に Nekoさんが上記の未コミット変更を整理してから A2 に進む
- **代替**: A1 内で本書のみを add & commit し、他の未コミット変更はそのまま残す。A2 着手時にユーザー対応

→ **A2 着手前に Nekoさん側で整理する前提で進めて良いか確認**。kill-ports.js / package-lock.json の変更内容は A1 作業者 (Claude Code) の関与外

---

## 3. 推奨される最終構造 (Phase A 完了時点のツリー)

```
/
├── AGENTS.md (A2 で上書き、正本)
│   ├── 冒頭 blockquote: 最優先5原則 (§3.3 のとおり)
│   ├── §このファイルの位置づけ
│   ├── §1 読み込み義務 (ディレクトリ AGENTS.md → 必ずルートに戻る)
│   ├── §2 TypeScript 型安全規約 (any禁止、unknown 即 narrow、@ts-ignore 禁止、Zod)
│   ├── §3 コード品質規約 (1ファイル1責務、DRY、コメント)
│   ├── §4 言語規約 (日本語、例外条件)
│   ├── §5 設計書の更新義務 (実装状況セクション運用、別PR原則)
│   ├── §6 PR / コミット規約 (feat:/fix:/docs:、検証手順)
│   ├── §ドメイン原則 (自律トレーディングAI) ← /CLAUDE.md 原則1〜6 文言保持
│   ├── §CI で強制されているルール (参考、概要のみ)
│   ├── §AI エージェント行動制約 (Allowed/Ask First/Forbidden)
│   ├── §AI 推論品質ガイドライン (Self-Verification / Uncertainty / Backtracking)
│   └── §開発運用情報 (クイックスタート、コマンド、ポート、ファイル一覧、トラブル)
├── CLAUDE.md (A3 で上書き、シム ~15行)
│   ├── 冒頭3行: AGENTS.md 正本、読む前に AGENTS.md、ディレクトリ跨ぎ時の AGENTS.md 読み込み
│   └── §Claude Code 固有の指示 (5原則確認宣言、実装状況更新義務、チケット単位)
├── .cursorrules (A3 で新規、シム)
│   └── Cursor 固有: Composer/Inline 大規模変更前確認、any 自動補完拒否
├── GEMINI.md (A3 で新規、シム)
│   └── Gemini 固有: 将来追記
├── DESIGN.md (Phase A では触らない、Q2 で確認)
├── src/
│   ├── side-b/
│   │   ├── AGENTS.md (A4 で新規)
│   │   │   ├── 冒頭 blockquote: 最優先5原則 (再掲)
│   │   │   ├── §このディレクトリの位置づけ
│   │   │   ├── §ファイル配置の規則 (lenses/, agents/, prompts/, strategy_dsl/, evolution/)
│   │   │   ├── §既存実装との統合ポイント (pdcaLoop, AgentMemory, backtest, walkForward)
│   │   │   ├── §不可侵領域 (ADK 段階導入中、ADK_ADOPTION.md 参照)
│   │   │   └── §作業着手前宣言 (5原則確認、本ファイル読了、ルート確認)
│   │   └── adk/ (A5 で新規)
│   │       ├── AGENTS.md (依存方向制約、改変禁止、JSDoc 規約、撤退手順)
│   │       ├── adapters/.gitkeep
│   │       ├── tracing/.gitkeep
│   │       └── agents/.gitkeep
│   └── frontend/
│       └── AGENTS.md (将来、DESIGN.md の内容を移植予定; Phase A 対象外)
└── docs/
    ├── design/
    │   └── STEP_0_KICKOFF.md (本キックオフ書、Q1 で確認)
    └── architecture/ (A1 で新規ディレクトリ)
        ├── STEP_0_ANALYSIS.md ← 本書
        ├── ADK_ADOPTION.md (A6 で新規)
        ├── STEP_0_TSCONFIG_AUDIT.md (Phase B-1 で作成予定)
        ├── STEP_0_ESLINT_AUDIT.md (Phase B-2 で作成予定)
        ├── STEP_0_CI_STATUS.md (Phase B-3 で作成予定)
        ├── STEP_0_HUSKY_SETUP.md (Phase C-1、任意で作成予定)
        └── STEP_0_ADK_INSTALL_DRYRUN.md (Phase C-2 で作成予定)
```

---

## 4. 取りこぼし確認

- `/AGENTS.md`: 全 27 セクション分類済み
- `/CLAUDE.md`: 全 15 セクション分類済み (6 原則 + 実装作法 4 項目 + プロンプト編集 + やってはいけないこと + チェックリスト + 困った時 + プロジェクト目標)
- `/DESIGN.md`: 全 15 セクション分類済み

取りこぼしゼロ。

---

## 5. ユーザーレビュー依頼

Nekoさん、Ticket A1 (既存設計書の棚卸し) を完了しました。本書 §1 分類結果、§2 要確認項目 (Q1〜Q7)、§3 最終構造 を確認いただき、以下のいずれかでご返答ください:

- `A1 approved` → 全て合意。A2 に進みます
- `A1 approved with Q{N}=<回答>` → 特定の要確認項目に回答を含めて承認
- `revise: <内容>` → 修正指示

特に Q1 (docs/architecture/ 新設の可否)、Q2 (DESIGN.md の取り扱い)、Q7 (未コミット変更整理) はご判断をお願いします。
