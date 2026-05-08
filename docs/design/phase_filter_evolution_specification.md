# Filter Evolution 設計仕様書 (= mutation/crossover 再設計)

> **ステータス**: 設計合意中 (2026-05-08 時点)
> **目的**: 進化ループにおける mutation/crossover の役割を「新戦略の生成」から「騙し (false signal) を除去するフィルタの追加」へ再定義する。surrogate 評価軸に「騙し回避スコア」を追加し、LLM = 構造発見 / Python = 数値最適化 の役割分担を CLAUDE.md 原則に沿って明確化する。
> **前提**: Phase 5A (PR #122-#128) + Phase ⑤A〜⑤E (PR #129-#134) 完了。`StrategyDSL` / `EvolutionLoop` / `MutationAgent` / `CrossoverAgent` / `EvolutionBacktestRun` 既存。
> **位置づけ**: Phase 5B (= 自動昇格) hold 中の活動。Phase 6 メタ進化とは別軸 (= mutation/crossover の意味論変更、Phase 6 はプロンプト進化のメタ層)。

---

## 0. このフェーズの位置付け

### 0.1 動機 (= 5 世代 smoke で観測した問題)

2026-05-08 の本番 smoke (`--regime breakout --top-k 3 --generations 5`) で以下が観測された:

| gen | formalBtCand | formalBtPassed | validationConfirmed | 内訳 |
|-----|--------------|----------------|---------------------|------|
| 1   | 4            | 4              | **3**               | 全て novelty seed (anomaly/range × long/short) |
| 2   | 4            | 4              | **2**               | seed 3 + mutation 1 |
| 3   | 4            | 4              | **2**               | seed 3 + mutation 1 |
| 4   | 3            | 2              | **0**               | mutation 2 + crossover 1 |
| 5   | 2            | 1              | **0**               | mutation 2 |

**世代を経るほど劣化**。さらに crossover は毎世代 5 件生成されているが、5 世代 25 件中 promotion top-K に届いたのは 1 件のみ (= 4%)。**現状の crossover/mutation は novelty seed を超える戦略を生成できていない**。

### 0.2 根本的な問いの転換

Nekoさん の指摘で本質的な再定義が決まった:

> **「crossover/module の役割は『新戦略を作る』ではなく、『既存戦略の騙しを除去する』」**

トレード戦略の本質は次のように分解できる:

```
戦略 = Setup (= base entry trigger、勝率 40-50%) × Filter(s) (= 騙しを除去するゲート)
```

- Setup: HypothesisGenerator / novelty seed が出す「base な entry トリガー」(= EMA cross、RSI threshold、breakout pattern など)
- Filter: 「その entry を実行するか/見送るか」を決定する追加条件 (= 上位足トレンド、ボラレジーム、時間帯、市場構造、ファンダ等)

プロのトレーダーが retail に勝つのはここで、retail は Setup だけで取引するから 40-50% で負け、プロは Filter を重ねて勝率を上げる。**現状の進化ループはこの構造を表現できていない**。

### 0.3 CLAUDE.md 原則との整合

- 原則 3 (LLM の役割を拡張しすぎない): **数値最適化は Python / TS の決定論的コードで実装する**
- 現状の mutation は LLM に「RSI 30 → 25 にして」のような数値変異を依頼しており、これは原則違反
- 本仕様で **mutation の数値変異役割を Python (Optuna) に切り出す**

---

## 1. 全体像 (= 提案する世界観)

### 1.1 役割分担の明確化

| コンポーネント | 役割 | LLM 使用 |
|---------------|------|----------|
| **HypothesisGenerator** | Setup (= base 戦略仮説) の生成、発想の自由度の源 | ✓ (構造発見) |
| **novelty seed** | 12 種固定の base 戦略テンプレート (PR ⑤D-2) | ✗ |
| **Crossover** | 既存 Setup に Filter を追加 (= 騙し除去フィルタ抽出) | ✓ (構造発見) |
| **Mutation** | 役割縮退: repair hint 適用 + 構造的微変異 (新 operator 追加) | ✓ (構造発見) |
| **Python 数値最適化 (M5)** | filter 閾値の bayesian 最適化 (Optuna) | ✗ (決定論) |
| **analysis-engine** | 評価エンジン (Python BT、変更なし) | ✗ |

### 1.2 候補生成のパスフロー (M2-M5 完成後)

```
[HypothesisGenerator (将来強化)]
  └─→ EdgeHypothesis (= 仮説の山)
       └─→ StrategyDSL (= Setup 完成形、setup_only)

[novelty seed]
  └─→ StrategyDSL (= 12 種固定 Setup)

これらが「親 A (Setup)」となる
        ↓
        ↓ + ModuleParent (= Filter 素材、M4 で registry 化)
        ↓
[Crossover (M3 で再設計、prompt = 「親 A の負けトレードを A+F で除去できる Filter を作れ」)]
        ↓
        ↓ child = Setup A + Filter F (= StrategyDSL、構造拡張なしでも表現可能、後述)
        ↓
[Python Optuna 最適化 (M5)]
        ↓
        ↓ child + 最適化された filter 数値
        ↓
[analysis-engine 評価]
        ↓
[Surrogate (M2 拡張、騙し回避スコア追加)]
        ↓
        ↓ filter_score = winRate(A+F) - winRate(A) + safety guard
        ↓
[promotionGate / OOS / validationConfirmed]
        ↓
[feedback (将来 M6+) → HypothesisGenerator / Crossover prompt の学習]
```

### 1.3 DSL 構造拡張 (M1) は **保留**

`entry.setup` / `entry.filters[]` の DSL 構造分離は概念的に綺麗だが:

- 後方互換のため migration / Zod schema 大改修が必要
- M2-M5 は「親子関係 (parentIds) ベースで filter 効果を測定する」アプローチで実装可能
- M2-M5 実装後に「やはり構造分離が必要」と判明したら M1 を着手

→ M1 は **積極的保留** (= 構造分離なしで M2-M5 を進める)。

---

## 2. M2: Win Rate Lift を surrogate に追加

### 2.0 用語選定の経緯

「同じ Setup に filter F を追加して負けが減った/勝率が上がった」を測る指標は **業界にも学術界にも統一名称が存在しない** (2026-05-08 時点で WebSearch + 知識ベース調査済)。

- Curtis Faith の **Edge Ratio (E-Ratio)** は MFE/MAE 比 (= シグナル単体の順行/逆行) で別概念、流用は誤解を招く
- Kaufman 系の業界記事には「Selectivity」「Filter Quality」という慣用表現があるが標準化されていない
- ML/マーケティング分野の **Lift** (Provost & Fawcett 2013, scikit-learn 等で確立) が「Precision の倍率」として概念的に完全一致

→ 本仕様では **"Win Rate Lift" (= Lift)** を正式名称として採用する。Lift は ML 用語として確立されており、「ベースライン勝率に対する改善倍率」という意味が明確。

備考: トレード分野でこの指標が標準化されていないのは設計上の発見。本仕様で内部的に Lift を確立しつつ、将来は外部発信 (= 業界用語化への寄与) も視野に入れる。

### 2.1 評価指標の選定

「騙しを回避できた」を 2 値分類問題として捉える。filter は「取引するか / スキップするか」を判定する binary classifier。

**前提**: 親 A の trade list と 子 A+F (= A から派生した child) の trade list を**同じ評価期間で**比較する。filter は trade を除去するだけで追加しない (= 子の trade list は親の subset、何も除去しない identity filter も legitimate な subset)。

| | A の結果 | A+F の結果 |
|---|---|---|
| **win** | W_A | W_AF |
| **loss** | L_A | L_AF |
| **timeout** | TO_A | TO_AF |
| **total trades** | T_A = W_A + L_A + TO_A | T_AF = W_AF + L_AF + TO_AF |

`winRate = win_count / total_count` で **timeout も分母に含める**。timeout は「勝ちでも負けでもない」中立扱いで勝率を保守的に下げる方向の設計 (= filter で勝ちが timeout 化された場合に勝率が正しく下がる)。

採用指標 (= **Win Rate Lift with safety guard**):

```
winRateLift = winRate(A+F) / winRate(A)
  if W_AF >= 0.7 × W_A           # 勝ちトレードを 30% 以上失わない
  and T_AF >= max(20, 0.3 × T_A) # 取引数を 30% 以上維持 (or 最低 20)
  else 1.0                        # 条件外なら 1.0 (= no improvement、filter 無効)
```

解釈:
- `Lift > 1.0`: filter が勝率を改善した (= 騙し回避効果あり)
- `Lift = 1.5`: 勝率 1.5 倍 (例: 40% → 60%)
- `Lift = 1.0`: filter 無効 (= safety guard で弾かれた、または改善なし)
- `Lift < 1.0`: filter が悪化させた (理論上はあり得ないが、subset でない / 勝ちを多く捨てた場合に発生)

副次観察 (= ログのみ、判定には使わない):
- `filter_precision = ΔL / (ΔW + ΔL)` (= 捨てた中で負けの割合)
- `specificity = ΔL / L_A` (= 元の負けのうち何割除去できたか、= 真陰性率)
- `preserve_win = W_AF / W_A` (= 勝ちを何割維持できたか、= recall)

### 2.2 計算に必要なデータ

**重要な発見** (= 実装時に判明、2026-05-08): `EvolutionBacktestRun` テーブルには
`trades` 列が **存在しない**。`ScreeningBacktestRun` (= EdgeHypothesis 由来) には
あるが、進化候補側 `EvolutionBacktestRun` のスキーマには `trades Json` フィールドが
ない。

既存データだけでは parent 側 trade list を取得できないため、本 PR (M2) では:

- **EvolutionLoop インスタンス内の in-memory map** (`tradesByDslId`) で世代間に
  trade list を保持
- 各候補の formal BT 完了時に entryTime + outcome を抽出してキャッシュ
- 同インスタンスの次世代以降 (= multi-generation 経路) で親候補の trade list を
  参照可能

**制約**:
- 単一世代 smoke では gen 1 親 (= novelty seed) は formal BT 履歴を持たないため
  全件 notComputable で正常
- multi-generation runner (= `--generations 2+`) で gen 2 以降から実 Lift 値が出る
- インスタンス削除で消える (= cron/smoke 1 回ごとに揮発)

利用するデータソース:
- 親 A の trade list: `tradesByDslId.get(parentDslId)` (= prior 世代で保存済み)
- 子 A+F の trade list: `verifyResults` の各 entry の `trades` フィールド
- 親子関係: `dsl.parentIds[0]` (= 第一親、設計書 §2.3)
- BT サマリ: `EvolutionBacktestRun.formalBtMetrics` (= 既存)

**将来 PR**: `EvolutionBacktestRun` に `trades Json` 列を追加する DB migration を
別 PR で対応すれば、cross-instance 分析や resume 対応が可能になる (= M2 完了後に
判断、CLAUDE.md の「DB schema 変更は migration 必須レビュー対象」原則に従う)。

### 2.3 計算経路の設計

子候補 C を評価する時点で:

1. C.dsl.metadata.parentIds[] から親 A の dslId を抽出
2. 親 A の最新の `EvolutionBacktestRun` (同じ evolutionRunId 内) を DB から取得
3. 親 A の trade list と 子 C の trade list を比較
4. winRateLift を計算
5. 観測ログ (`errors[]` 配列に `[info] win rate lift dslId=... lift=... preserved_win=... specificity=...`) として残す

注意点:
- 親 A が EvolutionBacktestRun を持っていない (= formal BT 未実行) 場合は winRateLift 計算不能 → `notComputable: 'parent has no formal BT result'`
- 親 A の trade list と子 C の trade list が異なる period で評価されている場合は計算しない (= period mismatch)
- 子 C が親 A の **全ての** trade を保持しているとは限らない (= filter が rejection だけでなく entry timing もずらす場合) → trade list の入れ子関係を確認、subset でなければ `notComputable: 'not a strict subset'` でログ

### 2.4 実装スコープ (M2 単独 PR)

実装ファイル:
- `src/shared/statistics/winRateLift.ts` (新規、TS): winRateLift 計算 helper
- `analysis-engine/app/statistics/win_rate_lift.py` (新規、Python): 同期実装 (将来 Python 経路で使う場合用、今は使わない)
- `src/side-b/evolution/EvolutionLoop.ts`: 既存の DSR 観測ログと並列で winRateLift 観測ログ追加

PR 粒度:
- M2 単独で 1 PR (= 「観測のみ」、surrogate 選抜には使わない)
- 1〜2 世代観察してから「winRateLift を selection に組み込む」を別 PR で判断

### 2.5 観測フェーズの目的 + mutation 撤廃判断

実装後、5 世代 smoke + 5 回繰り返し smoke で以下を観察:

- **Lift の分布** (= > 1.0 / = 1.0 / < 1.0 の比率)
- safety guard でどれくらい弾かれるか
- **crossover 由来 child と mutation 由来 child で Lift に差があるか** (= mutation 撤廃の早期判断材料)
- novelty seed → mutation/crossover で Lift が改善する世代があるか

**M2 観察直後の mutation 撤廃判断条件 (= 早期判断、M3 を待たない)**:
- mutation 由来 child の Lift がほぼ全て 1.0 (= safety guard で弾かれる、または改善なし)
- かつ crossover 由来 child は Lift > 1.0 を出すことがある
- → この場合、**mutation を撤廃して crossover + Python 最適化に集約** する判断材料になる

逆に mutation 由来 child でも Lift > 1.0 が時々出るなら、mutation の構造変異役割は維持して repair 専用に縮退、を選ぶ。

→ M2 観察結果を見て、M3 着手前に Nekoさん と「mutation の処遇」を決定。

---

## 3. M3: crossover prompt を「filter 追加」専用に再設計

### 3.1 現状の crossover prompt (PR ⑤C 改修後の状態)

現状: 「親 A と親 B から child を作る」(= 戦略の混合)
問題: child が「どの部分を残し、どの部分を捨てたか」が不明確、結果として top-K 選抜で novelty seed に負ける。

### 3.2 新 crossover prompt の方向

入力:
- 親 A の DSL
- 親 A の **負けトレード list** (= entry context、市場状況、損切りに至った経緯)
- 親 B (or ModuleParent) の DSL / module spec

LLM への要求:
- 親 A の負けトレードに共通する特徴を抽出
- 親 B / module の中から「その負けを排除する filter 条件」を選び出す
- child = 親 A + 抽出した filter (= 親 A の DSL に新しい condition を AND 追加)

期待される出力フォーマット:
```json
{
  "child_dsl": { ... 親 A の DSL に condition 追加 ... },
  "rejected_loss_count": 12,    # 親 A の負け 30 件中 12 件を filter で除去できる見込み
  "preserved_win_count": 28,    # 親 A の勝ち 30 件中 28 件は filter 通過
  "rationale": "親 A は range bound で entry しがち。親 B の time_session.is_friday_close を AND 追加して週末限定にすることで、平日の range range 騙しを除去する。"
}
```

LLM の役割は「構造発見 + 解釈」(= CLAUDE.md 原則 OK)。LLM が出した数値 (rejected_loss_count 等) は参考情報、実際の評価は analysis-engine + winRateLift で行う。

### 3.3 実装スコープ (M3 単独 PR)

実装ファイル:
- `src/side-b/prompts/crossover.md`: prompt 全面書き換え
- `src/side-b/agents/CrossoverAgent.ts`: 入力に親 A の負けトレード list を追加、出力 schema 拡張
- `src/side-b/evolution/EvolutionLoop.ts`: 親 A の負けトレード list を CrossoverAgent に渡す経路追加

PR 粒度: M3 単独で 1 PR。M2 完了後に着手 (= filter_score 観測軸が動いていることが前提)。

### 3.4 mutation の処遇 (= M2 観察後に早期判断)

Nekoさん 方針: **mutation は撤廃寄り**。M2 観察 (= winRateLift 分布データ) を踏まえて以下のいずれかを M3 着手前に決定:

- (A) **完全撤廃**: M2 で mutation 由来 child の Lift がほぼ全て 1.0 だった場合。crossover + Python 最適化のみに集約。MutationAgent / mutation prompt 削除。
- (B) **repair 専用に縮退**: M2 で mutation 由来 child が時々 Lift > 1.0 を出すが crossover ほどではない場合。failureReason → RepairHint 経路 (PR #100) のみに用途を絞り、通常の mutation route は削除。
- (C) **構造変異専用**: M2 で mutation が新規 operator 追加 (cross_above 等) で固有の貢献をしている場合。crossover が組合せ、mutation が新規構造、と役割明確化。

着手判断は Nekoさん の合意必須 (= 「勝手に決めない」原則)。デフォルト想定は (A) 撤廃。

---

## 4. M4: ModuleParent registry 化 (= filter 素材ライブラリ)

### 4.1 ModuleParent の概念

現状の crossover は親 2 つとも StrategyDSL。新たに「ModuleParent」型を導入し、**filter 素材**として crossover に渡せるようにする。

ModuleParent の種類 (= 既存資産から流用):

| 種類 | 出処 | 例 |
|------|------|------|
| **MTF Filter** | shared/timeframes / PR ⑤A〜⑤B | 上位足 EMA200 上で long のみ取る |
| **TimeSession Filter** | src/side-b/lenses/TimeSessionLens (PR ⑤D-1) | Friday close 限定、ゴトー日除外 |
| **Pattern Filter** | shared/patterns (PR ②-1, PR #126) | 直前にハラミ反転パターンが出てない |
| **Market Structure Filter** | dow_theory lens | trend_state == "uptrend" のみ |
| **Volatility Filter** | shared/indicators (ATR, BB) | ATR が一定範囲 (低すぎ/高すぎ除外) |
| **将来: Fundamentals Filter** | FundamentalsResearcher (memory project_fundamentals_researcher.md) | 重要指標発表時間外、米雇用統計後 1h 除外 |

### 4.2 ModuleParent の選別ロジック

crossover に渡す ModuleParent をどう選ぶか:

- **静的選択**: 親 A の regime / timeframe / direction から「相性の良い filter 種別」をハードコードで選ぶ
- **novelty 重視**: 直近 N 世代で使われていない filter 種別を優先
- **学習 (将来)**: validationConfirmed に届いた child が使った filter 種別の頻度から重み付け

M4 の MVP では **静的選択** (= 親 A 1 つに対して 3〜5 種類の ModuleParent を candidate として渡し、LLM に選ばせる) で開始。

### 4.3 実装スコープ (M4 単独 PR)

実装ファイル:
- `src/side-b/evolution/moduleParentRegistry.ts` (新規): ModuleParent の registry + selection ロジック
- `src/side-b/evolution/parentPoolPolicy.ts`: ModuleParent を crossover 親として渡す経路追加 (= 既存 ParentPoolEntry を拡張)
- `src/side-b/agents/CrossoverAgent.ts`: ModuleParent を受け取る経路 (M3 と並列)

PR 粒度: M4 単独で 1 PR。M3 と前後関係は要検討 (= M3 が ModuleParent 必須なら M4 → M3 順、そうでないなら M3 → M4 順でも可)。

→ **暫定: M2 → M4 → M3 → M5 の順** (= M2 で評価軸、M4 で素材準備、M3 で素材を使う prompt、M5 で数値最適化)。

---

## 5. M5: Python 側で filter parameter 最適化 (Optuna)

### 5.1 動機

CLAUDE.md 原則 3:「数値最適化は Python の役割」。

現状: LLM (mutation/crossover) が「RSI 50 → 55 にする」のような数値変異を出力。これは:
- 探索空間が制限される (= LLM が思いつく値しか試さない)
- 決定論的でない (= 同じ親から違う数値が毎回出る)
- 収束しない (= bayesian 等の最適化アルゴリズムを使えない)

LLM = 構造発見、Python = 数値最適化、で役割分担を綺麗にする。

### 5.2 設計

crossover/mutation で生成した child は **「構造 + 初期数値」** のセット。これを Python Optuna で `parameters.{}` だけ最適化する step を追加:

```
[Crossover/Mutation] → child (= 構造 + 初期数値) 
        ↓
[Python Optuna step (M5、新規)]
        ↓ 構造固定、parameters.{} のみ bayesian 最適化
        ↓ 評価関数 = analysis-engine 上で BT を回して PF or filter_score を返す
        ↓
        ↓ child' (= 構造 + 最適化済数値)
        ↓
[Surrogate 評価]
[analysis-engine 正式 BT]
```

最適化対象:
- DSL の `parameters.{}` キー (= entry threshold、SL/TP 倍率、filter 閾値)
- 整数性が必要な key (= period、lookbackBars 等) は `INTEGER_PARAM_KEYS` (PR #120 で導入) を尊重して int 制約
- 探索範囲は DSL に `parameter_ranges.{}` を追加 (= optional、未指定なら ±50% range)

### 5.3 実装スコープ (M5 単独 PR)

実装ファイル:
- `analysis-engine/app/optimization/optuna_runner.py` (新規): Optuna による parameter 最適化エンドポイント
- `src/side-b/evolution/parameterOptimizationStep.ts` (新規): Optuna 結果を取得して child の parameters を上書きする step
- `src/side-b/evolution/EvolutionLoop.ts`: surrogate 前に optuna step を挿入 (= optional、初期 disable で観察開始)

PR 粒度: M5 単独で 1 PR。M3 完了後に着手 (= filter 追加経路が動いてから数値最適化を上乗せ)。

### 5.4 開いた論点

- Optuna の trial 数 (= 1 child あたり 30〜100 trials? コストとのバランス)
- 最適化対象の評価関数 (= PF / winRate / filter_score / 複合)
- 「最適化が効かない」child は構造的に弱い → 廃棄判断ロジック
- 既に最適化済の child を再最適化しないキャッシュ (= structure hash ベース)

---

## 6. 全体マイルストーン

### 6.1 着手順序

| 順 | M | 概要 | PR 規模目安 | 依存 |
|---|---|------|------------|------|
| 1  | M2 | filter_score 観測ログ追加 | small (~100 行) | なし |
| 2  | M4 | ModuleParent registry | medium (~200 行) | M2 (= 評価軸先行) |
| 3  | M3 | crossover prompt 再設計 | medium (~prompt 全面 + agent 改修) | M2 + M4 |
| 4  | -  | (観測フェーズ、smoke + 評価データ収集) | - | M3 |
| 5  | M5 | Python Optuna 数値最適化 | large (~analysis-engine 拡張) | M3 (= 構造側が安定してから数値) |

### 6.2 観察ベースの判断ポイント

各 M の後で smoke 観察を必ず挟む:

- M2 後: 既存戦略で filter_score がどう出るか観察 (= ベースライン)
- M4 後: ModuleParent が parent pool に流れてるか観察
- M3 後: filter_score の中央値が改善するか観察、validationConfirmed が増えるか
- M5 後: 数値最適化で filter_score がさらに改善するか観察

### 6.3 PR 命名規則 (案)

- M2 PR: `feat(evolution): Win Rate Lift 観測 (M2)` 
- M4 PR: `feat(evolution): ModuleParent registry (M4)`
- M3 PR: `feat(prompts): crossover を filter 追加専用に再設計 (M3)`
- M5 PR: `feat(optimization): Python Optuna による parameter 最適化 (M5)`

---

## 7. 既存設計との整合性

### 7.1 Phase 5B (= 自動昇格) hold との関係

memory `project_phase_5b_hold.md`: 「Phase 6 完了 + 運用観察データ確認まで着手しない」

本仕様 (Filter Evolution) は Phase 5B とは **別軸**:
- Phase 5B = 候補 → confirmed の自動昇格
- Filter Evolution = mutation/crossover の意味論変更

→ Phase 5B hold を維持したまま Filter Evolution に着手して問題なし。むしろ Filter Evolution で validationConfirmed が連続して出るようになれば、Phase 5B 解除の判断材料になる。

### 7.2 Phase 6 (= プロンプト進化、メタ進化) との関係

Phase 6 (memory `project_phase_6_completed.md`) は **mutation/crossover prompt 自体を進化対象にする層**。

- 本仕様の M3 で crossover prompt を再設計する → これは Phase 6 のメタ進化の対象
- M3 で固定的に prompt を書いても、Phase 6 が動けば自動的に進化していく
- → **本仕様は Phase 6 と co-exist**、Phase 6 の進化対象としての base prompt を提供する

### 7.3 既存 PR との互換性

- PR #100 (RepairHint v1): mutation の repair 適用は維持。役割再定義時に整理
- PR #102 (RepairOutcome Telemetry): filter_score と並列の観測軸として共存
- PR #103-#105 (OOS / PromotionGate): 評価エンジンは触らない、filter_score は観測軸の追加のみ
- PR #107 (Adaptive Repair Budget): mutation 量の bounded 調整、filter_score を将来の判定軸候補に
- PR #108 (Quality-Diversity Archive): cell key に filter_score 軸を追加するか要検討
- PR ⑤A〜⑤E: setup 側の表現力強化、本仕様は filter 側の追加

---

## 8. リスク / 開いた論点

### 8.1 確認済 (Nekoさん 合意、2026-05-08)

- ✅ 評価指標 = **Win Rate Lift** (= ML/マーケティングの Lift を流用、業界に統一名称が存在しない事実を確認)
- ✅ 副次観察として filter_precision / specificity / preserve_win もログに残す
- ✅ DSL 構造分離 (M1) は保留、M2-M5 は親子関係 (parentIds) ベースで実装
- ✅ mutation は撤廃寄り、M2 観察直後に判断 (M3 着手前)
- ✅ mutation の数値変異役割は Python (Optuna) に切り出す
- ✅ 着手順序 = M2 → M4 → M3 → M5
- ✅ 設計書は M2 PR と同梱でコミット

### 8.2 後続で詰める論点

- ModuleParent の選別ロジックを学習化するタイミング → M4 後の観察で判断
- Optuna の trial 数 / 評価関数 / コスト管理 → M5 着手時に詳細設計
- winRateLift を surrogate selection に組み込むタイミング → M2 観察後に判断
- 「参照すべき失敗 / 参照すべきでない失敗」の区別 (= RepairHint の質判定) → mutation 処遇決定後に整理
- 業界用語化への寄与可能性 (= 「Win Rate Lift」を外部発信するか) → M3 安定後に検討

### 8.3 既知のリスク

- **親子の trade list 比較が strict subset でないケース** (= filter 以外の理由で trade が変わる) → notComputable で逃がす実装
- **親 A の formal BT 結果がまだない子候補** → filter_score 計算不能、選抜には使わない
- **LLM が「親 A の負けを除去する」と称して overfit な filter を作る** → OOS で hold される設計が活きる
- **Python Optuna が「LLM が出した 50」を「48.7」のような半端値に最適化** → INTEGER_PARAM_KEYS で整数性強制 (PR #120 既存)

---

## 9. 完了条件 (= 各 M の DoD)

### M2 完了条件
- [ ] `winRateLift.ts` 実装 + 単体テスト全 pass
- [ ] EvolutionLoop で winRateLift 観測ログが出力される (= `[info] win rate lift dslId=... lift=... preserved_win=... specificity=...`)
- [ ] 5 世代 smoke で全 candidate で観測ログが出る (= notComputable も含めて全件)
- [ ] PR コメントに「観測のみ、selection には未影響」と明記
- [ ] 設計書 (本ファイル) を同梱コミット

### M4 完了条件
- [ ] `moduleParentRegistry.ts` 実装 + 単体テスト
- [ ] 5 種以上の ModuleParent が registry に登録 (MTF / TimeSession / Pattern / dow_theory / volatility)
- [ ] parentPoolSummary に moduleParent 由来 entry がカウントされる
- [ ] CrossoverAgent が ModuleParent を受け取れる (interface のみ、prompt 改修は M3 で)

### M3 完了条件
- [ ] crossover prompt 再設計 (`src/side-b/prompts/crossover.md`)
- [ ] CrossoverAgent が親 A の負けトレード list を受け取る
- [ ] 5 世代 smoke で crossover 由来 child が **少なくとも 1 つ以上 promotion top-K に届く**
- [ ] 5 回繰り返し smoke で filter_score の中央値が観測される

### M5 完了条件
- [ ] `analysis-engine/app/optimization/optuna_runner.py` 実装
- [ ] EvolutionLoop に optuna step が optional に組み込まれる
- [ ] 5 世代 smoke で optuna 有効 / 無効を比較、効果のある parameter 種別が特定される
- [ ] INTEGER_PARAM_KEYS 整数性制約が守られる

---

## 10. 参考資料

- `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` (= 全体設計書、進化ループの位置づけ)
- `CLAUDE.md` (= 6 原則、特に原則 3「LLM の役割を拡張しすぎない」)
- `docs/design/phase_5a_specification.md` (= 進化ループ基盤)
- memory `project_critical_4_progress.md` (= PR 履歴)
- Bailey & López de Prado (2014) "The Deflated Sharpe Ratio" (= PR ⑤E、関連の評価指標議論)
- Lehman & Stanley (2011) "Abandoning Objectives — Evolution Through the Search for Novelty Alone" (= PR ⑤E、novelty seed の根拠)

---

**Why:** 5 世代 smoke で観測した「mutation/crossover が novelty seed に勝てない」問題に対して、根本的に役割再定義する設計。crossover を「騙し回避フィルタ追加器」に再定義し、surrogate に「騙し回避スコア」を追加することで、戦略の質的進化を取り戻す。

**How to apply:** M2 → M4 → M3 → M5 の順で着手。各 M 後に必ず smoke 観察を挟み、次の M の方針判断材料とする。Phase 5B hold は維持、Phase 6 メタ進化と co-exist する設計。
