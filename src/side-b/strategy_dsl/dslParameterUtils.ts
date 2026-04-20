/**
 * DSL パラメータ既定値の展開
 */

import type { StrategyDSL } from './schema';

export function defaultParameterValues(dsl: StrategyDSL): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, def] of Object.entries(dsl.parameters)) {
    out[k] = def.default;
  }
  return out;
}
