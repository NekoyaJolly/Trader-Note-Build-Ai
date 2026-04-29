/**
 * LensAggregator - 複数レンズの並列実行・統合
 *
 * Phase 1 基盤実装。仕様書 4.4 節に準拠。
 *
 * 特徴:
 * - Promise.allSettled で一部レンズ失敗時も他レンズの結果を返す
 * - レンズの登録・削除をランタイムで変更可能
 * - 同名レンズの二重登録はエラー
 * - LensFeatureSnapshot を永続化可能形式に変換するヘルパーを同梱
 *
 * @see docs/design/phase_1_specification.md セクション 4.4
 */

import type {
  Lens,
  LensInput,
  LensFeature,
  LensFeatureSnapshot,
  SerializedLensFeatureSnapshot,
} from './types';

/**
 * 複数レンズを保持し、並列実行して統合結果を返すクラス
 */
export class LensAggregator {
  private readonly lenses: Map<string, Lens> = new Map();

  /**
   * レンズを登録する
   *
   * @throws 同名レンズが既に登録されている場合
   */
  register(lens: Lens): void {
    if (this.lenses.has(lens.name)) {
      throw new Error(`Lens "${lens.name}" is already registered`);
    }
    this.lenses.set(lens.name, lens);
  }

  /**
   * レンズを削除する
   *
   * 存在しないレンズ名を指定した場合は何もしない（冪等）。
   */
  unregister(lensName: string): void {
    this.lenses.delete(lensName);
  }

  /** 現在登録されているレンズ名の一覧を返す（順序は登録順） */
  getRegisteredLenses(): string[] {
    return Array.from(this.lenses.keys());
  }

  /** 登録レンズ数を返す */
  size(): number {
    return this.lenses.size;
  }

  /**
   * 全レンズを並列実行し、成功したレンズの結果を統合して返す
   *
   * 失敗したレンズはログに記録されるが、features Map には含まれない。
   * 1つのレンズ失敗が全体を止めない設計（Promise.allSettled）。
   */
  async computeAll(input: LensInput): Promise<LensFeatureSnapshot> {
    const start = Date.now();
    const lensEntries = Array.from(this.lenses.entries());

    const results = await Promise.allSettled(
      lensEntries.map(([, lens]) => lens.compute(input))
    );

    const features = new Map<string, LensFeature>();
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const [lensName] = lensEntries[i];

      if (result.status === 'fulfilled') {
        features.set(lensName, result.value);
      } else {
         
        console.error(`[LensAggregator] lens "${lensName}" failed:`, result.reason);
      }
    }

    return {
      timestamp: input.timestamp,
      symbol: input.symbol,
      features,
      totalComputeDurationMs: Date.now() - start,
    };
  }
}

/**
 * LensFeatureSnapshot を JSON シリアライズ可能な形式に変換する
 *
 * AITradeNote.lensSnapshot 等に永続化する際に使う。
 */
export function serializeLensSnapshot(
  snapshot: LensFeatureSnapshot
): SerializedLensFeatureSnapshot {
  const features: Record<string, Record<string, number | string | boolean>> = {};
  for (const [lensName, feature] of snapshot.features.entries()) {
    features[lensName] = { ...feature.features };
  }
  return {
    timestamp: snapshot.timestamp.toISOString(),
    symbol: snapshot.symbol,
    features,
    totalComputeDurationMs: snapshot.totalComputeDurationMs,
  };
}

/**
 * プロセス共通のデフォルトアグリゲーター
 *
 * Phase 1 ではレンズ未登録の空インスタンスとして export する。
 * Phase 1-B で CurrentAnalysisLens / TimeSessionLens が登録される。
 */
export const defaultLensAggregator = new LensAggregator();
