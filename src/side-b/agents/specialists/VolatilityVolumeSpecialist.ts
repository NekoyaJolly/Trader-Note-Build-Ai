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
  callLLMForJson,
  clampNumber,
  pickEnum,
} from './specialistCommon';

const VOLATILITY_RELEVANT_LENSES = ['volatility_regime', 'current_analysis'];

const VOLATILITY_REGIMES = ['expansion', 'normal', 'contraction'] as const;
const BREAKOUT_RISKS = ['high', 'medium', 'low'] as const;
const VOLUME_SIGNALS = ['unusual_high', 'normal', 'unusual_low', 'no_data'] as const;

export class VolatilityVolumeSpecialist {
  constructor(
    private readonly ai: AIProvider = new AIProvider({
      model: modelFor('volatility_volume_specialist'),
    }),
  ) {}

  async analyze(input: SpecialistInput): Promise<VolatilityVolumeAnalysis | null> {
    const system = loadPrompt('specialists/volatility_volume_specialist');
    const lensDump = formatLensDump(input.lensSnapshot, VOLATILITY_RELEVANT_LENSES);
    const user = this.buildUserPrompt(input, lensDump);

    const raw = await callLLMForJson(this.ai, system, user);
    if (!raw || typeof raw !== 'object') return null;
    return this.validate(raw as Record<string, unknown>);
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
