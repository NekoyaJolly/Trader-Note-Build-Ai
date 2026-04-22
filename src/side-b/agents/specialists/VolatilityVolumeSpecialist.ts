/**
 * Phase 6: VolatilityVolumeSpecialist
 *
 * 担当: volatility_regime レンズ + current_analysis の ATR/BB 部分
 * + ボリューム系(利用可能な場合のみ、FX では no_data を返す)
 */

import { AIProvider } from '../../agent/aiProvider';
import { loadPrompt } from '../../prompts/loader';
import { modelFor } from '../../../config';
import type { SpecialistInput, VolatilityVolumeAnalysis } from './types';
import {
  formatLensDump,
  clampNumber,
  pickEnum,
  runSpecialistWithVariant,
} from './specialistCommon';
import type { PromptRegistry } from '../../prompts/registry/PromptRegistry';
import type { RandomGenerator } from '../../prompts/registry/variantSelector';

const VOLATILITY_RELEVANT_LENSES = ['volatility_regime', 'current_analysis'];

const VOLATILITY_REGIMES = ['expansion', 'normal', 'contraction'] as const;
const BREAKOUT_RISKS = ['high', 'medium', 'low'] as const;
const VOLUME_SIGNALS = ['unusual_high', 'normal', 'unusual_low', 'no_data'] as const;

export interface VolatilityVolumeSpecialistDeps {
  registry?: PromptRegistry;
  rand?: RandomGenerator;
}

export class VolatilityVolumeSpecialist {
  constructor(
    private readonly ai: AIProvider = new AIProvider({
      model: modelFor('volatility_volume_specialist'),
    }),
    private readonly deps: VolatilityVolumeSpecialistDeps = {},
  ) {}

  /**
   * Phase 6.6: PromptRegistry + variantSelector 経由でプロンプトを選択し、
   * experimental は 20% 以下で試行、失敗時 active にフォールバック、
   * スコアリング結果を recordUsage に書き込む。
   */
  async analyze(input: SpecialistInput): Promise<VolatilityVolumeAnalysis | null> {
    const fallback = loadPrompt('specialists/volatility_volume_specialist');
    const lensDump = formatLensDump(input.lensSnapshot, VOLATILITY_RELEVANT_LENSES);
    const user = this.buildUserPrompt(input, lensDump);

    const result = await runSpecialistWithVariant<VolatilityVolumeAnalysis>(this.ai, {
      agentName: 'volatility_volume_specialist',
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
    return `# ボラティリティ / ボリューム分析リクエスト

- symbol: ${input.symbol}
- timeframe: ${input.timeframe}
- snapshot at: ${input.lensSnapshot.timestamp.toISOString()}

## 担当レンズの特徴量

${lensDump}

上記を見て、システムプロンプトのスキーマに従った JSON オブジェクトだけを返してください。
ボリュームデータが得られない場合は volumeSignal に "no_data" を入れてください。`;
  }

  private validate(raw: Record<string, unknown>): VolatilityVolumeAnalysis {
    return {
      volatilityRegime: pickEnum(raw.volatilityRegime, VOLATILITY_REGIMES, 'normal'),
      breakoutRisk: pickEnum(raw.breakoutRisk, BREAKOUT_RISKS, 'medium'),
      volumeSignal: pickEnum(raw.volumeSignal, VOLUME_SIGNALS, 'no_data'),
      interpretation: typeof raw.interpretation === 'string' ? raw.interpretation : '',
      confidence: clampNumber(raw.confidence, 0, 1, 0.3),
    };
  }
}
