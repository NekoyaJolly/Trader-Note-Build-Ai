/**
 * AITradeScenario → StrategyDSL 変換（Phase 6.7b）
 *
 * Strategy Thinker のシナリオは価格・pips ベース。DSL BT は ohlcv レンズ上の
 * 条件式でシミュレーションするため、エントリーは「価格が entry 水準を満たす」
 * 程度に正規化する（厳密な指標一致は Phase 6.7c 以降で拡張可）。
 *
 * - ロング: 終値がエントリー価格を上抜けたバーでエントリー
 * - ショート: 終値がエントリー価格を下抜けたバーでエントリー
 */

import type { AITradeScenario } from '../models/tradePlan';
import type { z } from 'zod';
import { StrategyDSLSchema, ImmediateEntrySchema } from './schema';

type ImmediateEntryDsl = z.infer<typeof ImmediateEntrySchema>;
type StrategyDslInput = z.input<typeof StrategyDSLSchema>;

export interface ScenarioToDslContext {
  symbol: string;
  /** 例: 15m, 1h */
  timeframe: string;
  /** DSL の id 接頭辞（未指定は scenario.id） */
  idPrefix?: string;
}

/**
 * プラン 1 シナリオを学習用 StrategyDSL（即時エントリー）に変換する
 */
export function scenarioToStrategyDSL(
  scenario: AITradeScenario,
  context: ScenarioToDslContext,
): z.infer<typeof StrategyDSLSchema> {
  const { symbol, timeframe, idPrefix } = context;
  const isLong = scenario.direction === 'long';
  const entryPrice = scenario.entry?.price;
  if (!(typeof entryPrice === 'number' && Number.isFinite(entryPrice) && entryPrice > 0)) {
    throw new Error(`シナリオ ${scenario.id} の entry.price が不正です`);
  }

  const supportedOrderTypes = ['market', 'limit', 'stop'] as const;
  const entryBlock: StrategyDslInput['entry'] = (() => {
    if (scenario.entry.type === 'wait_for_trigger') {
      if (!scenario.entry.triggerConditions) {
        throw new Error(
          `シナリオ ${scenario.id} は wait_for_trigger ですが triggerConditions がありません`,
        );
      }
      const maxWaitBars = scenario.entry.maxWaitBars;
      return {
        type: 'wait_for_trigger',
        direction: isLong ? 'long' : 'short',
        triggerConditions: scenario.entry.triggerConditions,
        maxWaitBars:
          typeof maxWaitBars === 'number' && Number.isFinite(maxWaitBars) && maxWaitBars > 0
            ? Math.trunc(maxWaitBars)
            : 48,
        executionType: scenario.entry.executionType ?? 'market',
      };
    }

    if (!supportedOrderTypes.includes(scenario.entry.type)) {
      throw new Error(`シナリオ ${scenario.id} の entry.type は未対応です: ${scenario.entry.type}`);
    }
    const orderType: ImmediateEntryDsl['orderType'] = scenario.entry.type;
    return isLong
      ? {
          direction: 'long',
          trigger: {
            logic: 'AND',
            conditions: [
              { lens: 'ohlcv', feature: 'close', op: '>', value: entryPrice },
            ],
          },
          orderType,
        }
      : {
          direction: 'short',
          trigger: {
            logic: 'AND',
            conditions: [
              { lens: 'ohlcv', feature: 'close', op: '<', value: entryPrice },
            ],
          },
          orderType,
        };
  })();

  const slPips = scenario.stopLoss?.pips;
  const slNum = typeof slPips === 'number' && Number.isFinite(slPips) && slPips > 0 ? slPips : 20;

  const tpPips = scenario.takeProfit?.pips;
  const tpPipsNum = typeof tpPips === 'number' && Number.isFinite(tpPips) && tpPips > 0 ? tpPips : slNum * 2;
  const rr = tpPipsNum / slNum;

  const raw: StrategyDslInput = {
    id: `${idPrefix ?? 'dsl'}-${scenario.id}`.replace(/[^a-zA-Z0-9-_]/g, '_'),
    generation: 0,
    parentIds: [],
    regimeTarget: 'plan_scenario',
    symbol,
    timeframe,
    entry: entryBlock,
    stopLoss: { type: 'fixed_pips' as const, value: slNum },
    takeProfit: { type: 'rr_ratio' as const, value: Math.max(0.5, Math.min(10, rr)) },
    parameters: {},
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'llm_generated' as const,
      description: scenario.name,
    },
  };

  return StrategyDSLSchema.parse(raw);
}
