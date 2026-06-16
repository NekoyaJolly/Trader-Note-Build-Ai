# ノート類似度判定基盤 設計書（正本）

> **ステータス**: 正本（v0.2、2026-06-09 確定）— Side-A 類似度判定基盤の単一の真実。主要設計判断は確定済み（§8 テーブル B / §5.4 コア指標 / §6.3-6.4 重み・しきい値ユーザー設定 / §6.2 enum 部分点）。実装はこれに従う。実装時のローカル詳細はこの正本に追補して更新する。
> **位置づけ**: Side-A / Side-B 共通の「ノート特徴表現」と「類似度判定」の **将来正本**。ここで決めた基盤の上に、ノートのマッチング・通知・振り返りが乗る。後戻りが効きにくい層のため、**拡張は加算的・破壊は最小**を最優先原則とする。
> **責務**: 「ノートとは何か（特徴表現）」と「現在市場との類似度をどう測るか」を一意に定義する。個々のレンズ・インジケーターのアルゴリズム詳細、UI、通知チャネルは対象外（別ドキュメント）。
> **背景**: 現状 Side-A のマッチングは作成時と照合時で別実装の特徴量を比較しており構造的に機能していない（§1）。本設計はその根本解決を兼ねる。
> **関連**: `docs/side-a/golden-path.md`（正規マッチング経路）、`docs/architecture/side-b-architecture.html`（Side-B 設計正本）、memory `project_note_unification_side_ab`。

---

## 0. 用語

| 用語 | 定義 |
|---|---|
| **ノート** | 1 トレード（人間の実トレード = Side-A / AI の仮想トレード = Side-B）の「まとめ」1 枚。振り返りの単位であり、マッチングの単位。 |
| **レンズ (Lens)** | 市場のある側面を「意味づけ済み・正規化済みの名前付き特徴」として出力する純粋関数。副作用なし・他レンズ非依存・決定性あり（Side-B ドメイン原則 §4 準拠）。 |
| **状態レンズ** | 市場の全体像（レジーム・構造・トレンドの質・心理段階）を捉える holistic なレンズ。例: Dow / Wyckoff / SMC / Volatility / TimeSession。 |
| **インジケーターレンズ** | RSI・MACD・移動平均など、トレーダーが注視する指標の「動向」を捉える fine なレンズ。**トレーダーごとに選択・パラメータが変わる**（IndicatorProfile 駆動）。値計算は analysis-engine。 |
| **LensSnapshot** | ある時刻 (eventTime) における、有効な全レンズの出力をまとめた特徴の束。**ノートの特徴表現の正準形**。 |
| **類似度判定** | 2 つの LensSnapshot（ノート側 vs 現在市場側）の近さを 0〜1 で測り、閾値で発火（通知候補化）するプロセス。 |

---

## 1. なぜ作り直すか（現状の破綻）

現行 Side-A マッチング（`checkForMatches → createNoteEvaluator → evaluate`）は、**ノートの保存ベクトルとライブ市場ベクトルを別々のコードで生成して比較**している。

- 市場側 = `featureVectorService.generateFeatureVector`（12次元・エンコードA）
- ノート側 = 作成経路で別実装:
  - `__AI_AUTO__` → `calculate12DFeatures`（独自12次元・エンコードB。同じ次元でも -1/0/1 と 0/0.5/1 等エンコードが食い違う）
  - プロファイル/ユーザー指定 → `extractFeaturesWithIndicators`（7+N次元・正規化なし）→ 次元不一致で **cosine 0 = 永遠に不一致**
  - レガシー → `extractFeatures`（7次元）→ 同上

結果として **`__AI_AUTO__` 以外は事実上マッチせず、`__AI_AUTO__` でも別実装比較で不正確**。さらに「トレーダーが選ぶインジケーター」を表す `IndicatorProfile` はマッチングに**配線されていない**。

**教訓（本設計が守る不変条件）**:
1. **作成時と照合時は、同一の特徴定義・同一のコードで特徴を生成する。**
2. **可変性は「ベクトル次元の増減」ではなく「レンズの選択と重み」で表現する。**（次元不一致を原理的に消す）
3. **計算は analysis-engine に一元化**（真実の単一ソース）。

---

## 2. 設計原則（不変条件）

1. **単一特徴定義**: ノート特徴 = `LensSnapshot`。作成時も照合時も同じレンズ群・同じ実装で生成する。
2. **全部レンズ**: 状態もインジケーターも「レンズ」という 1 つの抽象に統一する。レンズは 2 系統（状態 / インジケーター）。
3. **名前付き・正規化済み**: 各特徴はキー名を持ち、値域は規定（数値は [0,1] か [-1,1]、列挙は固定集合、真偽は bool）。次元位置ではなく**キー**で対応づける。
4. **加算的拡張**: 機能追加はレンズ追加・特徴キー追加で行う。**既存キーの意味・値域・正規化は変えない**（変える場合は新キー or lensVersion 上げ）。
5. **欠損に強い**: あるレンズが計算不能（データ不足等）なら、そのレンズを**比較から除外 or 低重み化**する。**全体を 0 にしない**（現行 cosine-0 の脆さを排除）。
6. **決定性**: 同一入力 → 同一出力。レンズは純粋関数（Side-B ドメイン原則 §4）。
7. **計算の一元化**: 指標・パターン等の計算は analysis-engine が正。TS 側で再計算しない。
8. **バージョニング**: `LensSnapshot` はスキーマ版とレンズ版を持ち、再現性・移行性を担保する。
9. **両サイド対称**: Side-A・Side-B のノートは同じ `LensSnapshot` を持つ。どちらで作られたノートも、もう片側のマッチングに乗せられる（相互運用）。

---

## 3. 特徴表現: LensSnapshot

### 3.1 構造

```jsonc
{
  "snapshotSchemaVersion": "1.0.0",        // 本スキーマの版（破壊的変更時のみ上げる）
  "symbol": "USDJPY",
  "timeframe": "15m",
  "higherTimeframe": "1h",                 // 任意。MTF 文脈
  "eventTime": "2026-06-05T13:00:00Z",     // ノート=トレード時刻 / 市場側=評価時刻
  "lenses": {
    "<lensId>": {
      "lensVersion": "1.0.0",
      "confidence": 0.0,                   // 0〜1。データ不足・低確度なら下げる
      "features": {
        "<featureKey>": <number | string | boolean>
      }
    }
  }
}
```

- `lenses` は **マップ（lensId → 出力）**。次元位置に依存しない。
- 各 `featureKey` は §4 / §5 のカタログで値域・意味を定義する。
- `confidence` は類似度集計（§6）で重みに反映。

### 3.2 2 系統のレンズ

| 系統 | lensId 例 | 既存実装 | 役割 |
|---|---|---|---|
| **状態レンズ** | `current_analysis` / `time_session` / `dow_theory` / `volatility_regime` / `smc` / `chart_pattern` / `wyckoff` / `pattern` | あり（8つ、`src/side-b/lenses/`） | 市場の全体像・構造・心理段階 |
| **インジケーターレンズ** | `ind:rsi` / `ind:macd` / `ind:ma` / `ind:bb` / `ind:stochastic` … | **未実装（本設計で新設）** | トレーダーが注視する指標の動向。`IndicatorProfile` で選択・パラメータ可変。値は analysis-engine |

