/**
 * TimeSessionLens - 時刻から主要市場セッション状態を判定するレンズ
 *
 * LLM 非依存・純粋な時刻計算のみ。
 *
 * **PR ⑤D-1 から**: 計算式は `src/shared/timeframes/timeSession.ts` の
 * `computeTimeSessionFeatures` に集約 (= 単一真実)。本クラスは入力検証 +
 * Lens 規約準拠のラッパーとして機能する。式が surrogate / analysis-engine /
 * 本 lens の 3 経路で完全一致するため drift しない。
 *
 * セッション定義（全て UTC 基準）:
 * - 東京: 0-6 UTC（JST 9-15）
 * - ロンドン: 8-16 UTC
 * - NY: 13-21 UTC
 * - ロンドン/NY オーバーラップ: 13-16 UTC
 * - 東京/ロンドン オーバーラップ: 7-8 UTC 境界付近（実務上 8 UTC）
 *
 * **週末判定の制約**: PR ⑤D-1 で `is_weekend` は shared 関数の **簡易判定**
 * (= 固定 21 UTC) を採用。旧 TimeSessionLens は `marketHours.ts:isFXMarketOpen`
 * の DST 考慮 (= 22 UTC 切替) を使っていたが、Python 側との同期コストが高い
 * ため一旦シンプルに統一。将来 DST 考慮を戻す場合は shared 側で DST ロジックを
 * 実装 + Python に同期する形で別 PR 対応。
 *
 * @see docs/design/phase_1_specification.md セクション 4.3
 * @see src/shared/timeframes/timeSession.ts (= 単一真実の式)
 */

import {
  computeTimeSessionFeatures,
  TIME_SESSION_LENS_VERSION,
} from '../../shared/timeframes/timeSession';
import type { Lens, LensFeature, LensInput } from './types';

export class TimeSessionLens implements Lens {
  readonly name = 'time_session';
  // PR ⑤D-1: shared 側の TIME_SESSION_LENS_VERSION を真実とし、本クラスでは
  // それを読むだけ (= リテラル直書きで version 同期漏れを起こさないため)。
  readonly version = TIME_SESSION_LENS_VERSION;
  readonly dependencies = ['timestamp'] as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const ts = input.timestamp;

    if (isNaN(ts.getTime())) {
      throw new Error('TimeSessionLens: invalid timestamp');
    }
    if (ts.getTime() > Date.now() + 60_000) {
      throw new Error('TimeSessionLens: timestamp is in the future');
    }

    // 単一真実の式 (= shared/timeframes/timeSession.ts) で features を構築。
    // surrogate snapshotAt / analysis-engine runner と完全に同じ結果になる。
    const features = computeTimeSessionFeatures(ts);

    return {
      lensName: this.name,
      lensVersion: this.version,
      features,
      computedAt: new Date(),
      computeDurationMs: Date.now() - start,
      confidence: 1.0,
    };
  }
}
