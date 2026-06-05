/**
 * Side-B スキル集約エクスポート (Phase 5.5)
 *
 * エージェントが自律的に呼び出せるスキル群と、その登録レジストリ。
 *
 * 使用例:
 *   import { buildDefaultSkillRegistry } from 'src/side-b/skills';
 *   const registry = buildDefaultSkillRegistry();
 *   const tools = registry.toMcpToolDefinitions();  // AgentLoop に渡せる
 *   const result = await registry.invoke('query_edge_ledger', { statuses: ['unverified'] });
 *
 * AgentLoop 統合時は `McpClientManager` の代わりに `SkillRegistry.callAsMcpTool`
 * を呼ぶ shim を差し込むだけで移行可能(本 MVP では差し込みは行わない)。
 */

export type {
  Skill,
  SkillContext,
  SkillInvocationContext,
  SkillResult,
  SkillError,
  SkillInputSchema,
} from './types';

export { SkillRegistry } from './registry';

export {
  createQueryEdgeLedgerSkill,
  type QueryEdgeLedgerInput,
  type QueryEdgeLedgerOutput,
} from './ledger/queryEdgeLedger';
export {
  createGetHypothesisSkill,
  type GetHypothesisInput,
  type GetHypothesisOutput,
} from './ledger/getHypothesis';
export {
  createRegisterHypothesisSkill,
  type RegisterHypothesisInput,
  type RegisterHypothesisOutput,
} from './ledger/registerHypothesis';
export {
  createRunScreeningSkill,
  type RunScreeningInput,
  type RunScreeningOutput,
} from './validation/runScreening';
export {
  createRunFullValidationSkill,
  type RunFullValidationInput,
  type RunFullValidationOutput,
} from './validation/runFullValidation';
export {
  createReadRecentNotesSkill,
  type ReadRecentNotesInput,
  type ReadRecentNotesOutput,
} from './notes/readRecentNotes';
export {
  createRecordLessonSkill,
  type RecordLessonInput,
  type RecordLessonOutput,
} from './notes/recordLesson';
export {
  createComputeLensFeaturesSkill,
  type ComputeLensFeaturesInput,
  type ComputeLensFeaturesOutput,
} from './lens/computeLensFeatures';

import { SkillRegistry } from './registry';
import { createQueryEdgeLedgerSkill } from './ledger/queryEdgeLedger';
import { createGetHypothesisSkill } from './ledger/getHypothesis';
import { createRegisterHypothesisSkill } from './ledger/registerHypothesis';
import { createRunScreeningSkill } from './validation/runScreening';
import { createRunFullValidationSkill } from './validation/runFullValidation';
import { createReadRecentNotesSkill } from './notes/readRecentNotes';
import { createRecordLessonSkill } from './notes/recordLesson';
import { createComputeLensFeaturesSkill } from './lens/computeLensFeatures';
import { registerEodhdResearchSkills } from './research/eodhdResearchSkills';

export * from './research/eodhdResearchSkills';

/**
 * 全スキルを登録済み Registry を返す。
 *
 * 内訳: コア 8 スキル + EODHD read-only リサーチ 6 スキル (P3)。
 * EODHD 6 種はすべて read-only で、将来 FundamentalsResearcher が有界 tool-use ループで
 * 使う「read-only ツールのみ」を構成する (発注/書込系は認知層に絶対渡さない)。
 *
 * 依存オブジェクトは内部でデフォルト値(シングルトン)を使う。
 * テストや特殊用途で依存を差し替えたい場合は、個別 factory を直接使って
 * `new SkillRegistry()` に register() してください。
 */
export function buildDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  // 個別 register で 1 件ずつ登録することで、各スキルの具体型 (TInput / TOutput) を
  // ジェネリック推論で個別にキャプチャできる。
  registry.register(createQueryEdgeLedgerSkill());
  registry.register(createGetHypothesisSkill());
  registry.register(createRegisterHypothesisSkill());
  registry.register(createRunScreeningSkill());
  registry.register(createRunFullValidationSkill());
  registry.register(createReadRecentNotesSkill());
  registry.register(createRecordLessonSkill());
  registry.register(createComputeLensFeaturesSkill());
  // P3: EODHD read-only リサーチスキル 6 種 (news/sentiment/economic_events/macro/earnings/fundamentals)
  registerEodhdResearchSkills(registry);
  return registry;
}