> **状態レンズはそのまま再利用**する（出力キーは現行実装準拠、§4 にカタログ化）。**インジケーターレンズは本設計で新設**する（§5）。

---

## 4. 状態レンズ カタログ（既存・再利用）

各レンズの出力キーは現行実装（`src/side-b/lenses/`）に準拠。**正準カタログとして固定**し、変更は加算的に行う。代表例（全キーは実装参照）:

| lensId | 主な featureKey（型・値域） | 粒度 |
|---|---|---|
| `dow_theory` | trend_state(enum) / trend_phase(enum) / pullback_active(bool) / pullback_depth_pct(0-100) / trend_duration_bars(int) … | 状態 |
| `volatility_regime` | regime_label(enum) / bb_width_percentile(0-100) / atr_percentile(0-100) / is_squeeze(bool) … | 状態 |
| `smc` | current_zone(enum PREMIUM/DISCOUNT/EQUILIBRIUM) / zone_position_pct(0-1) / last_structure_event(enum) / nearest_ob_*_distance_pips … | 状態 |
| `wyckoff` | wyckoff_phase(enum) / wyckoff_phase_confidence(0-1) / spring_detected_*(bool) … | 状態 |
| `chart_pattern` | pattern_detected(enum) / pattern_confidence(0-1) / pattern_direction_bias(enum) … | 状態 |
| `pattern` | pinbar/hammer/engulfing_*/doji …（bool 12種） | fine（形状） |
| `time_session` | is_tokyo/is_london/is_newyork/overlap…(bool) | 状態 |
| `current_analysis` | regime(enum) / trend_strength(0-1) / support_proximity(0-1) … | 状態 |

> 値域が未正規化のキー（例: `*_pips`, `*_bars`）は §6.2 の正規化規約に従って比較時に正規化する（生値は保存、比較時に正規化）。

---

## 5. インジケーターレンズ（新設）

### 5.1 考え方

- トレーダーは「使うインジケーターも値も違う」。これを **`IndicatorProfile`（既存）が「どのインジケーターレンズを、どのパラメータで有効化するか」を決める**ことで表現する。
- 各インジケーターレンズは、analysis-engine の `/v1/indicator-series`（~20指標: rsi/macd/bb/atr/sma/ema/stochastic/williamsr/cci/roc/mfi/cmf/kc/psar/ichimoku/obv/vwap/aroon/dema/tema）で得た値から、**正規化済みの「状態 + イベント」特徴**を出す。
- **生値そのものでなく、トレード的に意味のある正規化/イベント**を出すのが要点（生 RSI 値の差より「同じく売られすぎゾーンか」「直近でクロスしたか」が類似の本質）。

### 5.2 インジケーターレンズ出力の標準形（カタログ）

各インジケーターは以下の「特徴タイプ」の組合せで表現する（指標ごとに該当するものを出す）:

| 特徴タイプ | 例 | 値域 | 意味 |
|---|---|---|---|
| **zone（ゾーン）** | rsi_zone, stoch_zone | enum {oversold, neutral, overbought} or [-1,0,1] | 過熱度の区分 |
| **value_norm（正規化値）** | rsi_value(rsi/100), stoch_k | [0,1] | 連続値（必要時のみ） |
| **cross（クロス）** | macd_cross, ma_cross, stoch_cross | enum {bull, none, bear} | 直近のクロスイベント |
| **bars_since_event** | macd_bars_since_cross | int（比較時正規化） | イベントからの経過 |
| **position（位置）** | bb_position(close が band 内のどこ), ma_distance_norm | [0,1] / [-1,1] | 価格と指標の相対位置 |
| **slope（傾き）** | ma_slope, macd_hist_slope | [-1,1]（tanh 等で正規化） | 方向と勢い |
| **divergence** | rsi_divergence, macd_divergence | enum {bull, none, bear} | ダイバージェンス |

> 例: `ind:rsi`(period=14) → `{ rsi_zone, rsi_value, rsi_divergence }`。`ind:macd` → `{ macd_cross, macd_bars_since_cross, macd_hist_slope, macd_divergence }`。`ind:ma`(period=20,type=ema) → `{ ma_cross, ma_distance_norm, ma_slope }`。

### 5.3 IndicatorProfile との接続（現状の「宙ぶらりん」を解消）

- `IndicatorProfile.indicators: IndicatorConfig[]` が、**有効化するインジケーターレンズと params**を決める。
- ノート作成時: ノートに紐づく Profile の各 IndicatorConfig について analysis-engine で系列取得 → インジケーターレンズ出力を `LensSnapshot.lenses["ind:<id>@<paramHash>"]` に格納。
- マッチング時: **同じ Profile・同じ params**でライブ市場のインジケーターレンズを生成 → 比較。
- `lensId` に **params のハッシュ/識別子を含める**（例 `ind:rsi#p14`）ことで、異なるパラメータの同一指標を別レンズとして扱い、キー対応を保証する。

> これにより「トレーダーごとに違うインジケーター/パラメータ」が、**レンズ集合の違い**として表現され、次元不一致は原理的に発生しない（共通レンズだけで比較する、§6.1）。

### 5.4 コア指標レンズ（確定 2026-06-09、最初に実装する集合）

| lensId | パラメータ | 主な出力特徴 |
|---|---|---|
| `ind:rsi` | period(既定14) | rsi_zone / rsi_value / rsi_divergence |
| `ind:macd` | fast/slow/signal(既定12/26/9) | macd_cross / macd_bars_since_cross / macd_hist_slope / macd_divergence |
| `ind:ma` | **type(EMA/SMA) × period(短/中/長)** | ma_slope / ma_distance_norm（価格との相対）/ 複数 MA 間の ma_cross（短×中、中×長 等の GC/DC） |
| `ind:bb` | period(既定20) | bb_position（バンド内位置）/ bb_width_norm |

- **`ind:ma` は「長・中・短期線」を扱う**。type は **EMA / SMA 両対応**。lensId にパラメータ識別子を含めて区別（例 `ind:ma#ema20` / `ind:ma#sma200`）。複数 MA を有効化したときの**クロス（短期線が長期線を上抜け 等）**を特徴として出せる。
- 上記4種を**コアセット**として先行実装。他指標（stochastic / atr / ichimoku 等、analysis-engine が計算可能な ~20種）は同じ枠組みで**加算的に追加**（§2-④）。
- どの指標レンズを・どのパラメータで有効にするかは **`IndicatorProfile`（トレーダー設定）**が決める（§5.3）。

---

## 6. 類似度判定モデル

### 6.1 全体フロー

```
similarity(noteSnapshot, marketSnapshot):
  common = noteSnapshot.lenses ∩ marketSnapshot.lenses   # 共通 lensId のみ
  for lensId in common:
    s_lens   = lensSimilarity(lensId, note.features, market.features)   # §6.2
    w_lens   = weight(lensId, note) * min(note.conf, market.conf)        # §6.3
  score = Σ(s_lens * w_lens) / Σ(w_lens)     # 重み付き平均（0〜1）
  triggered = score >= threshold(note)
```

- **共通 lensId のみで比較**（片側にしか無いレンズはスキップ）。→ 欠損・プロファイル差に強い。
- 共通レンズが**実質ゼロ**（例: 重み有効レンズ無し）の場合は `score=0` ではなく「比較不能（null / skip）」として通知対象外にし、理由を記録する（観測性。`MatchingPipelineRun.skipReasons` に `no_comparable_lenses` 等）。

