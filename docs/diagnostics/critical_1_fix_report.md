# Critical-1 修正作業レポート

> 作業日: 2026-04-30
> 対象: `docs/diagnostics/orchestration_health_report.md` §5 Critical-1
> 種別: コード修正(調査診断レポートから派生)
> ブランチ: `fix/backend-lint-hardening`(継続作業、commit は未実施)

---

## 1. 修正の目的

ScreeningOrchestrator が呼び出す MaterializationService が **66/66 全件失敗**(`Materialization失敗: atr_multiple SL を要求されたが ATR が取得できない`)で詰まり、PDCA-2(戦略進化サイクル)が screening 段階で完全停止していた。

根本原因:

- screening ジョブが `agentMemory.getCurrentLensSnapshot(symbol)` から取り出した snapshot を使う設計だった
- `agentMemory` の snapshot は **直近の Plan 生成時** に書き込まれるため、screening ジョブのタイミング・別シンボル・Plan 生成と非同期な実行では **`volatility_regime.atr` が undefined** になりうる
- `MaterializationService.calculateStopLossPercent('atr_multiple', undefined, _)` は即 `MaterializationError` を投げる
- HG が `defaultRiskManagement.stopLoss.type='atr_multiple'` を生成する限り、この経路は雪だるま式に not_testable を量産する

修正方針: ScreeningOrchestrator が **OHLCV 補完後の bars から fresh な lensSnapshot を直接計算** し、materialize に渡す。`agentMemory` 依存をなくして screening ジョブが自己完結するようにする。

---

## 2. 変更ファイル

### `src/side-b/bridge/ScreeningOrchestrator.ts`

- **import 追加**: `defaultLensAggregator`, `registerDefaultLenses`, `LensAggregator` 型, `OHLCVBar` 型
- **定数追加**: `SCREENING_LENS_LOOKBACK = 150`(VolatilityRegimeLens の必要本数 26 を満たす + percentileLookback 100 に余裕を持たせた値)
- **コンストラクタに `lensAggregator` 引数追加**(7 番目 / DI 用)
- **`runScreening` のフロー変更**:
  1. (新)`ensureOhlcvData` を materialize 前に実行(ATR 計算用 OHLCV を先に確保)
  2. (新)`resolveLensSnapshot` で fresh な snapshot を計算(または provided を ATR 検証して採用)
  3. その snapshot を `materializeForValidation` に渡す
- **新メソッド `resolveLensSnapshot(symbol, timeframe, periodEnd, provided)`**:
  - provided に `volatility_regime.atr > 0` があれば優先
  - そうでなければ `ohlcvRepo.findManyAsOHLCVData` で末尾 150 本を取得 → `lensAggregator.computeAll` で fresh snapshot を生成
  - 取得失敗時は provided にフォールバック(materialize 側のエラー処理に任せる)

### `src/side-b/bridge/MaterializationService.ts`

- **`getAtrFromSnapshot`**: 早期 return をやや明示化(コメント追加のみ、挙動は変更なし)
- **エラーメッセージの強化**:
  - `'atr_multiple SL を要求されたが ATR が取得できない'`
    → `'... (volatility_regime レンズが unknown または lensSnapshot 未提供)'`
  - TP 側も同様に強化

呼び出し側(ScreeningOrchestrator)で原因を切り分けやすくするための診断情報強化。挙動変更なし。

### `src/side-b/tests/bridge/screeningOrchestrator.test.ts`

- 既存 9 ケースは挙動温存(`lensAggregator` を mock として注入する追加だけ)
- 新規 3 ケース追加:
  - `options.lensSnapshot を渡さなくても OHLCV から fresh な lensSnapshot を計算して materialize に渡す`
  - `options.lensSnapshot に有効な ATR があれば fresh 計算をスキップしてそれを使う`
  - `options.lensSnapshot に ATR が無ければ fresh 計算で補完する`
- ヘルパー `makeFreshLensSnapshot(atr)` を追加

