# Critical-10 (仮説品質改善) 調査レポート

**調査日時**: 2026-05-02 11:00 JST  
**目的**: 24h 観測レポート (PR #74) の主要発見「PF 中央値 1.13 / 勝率中央値 26.2% で screening_passed=0 件」の根本原因と、改善の 3 軸を整理する。Nekoさん の設計判断のたたき台。  
**実装着手前提**: 本レポートは調査のみ、コード変更なし。

---

## 0. 観測データから見える矛盾

24h レポート (PR #74) の表 4「直近 24h で screening に到達した仮説」9 件を再整理:

| ID | PF | 勝率 | RR 関係 | 性質 |
|---|---|---|---|---|
| 87f602f3 | **1.196** (最大) | 21.0% (低) | 高 RR・低勝率型 | 順張り? |
| 1f611409 | 1.180 | 45.0% | 中 RR・高勝率 | 逆張り? |
| c02513ae | 1.179 | 26.2% (中央値) | 中 RR・中勝率 | — |
| 5b96accb | 1.159 | 30.0% | — | — |
| 3146108d | 1.130 | **47.6%** (最大) | 低 RR・高勝率型 | 逆張り? |
| 73d6ac3d | 1.082 | 21.4% | — | 不調 |
| bc47b40f | 1.021 | 39.5% | — | 不調 |
| fb475c47 | 0.901 | 23.2% | — | 損失 |
| 6a0dd64b | **0.873** (最小) | 20.3% (最小) | — | 損失 |

### 数値が示唆すること

- **HG が想定している RR 比 2.0(プロンプト推奨)が達成されていない疑い**:
  - RR 比 2.0 で損益分岐勝率は **33.3%**
  - 実際の勝率中央値 26.2% で PF 1.13 が出ている → 「平均勝ち / 平均負け」が **約 3.18** に達している(2.0 想定より高い)
  - **理屈**: HG は RR=2.0 を狙ってるけど、実際の TP/SL ヒット時の利幅は 3.18 倍 → トレンドが強い時に TP まで伸び、伸びすぎて勝率が低くなる典型パターン
- **勝率の最大値 47.6% で PF が 1.13 止まり**:
  - 勝率高めの仮説は RR が低い(逆張り型)
  - RR=1.13 程度しか取れていない → SL/TP の設計が逆張りに合っていない可能性

→ **HG の `defaultRiskManagement` 推奨値 (SL ATR 1.0-2.5, RR 2.0-3.0) と実市場のミスマッチ**が大きい仮説。

---

## 1. 軸 1: HG プロンプト現状把握

### 1.1 ファイル

`src/side-b/prompts/hypothesis_generator.md` (139 行、6.9KB)、最終更新 2026-04-25

### 1.2 リスク管理推奨値(プロンプト記載)

```markdown
- **stopLoss**:
  - 短期(数バー保有)→ atr_multiple の値 1.0〜1.5
  - 中期(10〜50バー)→ atr_multiple の値 1.5〜2.5
- **takeProfit**:
  - 順張り系 → rr_ratio の値 2.0〜3.0
  - 逆張り系 → rr_ratio の値 1.2〜2.0
- **maxHoldingBars**:
  - 偏りの持続期間を超えない範囲(例: 4時間足なら 24〜72)
```

### 1.3 デフォルト値(プロンプト未指定時の fallback)

`src/side-b/models/edgeHypothesis.ts:163`:
```ts
export const DEFAULT_RISK_MANAGEMENT: DefaultRiskManagement = {
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    maxHoldingBars: 48,
};
```

### 1.4 PromptVersion 統計の退行(24h レポートより)

| agentName | 旧 avgScore | 現 avgScore | 差分 |
|-----------|-----------|-----------|------|
| hypothesis_generator | 0.609 | 0.574 | **-0.035** ⚠️ |
| trend_specialist | 0.521 | 0.496 | **-0.025** ⚠️ |
| oscillator_specialist | 0.679 | 0.622 | **-0.057** ⚠️ |
| volatility_volume_specialist | 0.721 | 0.663 | **-0.058** ⚠️ |

→ **phase-6.7c-20260425T115258Z-sync 移行後、全エージェントで avgScore 退行**。
プロンプト変更内容と関連付けて調査する必要あり。

### 1.5 強み(現プロンプト)

- 専門家分析の統合手順(ステップ0)が明示
- Discovery hints の使い方が明示(ステップ Discovery)
- 物理量カテゴリ分類(位置/勢い/状態/時間/関係)で組み合わせを促進
- 出力形式の JSON スキーマが明確
- 禁止事項(単一レンズ依存、未来データ依存)が明示

### 1.6 弱み(疑い)

- **「BT で勝てる可能性」を重視と書かれているが、具体的な勝率 / PF の数値ガイダンスがない**
- リスク管理の値選択指針が「短期/中期」「順張り/逆張り」の 2 軸だけで粗い
- 観測の RR 達成率(実 RR=3.18 vs 想定 2.0)を考えると、**TP=rr_ratio 2.0 は保守的すぎ**かもしれない

---

## 2. 軸 2: SL ATR 倍率の検証

### 2.1 計算式(`MaterializationService.ts:194-237`)

```ts
// stopLossPercent = (ATR × multiple) / entryPrice × 100
// takeProfitPercent (rr_ratio) = stopLossPercent × value
```

### 2.2 数値例(XAU/USD 15m を仮定、ATR=20pips, entry=3300)

| 設定 | 計算 | SL% | TP% (RR=2.0) |
|---|---|---|---|
| atr_multiple = 1.0 | 20*1.0/3300*100 | 0.61% | 1.21% |
| atr_multiple = 1.5 (DEFAULT) | 20*1.5/3300*100 | 0.91% | 1.82% |
| atr_multiple = 2.0 | 20*2.0/3300*100 | 1.21% | 2.42% |
| atr_multiple = 2.5 | 20*2.5/3300*100 | 1.52% | 3.03% |

→ XAU/USD は 1 日の典型変動幅が 20-50pips。15m 足の ATR=20pips なら **SL 1.5 倍 (0.91%) は標準的**。
ただし 4 時間ホールドで TP=1.82% に届くかは相場の方向性次第。

### 2.3 maxHoldingMinutes の関係

`maxHoldingBars: 48` × 15m = **12 時間**(デフォルト)。
24h レポートの BacktestEvent 観測:「timeout 一辺倒が解消、PF/勝率が正常値」 → Critical-1.6 修正後は TP/SL ヒット率が上がっている。

### 2.4 改善候補(検討用、実装はしない)

| 案 | 内容 | 期待効果 | リスク |
|---|---|---|---|
| **A** | DEFAULT の SL を 1.5 → 1.2 に下げる | TP/SL ヒット率向上、トレード回転速い | 勝率低下の可能性 |
| **B** | DEFAULT の RR を 2.0 → 1.5 に下げる | 勝率上昇、PF 上昇可能性 | 大きな利益取りこぼし |
| **C** | maxHoldingBars を 48 → 24 に半減 | timeout 増、winナ取り こぼし | スキャル寄り |
| **D** | HG プロンプトの推奨値範囲を狭める / 数値ガイドを追加 | HG が極端な値を選びにくくなる | プロンプト依存度上昇 |
| **E** | 実観測 RR=3.18 を踏まえ、HG に「RR は実勢を見て調整せよ」と明示 | HG が市場適応 | LLM の判断ぶれ |

---

## 3. 軸 3: screening 閾値の妥当性

### 3.1 現在の閾値(`statusManager.ts:41-48`)

```ts
export const SCREENING_THRESHOLDS = Object.freeze({
    minPF: 1.3,
    minWinRate: 0.4,
    minTradeCount: 20,
});
```

### 3.2 設計書根拠(`docs/design/phase_4b_specification.md:594`)

> 現在のスクリーニング基準(PF > 1.3, 勝率 40%, トレード数 20)は **暫定**。  
> **運用開始後に調整**。環境変数での外部化は Phase 4c で実施
> (Phase 4b ではハードコードで可、TODO コメント付けておく)。

→ **設計書で「暫定 + 運用後調整」が明記済み**。CLAUDE.md 5 条「閾値は設計書で議論される場合のみ変更可」の前提を満たす。

### 3.3 確定昇格(confirmed)との関係

`PROMOTION_THRESHOLDS`:
- 学習期間 PF > **1.5**
- 検証期間 PF > **1.3**
- 過学習スコア < 0.3

→ screening_passed の閾値 (PF 1.3) は **検証期間 PF と同じ**。screening を通った仮説が即 confirmed の検証期間条件を満たすことになる(過学習チェックは別途必要だが)。

### 3.4 観測データから見た閾値妥当性

24h 観測:
- PF 1.0-1.2 が大量に出ている
- 1.3 を超えるものはゼロ
- 勝率 40% を超えたのは 9 件中 2 件(1.180/45.0%, 1.130/47.6%)

**閾値を下げる選択肢の評価**:

| 案 | 内容 | 通過想定件数 | リスク |
|---|---|---|---|
| **F** | minPF: 1.3 → 1.2 | 5 件通過 | 損失戦略が紛れ込む |
| **G** | minPF: 1.3 → 1.1 | 7 件通過 | さらに紛れ込みリスク |
| **H** | minWinRate: 0.4 → 0.3 | 2 件通過 (PF 1.18, 1.13) | 高 RR 戦略のみ |
| **I** | (両方) minPF=1.2 / minWinRate=0.3 | 5-7 件通過 | 最も緩い |
| **J** | **据え置き、品質改善で対応** | 0 件 | 改善失敗時に永遠に rejected |

CLAUDE.md / DESIGN_DOC との整合:
- 閾値据え置きは原則的に正しい(品質改善が本筋)
- ただし「**品質改善が機能するか不明な状態で据え置く**」のは PDCA-2 がいつまでも回らないリスク
- 設計書「運用後調整」を踏まえると、**期間限定で緩めて回す → データが集まったら戻す**のもアリ

---

## 4. avgScore 退行の調査(別件、Critical-10 関連)

24h レポートで判明:
- 全スペシャリストで `phase-6.7c-20260425T115258Z-sync` 移行後 avgScore 低下
- HG: 0.609 → 0.574

### 推定原因(要調査)

1. プロンプト変更(2026-04-25)で出力構造の制約が厳しくなった可能性
   - JSON スキーマ違反で score=0 の比率が増えた?
2. 専門家分析統合(ステップ0)が追加されたことで HG の負担増 → 出力品質低下?
3. 別の Phase 6.7c 変更が影響?

### 確認方法

- `git log --since=2026-04-20 --until=2026-04-26 -- src/side-b/prompts/` で diff 確認
- PromptVersion テーブルで両バージョンの content を比較

---

## 5. 推奨アクション(議論用、優先度順)

### 5.1 即時着手可(設計判断軽め)

**P1. avgScore 退行の原因究明**(調査 1-2 時間)
- 旧 prompt vs 新 prompt の diff
- いつ avgScore が落ちたか(時系列分析)
- 退行の原因が特定できれば 5.2 や 5.3 の方針が定まる

**P2. HG プロンプトに観測フィードバックを追加**(設計判断小)
- 「実勢 RR 達成率 3.18 を踏まえ、TP=rr_ratio は控えめに 1.5 推奨」みたいな具体ガイド
- 勝率/PF の現実的な目標数値を明示
- 失敗パターン(RR 過大、勝率過小)を教える

### 5.2 設計判断必要(中程度)

**P3. DEFAULT_RISK_MANAGEMENT の見直し**(値変更)
- `value: 1.5` (SL ATR) や `value: 2.0` (RR) の妥当性検証
- 観測データ(RR 達成 3.18, 勝率 26%) に合わせて調整

**P4. maxHoldingBars の見直し**(値変更)
- 現 48 bars (15m × 48 = 12h) が適切か検証

### 5.3 設計判断必要(大、要 Nekoさん 議論)

**P5. screening 閾値の暫定緩和**
- 設計書「運用後調整」の発動
- 例: minPF 1.3 → 1.2 を期間限定で
- screening_passed が 0 のまま PDCA-2 が止まることを避ける目的

**P6. EvolutionLoop 起動による SLTP 自動探索**
- 計画書 §0「Critical-EvolutionStart」がそもそも本筋
- mutation.md / crossover.md で SL/TP 自動探索 → 最適値発見
- ただし autoEvolution=true 切替には LLM コスト試算 + Nekoさん 承認必要

---

## 6. 推奨実行順

```
P1 (avgScore 退行調査) ← 今すぐ着手可
↓ 原因特定
P2 (HG プロンプト改良) ← P1 結果を踏まえて
↓ 1 サイクル観察(24h)
P3/P4 が必要かを観察データで判断
↓
それでも screening_passed=0 が続くなら:
P5 (閾値暫定緩和) または P6 (EvolutionLoop 起動)
```

---

## 7. 関連設計書・コード参照

| 参照 | 内容 |
|---|---|
| `docs/design/phase_4b_specification.md:594` | 「閾値は暫定、運用後調整」明記 |
| `docs/design/DESIGN_DOC_autonomous_trading_architecture.md:251` | Phase 4b 基準の根拠 |
| `docs/design/CLAUDE_md_supplement.md:31-32` | 昇格基準(学習 PF 1.5 / 検証 PF 1.3) |
| `src/side-b/prompts/hypothesis_generator.md` | HG プロンプト本体 |
| `src/side-b/models/edgeHypothesis.ts:163` | DEFAULT_RISK_MANAGEMENT |
| `src/side-b/ledger/statusManager.ts:41-48` | SCREENING_THRESHOLDS |
| `src/side-b/bridge/MaterializationService.ts:194-237` | SL/TP % 換算ロジック |
| `docs/diagnostics/critical_1_5_6_7_24h_observation.md` | 24h 観測結果(PR #74) |

---

*生成: Critical-10 着手前の事前調査。Nekoさん 起床後の設計議論のたたき台として整理。*