### 6.2 レンズ単位の類似度 `lensSimilarity`

レンズの各 featureKey の型に応じて部分類似度を出し、レンズ内で平均（またはレンズ定義の重み）:

| featureKey 型 | 類似度の出し方 |
|---|---|
| 数値 [0,1]/[-1,1] | `1 - |a-b| / range`（線形）。生値（pips/bars 等）は事前正規化 |
| **列挙（enum）** | **近さに応じた部分点（確定 2026-06-09）。完全一致のみにしない。** 順序のある enum（例: trend_phase early/middle/late、regime contracting/low/normal/elevated/expanding）は **`1 - 順序距離/最大距離`** で近い値に部分点。順序の無い enum はレンズ定義の類似表（無ければ 一致=1 / 不一致=0 にフォールバック）|
| 真偽（bool） | 一致=1、不一致=0 |
| イベント（cross/divergence） | 同方向=1、none同士=0.5、逆=0（レンズ定義） |

> **enum を部分点にする理由（決定4）**: 「完全一致のみ」は厳しすぎてマッチが出にくい。状態が"近い"なら部分的に似ていると評価する。各 enum はレンズ定義で「順序つき（順序距離で部分点）」か「カテゴリ（類似表 or 一致/不一致）」かを宣言する。
> 正規化規約（§2-③）: 生値キーはレンズが「比較用 normalize 関数」を持つ。これにより「保存は生値・比較は正規化」を両立し、後からしきい値を調整しても保存データは不変（移行不要）。

### 6.3 重み付け `weight`（確定 2026-06-09）

- **既定プリセット = 指標層重め**（Neko 決定）。状態層 / 指標層の 2 層に層重みを置き、既定は指標層を重くする。
- **ユーザー設定可・かつ分かりやすさ必須**: 生の数値だけでなく、**理解しやすいプリセット**（例: 「指標重視 / バランス / 状態重視」）を用意し、上級者は per-レンズ重みを微調整できる 2 段構成。「何を重視して通知しているか」がユーザーに伝わる UI にする。
- 設定は `IndicatorProfile`（or ノート設定）単位で保持。
- **confidence 連動**: 低 confidence のレンズは自動的に寄与が下がる（`w *= min(conf)`）。
- これは完成形の「**通知粒度のユーザー設定層**」の一部（completion-roadmap Phase β）。柱2 の条件アラートとも共通の設定層にする。

### 6.4 閾値・発火（確定 2026-06-09）

- **`threshold` = 類似度スコア(0〜1)のしきい値**。これ以上で「似ている → 通知候補」。**ユーザー設定可**（Neko 決定。ノート / プロファイル単位、既定はシステム値）。
- 加えて **一致レベル（strong / medium / weak）** をスコア帯で提示し、ユーザーが「どのレベル以上で通知するか」を選べる（= 通知粒度の一部）。
- `score >= threshold` で通知候補 → 既存の通知パイプライン（`NotificationTriggerService` / 冪等性・クールダウン・上限）に渡す。**通知の発火・抑制ロジック自体は本設計の対象外**（既存を流用）が、しきい値・レベル・重みの**ユーザー設定層**は本基盤が提供する。

---

## 7. ノートモデルの統一（UnifiedNote）

特徴基盤の上に乗るノートの共通形。**段階的に寄せる**（§9 移行）。

| 区分 | フィールド | 備考 |
|---|---|---|
| 同一性 | `source`(side-a-human / side-b-ai) / `symbol` / `side`(buy⇔long, sell⇔short に正規化) / `timeframe` / `higherTimeframe` / `entryPrice` / `eventTime` | 両サイド共通 |
| **特徴（核）** | `lensSnapshot`（§3） | featureVector を置換 |
| 運用 | `status`(draft/active/archived) / `enabled` / `pausedUntil` / `priority` | 「監視対象」概念に統一（Side-B の `usedForMatching` も同概念に寄せる） |
| 振り返り（サイド固有・任意） | Side-B: outcome/pnl/RR/分析JSON/learnings、Side-A: userNotes/aiSummary | 各サイド拡張 |
| 来歴 | `tradeId`(A) / `virtualTradeId`,`planId`(B) / 相互リンク | 既存 `AITradeNote.tradeNoteId` ブリッジを活用 |

> 「Side-B の本番昇格ノートを Side-A でも通知」= materialize 済みノートの `lensSnapshot` を**実値で**持たせ（現状 placeholder を解消）、`status` を監視対象に昇格するだけで成立。逆方向も対称。

---

## 8. データモデル / 保存（確定: B 採用）

`LensSnapshot` を**第一級の保存対象**にする。テーブル戦略は **B（共通コア + 拡張）に確定**（2026-06-09）。

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| A. ブリッジ強化 | 2テーブル維持。各ノートに `lensSnapshot`(JSONB) 列を追加し、両サイドが同形で持つ | 変更最小・低リスク | テーブル二重のまま |
| **B. 共通コア + 拡張（確定）** | `Note`(コア: 同一性+lensSnapshot+運用+来歴+userId) を新設し、Side-A/Side-B 固有は拡張テーブル or JSON。既存は段階移行 | 統一しつつ rich を分離。移行を段階化できる。マルチユーザー(userId)もコアに自然に載る | 中規模の schema 追加 |
| C. 単一テーブル統合 | 1テーブルに全部 | 理想形 | 大規模移行・高リスク（後戻り困難） |

> B のコア `Note` に **`userId`** を持たせ、マルチユーザー化(完成形確定事項)とノート統一を**同じ migration**で実現する。Side-A 固有(Trade 紐付け/userNotes/aiSummary)・Side-B 固有(outcome/分析JSON/lens 由来)は拡張で分離。

- `lensSnapshot` は **JSONB** で保存（スキーマ版・レンズ版を内包）。検索用に `symbol`/`timeframe`/`status` 等はカラム化。
- **不可逆性への配慮**: スキーマ版とレンズ版で前方互換を保つ。古い版の snapshot も `snapshotSchemaVersion` で解釈でき、再計算は eventTime + symbol + profile から再現可能（analysis-engine が決定的なら）。

---

## 9. 移行戦略（段階・可逆を最大化）

1. **基盤実装（非破壊・並行）**: LensSnapshot 型 + インジケーターレンズ + 類似度エンジンを新規追加。既存マッチングは temporarily 併存。
2. **二重生成 / シャドー評価**: 新基盤でも LensSnapshot を生成し、旧マッチングと**並行で**スコアを記録（`MatchingPipelineRun` 観測性で差分を観察）。通知はまだ旧 or 新どちらかに固定。
3. **切替**: 新基盤の妥当性を確認後、マッチング経路を LensSnapshot 類似度に切替。
4. **旧実装の廃止**: `calculate12DFeatures` / `extractFeatures*` / `featureVectorService` の重複・`UserIndicatorNoteEvaluator` の壊れた経路を削除。
5. **既存ノートのバックフィル**: eventTime + symbol + profile から LensSnapshot を再生成（analysis-engine 決定性を前提）。再生成不能な古いノートは `lensSnapshot=null` で監視対象外（明示）。

> 各段階は独立 PR。1〜2 は完全に可逆（追加のみ）。3 で初めて挙動変更。

---

## 10. 確定事項 / 要確認 / 対象外

