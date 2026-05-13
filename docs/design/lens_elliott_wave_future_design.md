# Lens: Elliott Wave 将来構想 (Phase 8 用、未着手)

> **作成日**: 2026-05-14
> **位置づけ**: Phase 8 (エリオット波動 Lens 実装) 着手時の **設計たたき台**。Phase 7 (SMC / ChartPattern / Wyckoff) の議論中に Nekoさんが共有した構想を保存し、ゼロから議論を再開しないようにする
> **ステータス**: ⬜ 未着手 (Phase 7 完了 + Step 4 完了後に再評価して着手判断)
> **発注者**: Nekoさん
> **依存関係**: Phase 7 で実装する SMC / ChartPattern / Wyckoff Lens (= エリオットの「不確実性を他レンズで補う」前提)

---

## 1. 背景

### 1.1 なぜエリオットを Lens にしたいか

Nekoさんがマーケット観測のために重視する 6 カテゴリ (チャートパターン / ローソク足 / SMC / エリオット / ダウ・ワイコフ / P&F) のうち、**エリオット波動** は判断主体によって解釈が大きく変わる難しさを抱える一方で、トレード判断に組み込む価値は高い。

> 「(エリオット波動は) 判断主体が決める波の起点によって状況がかなり変わってくるけど、そういう不確実性も他のレンズで補いながら、今マーケットがどんな状態にあるのかを推測してトレードに生かしていくのが理想」
> — Nekoさん 2026-05-14

### 1.2 エリオット採用のドメイン原則上の制約

`/AGENTS.md` のドメイン原則 §「やってはいけないこと」より:

- 「エリオット波動のカウントを**一意に決める**」アルゴリズムを書いてはいけない → **確率分布で扱う**
- ユーザーに「エリオット ON/OFF」のスイッチを提供して内部ロジック分岐させない → **検索時重み付けで実現**

つまり、決定論的に 1 波カウントを返す Lens は禁止。**複数候補を確率分布として保持し、他レンズと統合して状態推測する** 仕組みが必要。

---

## 2. Nekoさん構想 (原文ベース、2026-05-14)

> 結局はインパルスがあるかどうかっていうところが大事だと思ってて、そのルール通りにインパルスが発生したのかどうかが大事。でもそれも人それぞれ違う。
>
> だからやっぱり起点っていうのはユーザーが選んだりとか、要は判断主体が判断できるための情報を、例えば UI 上から、起点にするとしたら「このバー、このバー、このバー」みたいな感じで選択肢を渡して、オプションでね。で、ユーザーが選択した起点から、エリオットが今どこの状況にいるっていうのを推論して、その波が、完成してるとは限らないからそれも推論して、レンズとして AI の推論フローに入れてくっていうのが多分 1 番現実的なのかなとは思う。
>
> 結構実装が本当に大変だなと思うし、エリオットはもっとしっかり考えないといけないなとは思う。僕は感覚で使っちゃうけど、なかなかそれはまた難しい話になっちゃうしさ。

### 2.1 構想の核心 (3 つの判断)

1. **インパルスの有無が本質**: エリオットの完璧なカウントよりも「ルール通りのインパルスが発生したか」を判定するのが第一義
2. **起点はユーザー選択**: 自動判定ではなく、UI 上で起点候補のバーを提示 → ユーザーが選択 → 選択された起点を基準に推論。完全自動化を諦める代わりに「ユーザーの感覚」を直接組み込む
3. **波の完成度も推論対象**: 完成済みの波だけでなく「形成中の波」も含めて推論し、他レンズと統合

---

## 3. 設計上の課題 (Phase 8 着手時に詰めるべき論点)

### 3.1 確率分布の表現方式

`AdkTraceEvent.argsSummary` 等の **redaction 制約** の中で、wave count の確率分布をどう持つか:

| 案 | 内容 | 評価 |
|---|---|---|
| A. top-N candidate + score | 上位 N (例: 3) の wave count 候補 + 各 score (0-1) | シンプル、`LensFeature.features` に乗せやすい |
| B. 全 wave 位置の確率テンソル | 各バー × 各 wave label の確率行列 | 表現力高いが redaction 困難 |
| C. 候補波 + Fibonacci 整合度のスカラー | 「候補 X、fib_compliance=Y」のフラット表現 | 解釈しやすいが情報量低 |

**Phase 8 着手時の推奨**: 案 A から始める。

### 3.2 起点選択 UI の設計

- どの画面で起点を選ぶか (= Side-A ノート UI / Side-B 専用 UI / 共通)
- 起点候補をどう絞るか (= ピボット検出 → 上位 N 候補を提示)
- 「起点を選ばない」モードはあるか (= デフォルト起点を AI が選ぶ妥協案)

`DESIGN_DOC_autonomous_trading_architecture.md` §「人間とのインタラクション」と要整合性確認。

