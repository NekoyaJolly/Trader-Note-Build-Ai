/**
 * Phase 6: OscillatorSpecialist
 *
 * 担当: current_analysis レンズの RSI/MACD/Stochastic/Williams %R 部分
 */

import { AIProvider } from '../../agent/aiProvider';
import { loadPrompt } from '../../prompts/loader';
import { modelFor } from '../../../config';
import type { SpecialistInput, OscillatorAnalysis } from './types';
import {
  formatLensDump,
  clampNumber,
  pickEnum,
  runSpecialistWithVariant,
} from './specialistCommon';
import type { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { RandomGenerator } from '../../prompts/registry/variantSelector';

const OSCILLATOR_RELEVANT_LENSES = ['current_analysis', 'dow_theory'];

const MOMENTUM_STATES = [
  'overbought',
  'bullish',
  'neutral',
  'bearish',
  'oversold',
] as const;

const DIVERGENCE_STATES = ['bullish_divergence', 'bearish_divergence', 'none'] as const;

export interface OscillatorSpecialistDeps {
  registry?: PromptRegistry;
  rand?: RandomGenerator;
}

export class OscillatorSpecialist {
  constructor(
    private readonly ai: AIProvider = new AIProvider({
      model: modelFor('oscillator_specialist'),
    }),
    private readonly deps: OscillatorSpecialistDeps = {},
  ) {}

  /**
   * Phase 6.6: PromptRegistry + variantSelector 経由でプロンプトを選択し、
   * experimental は 20% 以下で試行、失敗時 active にフォールバック、
   * スコアリング結果を recordUsage に書き込む。
   */
  async analyze(input: SpecialistInput): Promise<OscillatorAnalysis | null> {
    const fallback = loadPrompt('specialists/oscillator_specialist');
    const lensDump = formatLensDump(input.lensSnapshot, OSCILLATOR_RELEVANT_LENSES);
    const user = this.buildUserPrompt(input, lensDump);

    const result = await runSpecialistWithVariant<OscillatorAnalysis>(this.ai, {
      agentName: 'oscillator_specialist',
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
    return `# オシレーター分析リクエスト

- symbol: ${input.symbol}
- timeframe: ${input.timeframe}
- snapshot at: ${input.lensSnapshot.timestamp.toISOString()}

## 担当レンズの特徴量

${lensDump}

上記を見て、システムプロンプトのスキーマに従った JSON オブジェクトだけを返してください。`;
  }

  private validate(raw: Record<string, unknown>): OscillatorAnalysis {
    return {
      momentum: pickEnum(raw.momentum, MOMENTUM_STATES, 'neutral'),
      divergence: pickEnum(raw.divergence, DIVERGENCE_STATES, 'none'),
      interpretation: typeof raw.interpretation === 'string' ? raw.interpretation : '',
      confidence: clampNumber(raw.confidence, 0, 1, 0.3),
    };
  }
}