### 本設計の確定事項（§2 原則 + 以下）
- ノート特徴 = バージョン付き `LensSnapshot`（マップ形式、キー対応）。作成時=照合時で同一生成。
- レンズ 2 系統（状態 = 既存8、インジケーター = 新設・IndicatorProfile 駆動・analysis-engine 計算）。
- 可変性はレンズ選択+重みで表現（次元増減しない）。欠損は除外/低重み（全体 0 にしない）。
- 共通 lensId のみで比較、confidence 連動の重み付き平均、閾値発火。

### 確定済み（2026-06-09 Neko 決定）
1. **テーブル戦略 = B（共通コア + 拡張）**。コア `Note` に `userId` を持たせマルチユーザー化と同時 migration（§8）。
2. **コア指標レンズ = rsi / macd / ma / bb**。`ind:ma` は**短/中/長期 × EMA/SMA 両対応**、複数 MA 間クロスも出す（§5.4）。他指標は加算的に追加。
3. **層重み = 指標層重めをプリセット、かつユーザー設定可**（プリセット「指標重視/バランス/状態重視」+ 上級者 per-レンズ微調整、分かりやすさ必須）。**しきい値 = 類似度スコアのしきい値で、ユーザー設定可**。一致レベル(strong/medium/weak)も提示（§6.3 / §6.4。= 通知粒度のユーザー設定層）。
4. **enum 類似度 = 近さに応じた部分点**（完全一致のみにしない。順序 enum は順序距離で部分点、カテゴリは類似表 or 一致/不一致）（§6.2）。

### 対象外（別ドキュメント）
- 個々のレンズ/指標の計算アルゴリズム（analysis-engine 実装）。
- 通知チャネル・抑制ロジック（既存 `NotificationTriggerService`、`golden-path.md`）。
- Side-B 専用の通知（不要方針）。
- UI/UX。

---

## 11. 実装状況(追補)

| 日付 | 内容 |
|---|---|
| 2026-06-10 | **基盤コア実装(移行戦略 §9-1、非破壊・並行)**: `src/shared/similarity/` に正準型・インジケーターレンズ・類似度エンジンを新設。配線(ノート生成・マッチング)は次段階。 |
| 2026-06-10 | **Note コア + 生成配線 + シャドー評価(§9-1〜§9-2)**: `Note` テーブル新設(戦略B) + Trade/TradeNote/MatchResult/Notification/Strategy へ userId 追加(マルチユーザー化 Phase α、nullable+バックフィル)。`LensSnapshotBuilder`(eventTime 起点の同一生成口) + CSV 取込配線 + マッチングパイプラインのシャドー評価 + バックフィルスクリプト。通知挙動は不変。 |
| 2026-06-11 | **マッチング切替(§9-3、Phase α-3 第1弾)**: `MATCHING_ENGINE=lens|legacy` フラグ導入(既定 lens、deploy.yml に明示)。lens 経路は `LensNoteCoreService.evaluateNotesForMatching`(シャドー評価とコア共用)の比較結果から score=レンズ類似度・threshold=レンズ閾値で MatchResult/EvaluationLog/通知を生成(旧ルール補正は不適用、トレンド/価格帯は観測情報のみ)。MarketSnapshot upsert は FK 充足のため継続。lens 稼働時はシャドー評価を自動スキップ(二重評価防止)。旧 12 次元経路は legacy ロールバック用に 1 リリース併存 → 安定確認後に削除予定(第2弾)。 |
| 2026-06-16 | **マッチング切替(§9-3、Phase α-3 第2弾)**: `MATCHING_ENGINE=legacy` ロールバック経路と `LENS_SHADOW_EVALUATION` シャドー評価レスポンスを廃止し、Side-A の本番マッチングを `LensNoteCoreService.evaluateNotesForMatching` に一本化。Cloud Run deploy の `MATCHING_ENGINE=lens` 明示も削除。ロールバックは旧環境変数ではなく deploy rollback で扱う。残るバックフィル実行は本番 DB 書き込みを伴うため別承認で実施する。 |
| 2026-06-13 | **レンズ条件タイプ 第1弾(§12、インジケーター系)**: `LensCondition`(type='lens') を条件ツリーの leaf 条件に追加。per-bar レンズ系列化 + 数値エンコード + 評価器分岐 + ConditionBuilder UI(`SingleLensCondition`)。backtest/live は `appendLensSeriesToCache` 共用で評価1経路を維持、MTF(`timeframeOverride`)・lookbackBars も既存機構で対応。詳細は下の追補3。 |
| 2026-06-13 | **レンズ条件タイプ フォローアップ(§12)**: orderedEnum の順序範囲演算子 + エントリープレビュー対応(`/api/chart/indicator-series` に lensIds、backend 計算の数値エンコード済み lensSeries をフロントで整列・評価)。詳細は追補4。 |
| 2026-06-13 | **状態系レンズ per-bar 化 第1段(§12.3、TS 計算可能 3 種)**: time_session / dow_theory / volatility_regime をレンズ条件タイプで使用可能に(analysis-engine 変更なし)。窓 150 本固定でスナップショットと同じ「見え方」を per-bar 化。詳細は追補5。 |
| 2026-06-13 | **状態系レンズ per-bar 化 第2段(§12.3/§12.6、engine 計算 3 種) = レンズ条件タイプ フルスコープ完了**: smc / chart_pattern / wyckoff を analysis-engine の per-bar 系列 API(`stateLensSeries`)で条件タイプ対応。これで全 8 状態レンズ + コア指標レンズが条件ツリーに合流。詳細は追補6。 |
| 2026-06-13 | **Phase δ-3/δ-4 実装(§13.3)**: 認証付き per-user 通知 SSE(`GET /api/notifications/stream`)+ フロント購読(`useNotificationStream`)。未読バッジと通知一覧がページ更新なしで自動更新。詳細は追補7。 |
| 2026-06-13 | **Phase δ-1 実装(§13.2)**: `realtimeSimilarityService` の簡易12次元+cosine を廃止し、正規マッチングパイプライン(レンズ類似度、cron と同一コード)のシンボルスコープ起動に統一。§13.2 の二重特徴表現を解消。詳細は追補8。 |

### 実装のローカル詳細(2026-06-10、正本への追補)

- **実装配置**: `src/shared/similarity/`(横断共有層。side-b への依存なし、状態レンズの出力キーはカタログとしてデータ定義)
  - `lensSnapshotTypes.ts` — `NoteLensSnapshot` 正準型 + Zod 検証(`parseNoteLensSnapshot` は破損/旧形式で null = 比較対象外に倒す)
  - `indicatorLenses.ts` — コア 4 種 + `ind:ma_cross`(複数 MA の期間昇順・隣接ペアから自動生成)
  - `lensComparators.ts` — レンズ別比較カタログ(状態 8 種 + 指標 5 種)
  - `similarityEngine.ts` — `compareLensSnapshots`(レンズ単位類似度 → 2 段集計 → 閾値発火)
