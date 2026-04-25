/**
 * Phase 6: TrendSpecialist
 *
 * 担当: dow_theory レンズ + current_analysis の MA 関連部分 + ADX
 *
 * 設計:
 * - 入力: SpecialistInput (LensFeatureSnapshot を含む)
 * - 出力: TrendAnalysis
 * - LLM 失敗時は null を返し、呼び出し側がフォールバックできる
 * - SkillRegistry.compute_lens_features でレンズを取得する想定だが、
 *   呼び出し側 (HypothesisGenerator orchestration) で事前取得済みの snapshot を渡す運用に寄せる
 *   -> 専門家自身は LLM 呼び出しに専念
 */

import { AIProvider } from '../../agent/aiProvider';
import { loadSpecialistPromptWithGlobalAndCommon } from '../../prompts/loader';
import { modelFor } from '../../../config';
import type { SpecialistInput, TrendAnalysis } from './types';
import {
  formatLensDump,
  clampNumber,
  pickEnum,
  runSpecialistWithVariant,
} from './specialistCommon';
import type { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { RandomGenerator } from '../../prompts/registry/variantSelector';

const TREND_RELEVANT_LENSES = ['dow_theory', 'current_analysis'];

const TREND_STATES = ['strong_up', 'weak_up', 'ranging', 'weak_down', 'strong_down'] as const;
const TREND_MATURITIES = ['early', 'middle', 'late'] as const;

export interface TrendSpecialistDeps {
  registry?: PromptRegistry;
  rand?: RandomGenerator;
}

export class TrendSpecialist {
  constructor(
    private readonly ai: AIProvider = new AIProvider({
      model: modelFor('trend_specialist'),
    }),
    private readonly deps: TrendSpecialistDeps = {},
  ) {}

  /**
   * トレンド分析を実行。失敗時は null。
   *
   * Phase 6.6: PromptRegistry + variantSelector を経由して active/experimental を
   * 確率的に選び、スコアリング結果を recordUsage に書き込む。experimental 失敗
   * 時は active で自動再試行する。registry に active が無い / 読み込み失敗時は
   * 従来通り loadPrompt() の内容で実行(後方互換)。
   */
  async analyze(input: SpecialistInput): Promise<TrendAnalysis | null> {
    const fallback = loadSpecialistPromptWithGlobalAndCommon('specialists/trend_specialist');
    const lensDump = formatLensDump(input.lensSnapshot, TREND_RELEVANT_LENSES);
    const user = this.buildUserPrompt(input, lensDump);

    const result = await runSpecialistWithVariant<TrendAnalysis>(this.ai, {
      agentName: 'trend_specialist',
      userPrompt: user,
      fallbackSystemPrompt: fallback,
      scoringInput: input,
      validate: (raw) => {
        if (!raw || typeof raw !== 'object') return null;
        return this.validate(raw as Record<string, unknown>);
      },
      registry: this.deps.registry,
      rand: this.deps.rand,
    });
    return result.output;
  }

  private buildUserPrompt(input: SpecialistInput, lensDump: string): string {
    return `# トレンド分析リクエスト

- symbol: ${input.symbol}
- timeframe: ${input.timeframe}
- snapshot at: ${input.lensSnapshot.timestamp.toISOString()}

## 担当レンズの特徴量

${lensDump}

上記を見て、システムプロンプトのスキーマに従った JSON オブジェクトだけを返してください。`;
  }

  private validate(raw: Record<string, unknown>): TrendAnalysis {
    const trendState = pickEnum(raw.trendState, TREND_STATES, 'ranging');
    const trendStrength = clampNumber(raw.trendStrength, 0, 1, 0);
    const trendMaturity = pickEnum(raw.trendMaturity, TREND_MATURITIES, 'middle');
    const interpretation =
      typeof raw.interpretation === 'string' ? raw.interpretation : '';
    const confidence = clampNumber(raw.confidence, 0, 1, 0.3);

    const keyLevels = extractKeyLevels(raw.keyLevels);

    return {
      trendState,
      trendStrength,
      trendMaturity,
      keyLevels,
      interpretation,
      confidence,
    };
  }
}

function extractKeyLevels(raw: unknown): { support: number[]; resistance: number[] } {
  if (!raw || typeof raw !== 'object') return { support: [], resistance: [] };
  const r = raw as Record<string, unknown>;
  const support = extractNumberArray(r.support);
  const resistance = extractNumberArray(r.resistance);
  return { support, resistance };
}

function extractNumberArray(x: unknown): number[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}