### 3.3 波の完成度推論

- 完成波 (= 5 波 / 3 波が確定) と未完成波 (= 形成中) の判定境界
- 「未完成波」の場合の features 表現 (= confidence を下げる / 別 feature key で区別)

### 3.4 他レンズとの統合 (= 不確実性を補う)

Nekoさん構想の核心は「エリオット単独で結論を出さず、他レンズで補う」こと。Phase 7 完了時点で揃っている Lens 群:

- ChartPatternLens (フラッグ / 三角持ち合い / H&S 等の N-bar 構造)
- SMCLens (BOS / CHOCH / OB / FVG / liquidity)
- WyckoffLens (アキュム / ディストリの phase)
- DowTheoryLens (ピボット起点 trend 判定)
- CandlePatternLens (ローソク足 12 種)
- VolatilityRegimeLens (ボラ環境)
- TimeSessionLens (時間帯)
- CurrentAnalysisLens (既存 MarketAnalysis ラップ)

→ エリオットの wave count 候補と、他レンズの構造観測 (特に SMC BOS / Wyckoff phase / DowTheory trend) の **整合性を検証** することで「もっともらしさ」を高める設計。

具体例:
- 候補 1: 「3 波目の途中」+ SMC BOS_BULL + Wyckoff Markup phase → 整合性高、score 上げ
- 候補 2: 「5 波目完了」+ SMC CHOCH_BEAR + Wyckoff Distribution → 整合性高、score 上げ
- 候補 3: 「1 波目開始」+ SMC BOS_BEAR → 矛盾、score 下げ

### 3.5 EvolutionLoop での扱い

エリオット features は他 Lens と並列に LensAggregator に統合される。`strategy_dsl` の条件式で `wave_top1_label` / `wave_top1_score` 等のフラット key 群 (§3.1 案 A) を参照する形になる。配列アクセス (`wave_count_top3[0]` 等) は `LensFeature.features` の型制約上できないため、Phase 8 着手時に DSL 文法側で追加対応が不要であることを確認する。

---

## 4. Phase 8 着手時の検討事項チェックリスト

Phase 8 KICKOFF 作成時にこれらを論点として詰める:

- [ ] §3.1 確率分布の表現方式 (案 A / B / C のいずれか) を確定
- [ ] §3.2 起点選択 UI の配置・操作モデルを確定
- [ ] §3.3 波の完成度推論の境界定義を確定
- [ ] §3.4 他レンズ統合のスコアリング設計を確定
- [ ] §3.5 DSL 表現力の確認、不足あれば DSL 拡張の判断
- [ ] エリオット計算ロジックを analysis-engine (Python) と side-b (TypeScript) のどちらに置くか
- [ ] テスト戦略: wave count の決定論性をどう検証するか (= 確率分布なので「同入力同出力」は score の同一性まで)
- [ ] フィボナッチリトレースメント / エクステンションとの統合 (`fib_compliance_score` 等)

---

## 5. 着手判断の前提条件

Phase 8 着手は以下が満たされた後に再評価する:

1. **Phase 7 完了** — SMC / ChartPattern / Wyckoff Lens が揃い、エリオットの「不確実性を補う」体制が機能している
2. **Step 4 完了** — ADK ParallelAgent で Lens 群が観測可能、エリオットも同枠で観測できる前提が確立
3. **Step 4 までの運用観察** — Phase 7 で揃えた Lens 群が、`AITradeNote` や `EdgeLedger` の判断材料として実際に効いているか観測
4. **Nekoさんがエリオットの設計を「考えきった」状態に到達** — 本書時点では「もっとしっかり考えないといけない」 (2026-05-14 発言)

→ Phase 7 / Step 4 完了後、Nekoさん判断で Phase 8 KICKOFF 作成 → 着手。

---

## 6. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`phase_6_specification.md`](./phase_6_specification.md) | §9.1 で Phase 8 = Elliott と既定 |
| [`phase_7_specification.md`](./phase_7_specification.md) | Phase 7 (SMC / ChartPattern / Wyckoff) KICKOFF。Phase 8 の前提となる Lens 群を整える |
| [`DESIGN_DOC_autonomous_trading_architecture.md`](./DESIGN_DOC_autonomous_trading_architecture.md) | §4 Lens 基盤、§ 人間とのインタラクション |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 (エリオットを一意に決めない、確率分布で扱う、検索時重み付けで実現) |
| [`/src/side-b/AGENTS.md`](../../src/side-b/AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |
| [`/src/side-b/lenses/types.ts`](../../src/side-b/lenses/types.ts) | `Lens` interface (= 新規 Lens は本 interface を実装) |

---

> **本書の位置づけ**: 設計**たたき台**であり、Phase 8 着手時に **これを上書き** して正式仕様書を作る前提。「Nekoさんの 2026-05-14 時点の構想」を凍結保存することが第一の目的。