- **lensId 形式**: `ind:rsi#p14` / `ind:macd#f12s26g9` / `ind:ma#ema20` / `ind:ma_cross#ema20xsma75` / `ind:bb#p20`(`#` 以降がパラメータ識別子。比較定義は `#` より前で解決)
- **層重みの集計は 2 段**(§6.3 の実装詳細): 層内で confidence 連動の加重平均 → 層間でプリセット加重平均。レンズ数の多寡(状態 8 vs 指標数本)で層バランスが崩れないようにするため。片層しか無い場合は存在する層で再正規化。
- **プリセット値**: 指標重視 0.65/0.35(既定)、バランス 0.5/0.5、状態重視 0.35/0.65。
- **既定しきい値**: 発火 0.75、レベル帯 strong 0.9 / medium 0.8 / weak 0.7(既存 `noteEvaluator` 定数を踏襲)。
- **イベント比較の none×方向 = 0.25**(§6.2 表の「レンズ定義」部分を一律値で確定)。
- **カタログ未定義キーのフォールバック**: boolean のみ一致/不一致で比較、数値・文字列は比較対象外(新キーを効かせる場合はカタログ追記 = 加算的拡張)。
- **比較対象外(skip)を明示したキー**: 絶対価格(`last_high_price` 等)、絶対ボラ値(`bb_width`/`atr` 生値)、メタ確度(`confidence_pct`/`wyckoff_phase_confidence`/`pattern_confidence`)、細粒度時刻(`utc_minute`/`day_of_month`)。

### 実装のローカル詳細・追補2(2026-06-10、§9-1〜§9-2 配線)

- **Note コアテーブル(§8 戦略B)の段階移行上の役割分担**: 本段階の `Note` は「同一性 + lensSnapshot + 来歴 + userId」のみを持つ。**運用フィールド(status/enabled/pausedUntil/priority)の正は引き続き `TradeNote`**(運用統一は Phase ε のノート統一仕上げで扱う)。userId は nullable + migration で最古ユーザーへバックフィル(必須化・FK 付与はクエリ分離完了後の Phase α-4 で検討)。
- **生成の唯一の入口 = `LensSnapshotBuilder`**(`src/services/lensSnapshotBuilder.ts`): ノート作成時(eventTime=トレード時刻)も照合時(eventTime=now)も同じ build() を通る(§2-① の構造的保証)。旧実装は「ノート生成時に現在の市場データ」で特徴を計算しており「その瞬間の市場」を捉えていなかった(根本欠陥)→ eventTime 起点の取得で解消。
- **カバレッジ/鮮度の自己回復**: バー不足(<100本) または鮮度切れ(最終バーが eventTime から max(3 バー, 30 分) 超離れ)のとき、`fetchAndCacheOhlcv` で期間指定フェッチを 1 回だけ試行。cron 照合では毎サイクル直近ギャップ分のみ取得され、OHLCVCandle が自己維持される。
- **市場側の指標レンズ仕様はノート側 lensId から逆解決**(`parseIndicatorLensId`): IndicatorProfile の現在状態に依存せず「同じ params」の比較が成立(プロファイル削除・変更に頑健)。
- **シャドー評価(§9-2)**: 2026-06-16 の Phase α-3 第2弾で廃止。旧 12 次元経路との並行観測は完了し、`runMatchingPipeline` はレンズ本経路のみを実行する。
- **`current_analysis` レンズは Side-A 生成経路では対象外**(MarketAnalysis = Research AI 出力が必須のため)。Side-B 側スナップショットとの比較では共通レンズに含まれない=自動スキップ。
- **バックフィル**: `scripts/migrate/backfill-lens-snapshots.ts`(§9-5)。ノート保存時の `TradeNote.indicatorConfig` スナップショットから設定を復元し、トレード時刻起点で再生成。
- **同一スナップショット同士でもスコアは必ずしも 1.0 にならない**: イベント系 featureKey の none 同士は 0.5(§6.2 表)のため。「どちらも何も起きていない」は「同じ強いシグナル」より弱い類似として扱う(仕様)。

### 実装のローカル詳細・追補3(2026-06-13、§12 レンズ条件タイプ 第1弾)

- **per-bar 系列化**: `computeIndicatorLensFeatureSeries`(indicatorLenses.ts)。バー i を末尾とする**有界窓 `LENS_SERIES_CONTEXT_BARS`=40 本**で `computeIndicatorLens` を適用(内部ヘルパの遡り幅 divergence30/cross23/confidence30 を全て覆うため、全 prefix 計算と同一結果 = **先読みなし**を構造的に保証)。計算不能バーは null。
- **数値エンコード**: `encodeLensFeatureValueAsNumber`(lensComparators.ts)。bool=1/0、orderedEnum=順序 index、event は bull=1/none=0/bear=-1、数値系はそのまま。**系列側と条件右辺が同一関数を通る**ことでエンコードのドリフトを防ぐ。categoricalEnum/cyclic は第1弾対象外(null = 不成立)。
- **キャッシュ準備**: `appendLensSeriesToCache`(strategyBacktestService.ts、backtest/live 共用)。by-version API(Python 側抽出)はレンズ条件を知らないため、`parseIndicatorLensId` で必要系列を逆解決し**明示指定 `/v1/indicator-series` を 1 回**追加で呼ぶ(レンズ条件が無ければ呼ばない)。系列長とバー列の不一致は中断(誤時点判定の事故防止)。MTF はビュー側キャッシュに override 足の系列を積む。
- **評価**: `evaluateLensCondition`(strategyConditionEvaluator.ts)。欠損(NaN)・sentinel(`bars_since`=-1)・エンコード不能は**すべて不成立に倒す**(§12.4-4)。演算子は enum/event/bool=`=`/`!=`、数値=`<`/`<=`/`>=`/`>`(UI 側 `lensOperatorsForValueKind` で制限)。
- **UI**: `SingleLensCondition`(ConditionBuilder.tsx)。レンズ種別→パラメータ→featureKey→演算子→値。フロントは src/shared を import しない構成のため、featureKey カタログと lensId 組立(`buildLensId`/`parseLensIdForEdit`)を types/strategy.ts に**二重化**(時間条件と同じ方針、ドリフト注意)。
- **エントリープレビューは第1弾では未対応**: プレビューのフロント評価器はレンズ系列を計算できないため**不成立扱い**(楽観表示しない)+ UI に明記。→ **同日フォローアップで対応済(追補4)**
- **第2弾(残)**: 状態系レンズの per-bar 化(analysis-engine の smc/chartPatterns/wyckoff payload 配列化、§12.6)。orderedEnum 順序範囲演算子・プレビュー対応はフォローアップ(追補4)で実装済。

### 実装のローカル詳細・追補4(2026-06-13、§12 フォローアップ: 順序範囲演算子 + プレビュー対応)

- **順序範囲演算子**: orderedEnum の featureKey(例 rsi_zone)に `<`/`<=`/`>=`/`>` を許可(UI 側 `lensOperatorsForValueKind`)。数値エンコードが順序 index のため**評価器は無変更**で成立。event/bool は等価のみ維持(bull=1/none=0/bear=-1 の大小に意味を持たせない)。
- **プレビュー対応**: レンズ特徴系列は**backend で計算して返す**(計算一元化 §2-⑦、フロントにレンズ計算を二重実装しない)。`POST /api/chart/indicator-series` に `lensIds` を追加し、`appendLensSeriesToCache`(backtest/live と同一経路 = 評価1経路)で数値エンコード済み系列を `lensSeries` フィールドとして additive に返す。closes は OHLCVCandle から response.timestamps へ秒精度整列。
- フロント側: `extractConditionRequirements` が lensId を収集 → `alignSeriesToCandles` が `lens:` キーを**そのまま**整列(lensId は `_`/`#` を含むため canonicalize しない) → `evalLensCondition`(backend `evaluateLensCondition` のミラー。sentinel/欠損/エンコード不能は不成立)。backend 失敗時は lensSeries なし = レンズ条件不成立で描画(安全側)。
- **フロント二重化(ドリフト注意)**: 値エンコード `encodeLensConditionValue`(enum は LENS_FEATURE_INFO の options 順 = backend orderedEnum の order と同期必須)、キー規約 `makeLensConditionCacheKey`、sentinel は LENS_FEATURE_INFO に宣言。

