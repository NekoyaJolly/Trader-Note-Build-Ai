/**
 * Phase 4c 検証ツール群の公開 API
 */

export type {
    ValidationTool,
    ValidationToolInput,
    ValidationToolResult,
    ValidationToolImplementation,
} from './types';

export {
    MonteCarloTool,
    monteCarloTool,
    percentile,
    shuffle,
    simulatePath,
    type MonteCarloToolConfig,
    type RandomSource,
} from './MonteCarloTool';

export {
    BuyAndHoldTool,
    buyAndHoldTool,
    type BuyAndHoldToolConfig,
} from './BuyAndHoldTool';
