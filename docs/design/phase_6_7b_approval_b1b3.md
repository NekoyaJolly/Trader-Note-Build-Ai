# Phase 6.7b — 人間承認ゲート B1〜B3（実装用ベースライン）

> 親: [phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §9  
> 目的: 実装前に揃えたい合意事項を、設計ドキュメント上の**確定事項**に紐づけて1ファイルに集約する。  
> 2026-04-25: リポジトリ整備（実装担当がそのまま参照可能な形）

---

## B1: StrategyDSL 拡張の最終仕様

- **出典**: [phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §3.1, §3.2
- **確定**（Neko さん承認済み、設計書記載）:
  1. `parameters` に **固定値に加え探索範囲**（`ParameterRange` 案: `kind: 'range'`, `min`, `max`, `step`, `default`）
  2. **`wait_for_trigger` エントリー**（`triggerConditions` / `maxWaitBars` / `executionType` 等、§3.3 の形）
  3. **scenarios 最低 1 本**（プロンプト 6.7c 含む。DSL 側は **空配列をエラー** とする、§3.1）
- **前提調査**: [phase_6_7b_strategy_dsl_audit.md](phase_6_7b_strategy_dsl_audit.md)（現行は `orderType` + `trigger` のみ。B1 実装は **Zod 拡張 + 後方互換** の方針で進める）
- **実装時の分岐点**: 既存 `ParameterDef`（`range` タプル型）を **6.7b 案の `ParameterValue` union** に置き換えるか、**別フィールド**で持つか → **B1 のゴーサイン後**に [schema.ts](../../src/side-b/strategy_dsl/schema.ts) のパッチで確定

---

## B2: `wait_for_trigger` の BT 評価ロジック（未来情報の扱い）

- **出典**: [phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §3.4, 3-7（テスト観点）
- **確定**（設計書）:
  - 待機中はバー毎に `triggerConditions` 評価。成立時は **次バー始値**で約定
  - `maxWaitBars` 超過 → `expired`（トレードなし）
- **重要**: 参照する特徴量は **BT 時点で計算可能なもののみ**（§3.4）。漏洩防止のため、バリデーション層で **未対応 `lens` / feature** を弾くか、§3-7 の「可能ならバリデーションエラー」に照らして **実装方針を B2 の実装前レビューで最終化**する。

---

## B3: BT 期間のデフォルト

- **出典**: [phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §5.4
- **確定**（設計書）:
  - `DEFAULT_BT_PERIOD_DAYS = 365`
  - 終了 = 現在日時、開始 = 終了から 365 日遡り
- **補足**: 将来、Discovery 週次など短い期間に上書き可能にする想定（同節）。初回実装は **固定デフォルト + オプション引数** で足りる

---

## B4 / B5（参照のみ）

- **B4**: 組み合わせ上限 **例: 500**（[phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §3.2）— パフォーマンス契約
- **B5**: scenario → StrategyDSL マッパー（§5.3、`dslEdgeMapper` 等）— 実装中に都度合意

---

## 自己確認チェックリスト（実装開始前）

- [ ] B1 の Zod/型定義案を 1 回レビューした
- [ ] B2 の「許可する lens 一覧」またはバリデーション方針をメモした
- [ ] B3 をコード定数に落とし込む場所（例: `StrategyBacktesterAgent` 直近）を決めた

---

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-04-25 | 初版（設計ドキュメントに基づく B1〜B3 の集約。法的承認の代替ではない） |