### 実装のローカル詳細・追補5(2026-06-13、§12.3 状態系レンズ per-bar 化 第1段)

- **対象**: TS 側だけで計算可能な 3 種(`time_session` / `dow_theory` / `volatility_regime`)。analysis-engine 変更なし。`pattern`(ローソク足12種)は既存 PatternCondition と同機能のため条件 UI 対象外。
- **新設 `src/services/stateLensSeries.ts`**(恒久。lensSnapshotBuilder = 1 時点 snapshot / 本モジュール = per-bar 系列という責務分離): `computeStateLensFeatureSeries` + `appendStateLensSeriesToCache`。後者を backtest / live / プレビューの 3 経路が共用(インジ系 `appendLensSeriesToCache` と対、評価1経路)。
- **窓 = `STATE_LENS_CONTEXT_BARS` = 150 本固定**(lensSnapshotBuilder の DEFAULT_WINDOW_BARS と同期。ドリフト注意)。per-bar 値は「その瞬間にスナップショットを作ったら見えたはずの状態」と一致し、**柱1(ノート類似)と柱2(条件)が同じ状態定義を共有**する。lookahead 禁止は窓がバー i で終わることで構造的に保証(ピボットの rightBars 本確定遅延も窓内で自然に表現される)。
- **categoricalEnum の条件対応**: comparator 定義に `values`(正準値リスト)を追加し、その index で数値エンコード(`encodeLensFeatureValueAsNumber`)。**`values` を宣言したカテゴリ enum だけが条件で使える**(現状 `trend_state` のみ。加算的拡張)。フロントは valueKind `category`(等価演算子のみ。options 順 = values 順、ドリフト注意)。
- **state lensId 形式**: 種別名そのまま(例 `dow_theory`、`#` パラメータなし)。`appendLensSeriesToCache` は `ind:` 以外を無視し、状態系は `appendStateLensSeriesToCache` の担当(担当分離)。
- **プレビュー経路**: 欠損足(EODHD 由来 OHLC=null ギャップ)を除外した有効バー軸で計算し、response.timestamps 軸へ秒精度で整列(`chart/candles 欠損足の消費規約`と同方針)。
- **残(第2段)**: smc / chart_pattern / wyckoff — analysis-engine の payload 配列化(§12.6 確定方針)が前提。→ **同日 第2段で対応済(追補6)**

### 実装のローカル詳細・追補6(2026-06-13、§12.3 状態系レンズ per-bar 化 第2段 = フルスコープ完了)

- **analysis-engine 拡張(§12.6 確定方針どおり既存 `/v1/indicator-series` の拡張)**: リクエスト `stateLensSeries: ['smc'|'chart_pattern'|'wyckoff']` で、指定レンズの payload を**バー i を末尾とする窓 150 本**(`STATE_LENS_WINDOW_BARS`、Node 側と同期)で全バー計算し、`smcSeries` / `chartPatternsSeries` / `wyckoffSeries`(timestamps と 1:1)として additive に返す。wyckoff は同じ窓の SMC payload を文脈として内部計算(精度向上、Phase 7c と同方針)。
- **lookahead 禁止**: 窓がバー i で終わる + `_detect_pivots` が末尾 right_bars 本を候補から除外するため、未来参照は構造的に不可能。Python 側にも lookahead 不変テスト(`tests/test_state_lens_series.py`。CI 未配線のため手動/コンテナ実行)。
- **TS 側**: `appendStateLensSeriesToCache` に `engineSeries`(取得設定)を追加。payload→features 変換は各レンズの `smcPayloadToFeatures` 等を export して再利用(変換の単一情報源)。**旧バージョン engine(配列なし)は警告スキップ = 条件不成立**(graceful degrade、エンジンと Node のデプロイ順序に依存しない)。系列長とバー列の不一致は中断。
- **categoricalEnum の values 宣言を追加**: `last_structure_event` / `wyckoff_phase` / `pattern_detected` / `pattern_direction_bias`(analysis-engine の Literal と同期、ドリフト注意)。フロント UI カタログ(SMC ゾーン/構造イベント/OB 距離/流動性/FVG、チャートパターン 12 種、ワイコフフェーズ 7 種/Spring/SOS 等)も同並びで追加。
- **コスト**: per-bar 計算は O(n × 窓150)。要求されたレンズのみ計算(未要求はゼロコスト)。**実測: 3 レンズ同時 × 2,000 本 ≈ 12s**(Python 3.12)。長期間バックテスト対策として `stateLensSeries` 要求時は Node 側タイムアウトを 180s に引き上げ(screening BT と同水準)。それでも不足する場合の最適化(ピボットを全系列 1 回計算 → causal 参照化で定数倍削減)は運用観察後の後続とする。

### 実装のローカル詳細・追補7(2026-06-13、§13.3 Phase δ-3/δ-4 通知 SSE)