---

## 3. 検証

| チェック | 結果 |
|---|---|
| `npx tsc --noEmit` | ✓ エラーなし |
| `npx eslint` 変更3ファイル | ✓ 0 errors / 0 warnings(初回 1 件あった `as unknown as` 不要キャストを修正) |
| `npx jest src/side-b/tests/bridge/screeningOrchestrator.test.ts` | ✓ 12/12 passed(既存 9 + 新規 3) |
| `npx jest src/side-b/tests/orchestrator/ src/side-b/tests/lenses/ src/side-b/__tests__/` | ✓ 53/53 passed(関連スイート全て) |

---

## 4. 影響範囲・互換性

- **後方互換**: ✓ `options.lensSnapshot` に有効な ATR がある場合は従来通りそれを使う(挙動変更なし)
- **DI 引数追加**: コンストラクタに `lensAggregator` を **7 番目の任意引数** として追加。既定は `defaultLensAggregator`。既存の呼び出し側(scheduler / プロダクションコード)は引数指定なしで引き続き動く
- **本番 DB 影響**: 修正自体は読み取り専用。既存の 66 件の `not_testable` 仮説のステータスは変更せず、再 screening 実行は別タスク(Nekoさん の承認後)
- **`agentMemory` 依存の廃止**: ScreeningOrchestrator から消えただけで、agentMemory 自体は他のパス(Reflection 等)で引き続き使用される

---

## 5. やっていないこと(意図的)

- **既存 66 件の `not_testable` 仮説の救済**: prod write になるため、まず本修正をデプロイして次回 HG 生成分が screening_passed まで通ることを確認した上で、Nekoさん の承認を得てから別タスクで対応
- **commit / push**: ご指示なしのため未実施。動作確認後にお知らせください
- **MaterializationService の本質ロジック変更**: ATR 取得経路自体は変更しない(snapshot 経由を維持)。診断情報を強化したのみ
- **他の Critical 項目への着手**: 今回は Critical-1 のみ。他 7 件は別タスクとして待機

---

## 6. 期待される効果(本修正単独で)

1. **PDCA-2 の screening 段階詰まりが解消**: 次回 HG が生成する仮説は OHLCV さえあれば screening まで進む
2. **screening_passed → testing → confirmed/rejected** の連鎖が動き始める可能性が出る(Strategist の発火経路が初めて開く)
3. **`StrategyBacktestRun` テーブル**への書き込みが再開する見込み(直近 30 日 0 件 → 本修正後は screening 経由で execute される)
4. **`agentMemory` 副作用に依存しない自己完結 screening**: ジョブが Plan 生成と独立に走れる

---

## 7. 次のおすすめアクション

1. **本修正を本番にデプロイし、1 ジョブサイクル(24h)観察**
   - `runScreeningNow` の手動実行で 1〜2 件試すのが安全
2. **新規 HG 生成の挙動を観察**: 次の Plan 生成サイクルで生まれる仮説が `unverified` のまま(screening まで通る)か、`not_testable` に倒されるか
3. **観察結果を踏まえて Critical-6**(overallConfidence=0 連続 / DA abandon 多発)に着手

---

## 8. 作業の決定的成果

| 指標 | 修正前 | 修正後(設計上) |
|---|---|---|
| screening 経由の materialize 成功率 | **0%(66/66 失敗)** | OHLCV があれば成功する見込み |
| `agentMemory` 依存 | あり | なし |
| Materialize エラー診断情報 | "ATR が取得できない" のみ | 原因(レンズ unknown / snapshot 未提供)を明示 |
| screening 専用 lensSnapshot 計算経路 | なし | あり(150 本ルックバック) |
| ユニットテスト | 9 件 | 12 件(+3、fresh 計算経路を網羅) |

---

> 本レポートは作業の事実報告であり、本番反映の判断は Nekoさん にお任せします。
> commit / push は未実施。動作確認 OK の合図をいただいた後にお願いします。