- **`GET /api/notifications/stream`**(認証付き per-user SSE、δ-3 の 2026-06-13 決定どおり新設): `requireAuth` 配下で `req.user.userId` フィルタ。URL にユーザー ID を含めない(パス不一致チェック自体を不要化)。イベント: `notification`(新着 1 件ごと)/ `unread_count`(接続時 + 新着時)/ `heartbeat`(30 秒)。
- **配信 = サーバ側 DB ポーリング(10 秒)**: Cloud Run max-instances=5 では in-process EventEmitter は「cron を受けたインスタンス ≠ SSE 接続中のインスタンス」で届かないため、**DB をインスタンス間のバスにする**。Postgres LISTEN/NOTIFY は本番接続が Supavisor transaction pooler 経由のため不可、Supabase Realtime は RLS 未整備(認証は cTrader JWT)で per-user 分離を保証できず不採用。通知の主生成源が 15 分 cron のため 10 秒遅延は十分(δ-5 の決定と整合)。
- **フロント `useNotificationStream`**: 接続はモジュール内 1 本を共有(Header バッジと通知一覧が同時購読しても EventSource は 1 つ)。StrictMode 二重マウント対策は readyState ガード(PR #357 の教訓)。SSE 断時は 30 秒間隔の REST フォールバック + 自動再接続。新着イベントでは一覧を**再取得**する(SSE ペイロードを正としない。一覧の形は REST が正)。
- Header の未読バッジ 30 秒ポーリングは SSE 購読に置換(初期値と断絶時のみ REST)。
- **残**: δ-1(下の追補8 で実装済)。δ-2 は cron 経路で適用済(ノート=β-2、ストラテジー=#397)のため実質完了。

### 実装のローカル詳細・追補8(2026-06-13、§13.2 Phase δ-1 リアルタイムのレンズ統一)

- **`realtimeSimilarityService` を「薄いトリガー」に書き換え**: 簡易 12 次元ベクトル + cosine(`calculateFeatureVector` / `checkSimilarity` 等)を**全廃**し、バー確定ごとに `MatchingService.runMatchingPipeline({ trigger: 'realtime', symbolFilter })` を起動するだけにした。これにより:
  - 特徴量がレンズ基盤(LensSnapshot + compareLensSnapshots)に**完全統一**(§13.2 の二重特徴表現を解消)。リアルタイムと 15 分 cron が同一コードで評価するため結果が食い違わない。
  - MatchResult / EvaluationLog / Notification 永続化、通知粒度(NotificationPreference)、Web Push、通知 SSE(δ-3)まで全て正規経路に乗る(= 設計 δ-1 の「callback → `evaluateWithPersistence`」を、新メソッド `evaluateWithPersistence(symbol)` として実体化)。
- **`runMatchingPipeline` に `symbolFilter` を追加**(`checkForAllMatches` → `checkForMatches` はノートロード後に symbol フィルタ、`checkForSideBMatches` は symbol ループでフィルタ)。リアルタイムは「確定したシンボルのノートだけ」評価し、毎バー全シンボル評価を避ける。`PipelineRunTrigger` に `'realtime'` を追加(observability)。
- **多重起動・クールダウン制御**: 同一シンボルの評価が走行中(in-flight)なら多重起動しない + `minEvaluationIntervalSeconds`(既定 60s)のクールダウン(1m 足でバー確定が密でもパイプライン連打を防ぐ)。
- **`scripts/run-realtime-worker.ts` を新 API に追従**(ノート管理・通知コールバックを撤去し、cTrader → RollingWindow → service.start() の薄い殻に)。**未本番化のまま**(deploy.yml に worker サービスなし。δ-5 = 15 分 cron 維持の決定により当面見送り)。δ-5 本番化時の必須作業はデータ源を cTrader → EODHD WS へ差し替え(§13.4 注意書き、worker のコメントにも明記)。

---

## 12. レンズ条件タイプ（柱2 への合流）〔設計確定 2026-06-12〕

> **位置づけ**: 完成形ロードマップ §5「2本の柱の合流」の技術的核。柱1(ノート類似)で作ったレンズを、柱2(条件ツリー)の**条件タイプ**としても使えるようにする。「過去の勝ちトレードに似たら通知」と「自分のルール条件が成立したら通知」を**同一のレンズ言語・同一の評価器**で扱う。

### 12.1 現状の土台（調査 2026-06-12）
- **条件ツリーは拡張可能**: 条件タイプは `type`/`indicatorId` で判別(`src/frontend/types/strategy.ts`)。評価器 `evaluateConditionGroup` → `evaluateBaseNode`(`src/backend/services/strategyConditionEvaluator.ts`)に分岐を1つ足すだけ。backtest/live は**評価1経路**共用、MTF(`timeframeOverride`)も leaf 条件なら自動対応。
- **レンズは単一時点で真偽判定可能な粒度**: `LensSnapshotEntry.features` は `Record<string, LensFeatureValue>`(`LensFeatureValue = number | string | boolean`) で `rsi_zone=oversold` / `ma_cross=bull` のようにキー参照で評価できる(§3.1)。

### 12.2 核心の設計判断: レンズの per-bar 系列化
評価器は**バー系列を per-bar 評価**する(`indicatorCache: Map<string, number[]>`)。一方レンズ生成(`lensSnapshotBuilder`)は**1 時点の snapshot** を作る重い処理(analysis-engine 呼び出し)。バックテスト数千バーで毎バー snapshot 生成は非現実的。

→ **レンズ特徴を「1 バー1 値」の系列に変換し、評価器のキャッシュに載せる**のが核(指標系列と同じ扱い)。これにより:
- backtest/live で同じ評価器がレンズ条件を per-bar 評価できる(評価1経路の維持)
- MTF も既存の `timeframeOverride` 機構で自動対応(leaf 条件のため)
- **#3 とリアルタイム類似度(§13)が同じ「レンズ系列化」資産を共有**する(後戻り最小)

> **不変条件: 先読み(lookahead)禁止〔2026-06-13 設計レビューで追加〕**: per-bar 系列のバー i の値は **bars[0..i] のみから計算**する(確定バー原則、MTF #391 と同方針)。状態レンズはピボット確認・構造イベント・フェーズ判定など「後のバーで確定する」性質を持つため、全系列を見てから per-bar 値を埋めると **backtest だけ live より良く見える先読みバグ**になる。TS 側の per-bar 化も analysis-engine の per-bar 系列 API も、この規約を必須とする。

### 12.3 スコープ決定（2026-06-12 Neko）: 状態系レンズも含むフルスコープ
- **インジケーター系レンズ**(rsi_zone / ma_cross / macd / bb_position 等): 既存の指標系列から**安価に per-bar 計算可能**(`computeIndicatorLens` は系列入力の純関数を per-index 適用)。analysis-engine 変更不要。
- **状態系レンズ**(SMC / Wyckoff / ChartPattern / DowTheory / VolatilityRegime / TimeSession / Pattern): analysis-engine が現状**単一時点 payload** を返すため、**per-bar 系列を返す API 拡張が必要**(Python 側 + TS 側)。〔2026-06-13 精査〕API 拡張が必須なのは **smc / chart_pattern / wyckoff の 3 種のみ**。`time_session`(時刻のみで決定) / `dow_theory`(OHLCV ピボット) / `volatility_regime`(BB幅 percentile) は **TS 側だけで per-bar 化可能**、`pattern` は既に bool[] 系列で取得済み。
- 実装は「インジケーター系を先行 → 状態系を追加」と段階化してよいが、**到達目標は全レンズ**。

### 12.4 設計要素
1. **`LensCondition` 型**(`strategy.ts`): `type: 'lens'` + `lensId`(例 `ind:rsi#p14`, `smc`) + `featureKey`(例 `rsi_zone`) + `operator`/`value`(featureKey の比較種別=`lensComparators` の kind に応じて allowed operator を制限) + `lookbackBars?` + `timeframeOverride?`。型ガード `isLensCondition`。
2. **レンズ系列の供給**: `buildEvaluationCaches` を拡張し、`lens:<lensId>:<featureKey>` を per-bar 系列(数値/列挙の数値化)としてキャッシュ。
   - インジケーター系: 既存 `indicatorCache` の指標系列から per-index 算出。
   - 状態系: analysis-engine 新 API(`/v1/lens-series` 等。`indicator-series` の lens 版)から per-bar 系列取得。
3. **評価器分岐**: `evaluateBaseNode` に `if (type === 'lens') return evaluateLensCondition(ctx, item)`。`collectTimeframeOverrides`/`resolveViewContext` は lens も自動カバー。
4. **sentinel/欠損**: `bars_since_event=-1`(イベントなし)等は比較前に skip 判定(§6.2 normalizedLinear と同方針)。confidence 低/欠損バーは条件不成立側に倒す。
5. **ConditionBuilder UI**: `SingleLensCondition` 新設(lensId セレクタ → featureKey セレクタ → operator/value)。プレビューの必要系列登録は既存の `extractConditionRequirements`(`src/frontend/lib/previewIndicatorSeries.ts`)に lensId 収集を追加して行う(〔2026-06-13 再訂正〕同名関数はフロント lib に実在した。初回レビューの「存在しない」は調査誤り)。
6. **operator 制約**: featureKey の kind 別に許可演算子を限定(bool/event=`==/!=`、orderedEnum=`==/!=`(順序範囲は後続)、linear=`</<=/>/>=`)。〔2026-06-13 精査〕条件ツリーは API 入口で深い zod 検証をしていない(envelope の `objectJsonField` のみ)ため、制約の強制は **UI + 評価器の防御**で行う(既存条件タイプと同じ流儀)。

### 12.5 触る箇所
型(`strategy.ts` + 評価器側) / 評価器(`evaluateLensCondition` + `buildEvaluationCaches` 拡張) / analysis-engine(状態系の per-bar 系列 API) / UI(`ConditionBuilder`) / プレビュー(`previewIndicatorSeries`) / テスト。**backtest/live サービスは評価器共用のため原則無変更**。

### 12.6 残決定 → 確定(2026-06-13 設計レビュー)
- analysis-engine の per-bar 系列 API の形 = **新エンドポイントではなく既存 `/v1/indicator-series` の状態系 payload(smc/chartPatterns/wyckoff)を配列化**(第2弾・状態系レンズ着手時に実施)。warmup/コストは実装時に計測して追補。
- 列挙 featureKey の条件 UX = **第1弾は等価(`==`/`!=`)のみ**。順序範囲は後続で加算的に追加。
- レンズ系列のキャッシュ cacheKey 規約 = **`lens:<lensId>:<featureKey>`**(例 `lens:ind:rsi#p14:rsi_zone`)。

---

## 13. リアルタイム類似度のレンズ統一 + 常駐ワーカー（Phase δ）〔設計 2026-06-12〕

### 13.1 現状（調査 2026-06-12）
- **リアルタイム類似度は callback 止まり**(`src/services/realtime/realtimeSimilarityService.ts`)。かつ**独自の簡易 12 次元ベクトル**を使用しており、**レンズ基盤と別経路**(=柱1で潰したはずの「二重特徴表現」がリアルタイムに残存)。
- **起動は 15 分 cron のみ**(`matching-pipeline-15min` / `strategy-alerts-15min`)。常駐ワーカー(`scripts/run-realtime-worker.ts`)は**未本番化**。
- **通知 UI はポーリング/手動更新**。SSE インフラ(`/api/realtime/stream/:symbol`)はチャートのバー配信に存在 → **通知イベント配信に流用可能**。
- リアルタイム供給は **EODHD WebSocket**(Phase A 切替済)。cTrader 複数接続競合バグ(memory: project_ctrader_multi_connection_bug / `src/infrastructure/market/CTraderProvider.ts`)を避けるため、リアルタイム市場データは EODHD・cTrader OAuth は認証/ポジション操作に限定。

### 13.2 設計原則: リアルタイムもレンズエンジンに統一
§2 原則(作成時=照合時=リアルタイムで同一の特徴生成)に従い、**簡易 12 次元を廃し `lensSnapshotBuilder`/レンズ系列(§12.2)に統一**する。これにより柱1のノート照合とリアルタイム照合が同一の類似度エンジンを通る。

### 13.3 配線計画（δ-1〜δ-5）
| 手順 | 内容 | 規模 | 状態 |
|---|---|---|---|
| δ-1 | リアルタイムをレンズエンジンに統一 + callback→`evaluateWithPersistence`(DB永続化) | M | ✅ 実装済(追補8) |
| δ-2 | 通知粒度(`NotificationPreference`)をリアルタイムにも適用 | M | ✅ 実質完了(δ-1 が正規パイプライン共用 = 通知粒度も自動適用) |
| δ-3 | **認証付き per-user 通知 SSE(`/api/notifications/stream` 等)を新設**して Notification イベント emit〔2026-06-13 Neko 決定〕。既存チャート SSE(`/api/realtime/stream/:symbol`)は**認証なし・symbol 単位のため流用しない**(他ユーザー通知の漏洩防止) | S〜M | ✅ 実装済(追補7) |
| δ-4 | フロント通知フィードの SSE 購読(自動更新) | S | ✅ 実装済(追補7) |
| δ-5 | 常駐ワーカー本番化 | L | ⏸ 見送り(15分 cron 維持、2026-06-13 Neko 決定) |

### 13.4 常駐ワーカー本番化の選択肢〔要決定〕
| 選択肢 | メリット | デメリット | コスト |
|---|---|---|---|
| **別 Cloud Run サービス(推奨)** | リソース独立・接続専有・スケール制御可 | インスタンス増・サービス間認証 | +¥数千/月 |
| Cloud Run sidecar | 認証不要・低遅延 | main とリソース共有(pool 枯渇リスク) | 既存内 |
| Railway 常駐 | 安価 | 別インフラ管理コスト | ¥数百/月 |
| 15 分 cron 維持 | 現状延長 | リアルタイム性を捨てる | 無料枠 |

> **決定(2026-06-13 Neko)**: **15 分 cron 維持**を採用し、δ-5(常駐ワーカー本番化)は当面見送る。理由: 15 分 cron は 15m 足の確定タイミング(毎時 :00/:15/:30/:45)と揃っており、**15m 以上の時間足のノートは実質バー単位で評価される**(リアルタイム化が効くのは 5m 以下のノートのみ)。リアルタイム性が最優先なのはチャート表示であり、類似度判定のリアルタイム化は最後に改めて判断する。
> 将来 δ-5 を本番化する場合の注意〔2026-06-13 設計レビュー〕: 現行 `scripts/run-realtime-worker.ts` は **CTraderProvider で Tick を取得しており、既知の cTrader 複数接続競合バグの経路**(memory: project_ctrader_multi_connection_bug)。本番化時はデータ源を EODHD WS(`eodhdRealtimeOrchestrator`)へ差し替えること(§13.1 の方針どおり)。また δ-1 の `evaluateWithPersistence` は既存関数ではなく**新設**である。

### 13.5 完成判定
承認ノート × ライブ市場がリアルタイム(数秒以内)でレンズ類似度評価 → マッチ時に通知粒度を適用して Notification 生成 → SSE で UI 通知フィードに自動反映 + per-user Web Push。
〔2026-06-13 注記〕δ-5 見送り中の到達点は「足確定単位(15 分 cron)の評価 + per-user SSE による通知フィード自動反映」。「数秒以内」の判定は δ-5 再判断時に復活させる。

---

## 付録: 現状資産の再利用マップ

| 本設計の要素 | 再利用する現状資産 | 新規 |
|---|---|---|
| 状態レンズ | `src/side-b/lenses/` 8レンズ + `serializeLensSnapshot` | — |
| インジケーター計算 | analysis-engine `/v1/indicator-series`(~20指標) + `generationIndicatorCache` | インジケーターレンズ層（値→正規化特徴/イベント変換） |
| トレーダー可変 | `IndicatorProfile` / `IndicatorConfig`(23種 registry) | Profile → 有効インジケーターレンズへの解決 |
| 類似度 | （cosine は廃止）`getSimilarityLevel`/閾値定数は流用可 | レンズ単位類似度 + 重み付き集計エンジン |
| 通知 | `NotificationTriggerService` / `InAppNotificationSender` / 観測性 `MatchingPipelineRun` | — |
| ブリッジ | `AITradeNote.tradeNoteId` / `MaterializationService` | materialize に実 lensSnapshot を渡す（placeholder 解消） |
