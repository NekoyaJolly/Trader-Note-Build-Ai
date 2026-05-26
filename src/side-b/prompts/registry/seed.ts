/**
 * Phase 6: プロンプト初期投入(seed)ユーティリティ
 *
 * 既存の src/side-b/prompts/*.md / prompts/specialists/*.md ファイルを
 * PromptRegistry に active プロンプトとして登録する。
 *
 * 冪等性: 同一 (agentName, version) の組み合わせは既に存在する場合はスキップする。
 * 再実行しても複数 active が増殖しない設計。
 *
 * 実行方法:
 *   npx ts-node src/side-b/prompts/registry/seed.ts
 * もしくは サーバー起動時に一度だけ呼び出す。
 */
import fs from 'fs';
import path from 'path';
import {
  PromptRegistry,
  GLOBAL_AGENT_NAME,
  SPECIALIST_COMMON_AGENT_NAME,
} from './PromptRegistry';

/**
 * seed 対象となるエージェント名と対応するプロンプトファイル。
 * agentName は src/side-b/prompts/*.md のベース名と一致させる。
 */
export interface SeedEntry {
  agentName: string;
  /** PROMPTS_DIR からの相対パス(拡張子 .md 込み) */
  file: string;
  /** 初期バージョン識別子。既定 'initial' */
  version?: string;
  /** notes に入れる説明 */
  notes?: string;
}

/** Phase 6 着手時点で seed 対象となるエージェントの既定リスト。 */
export const DEFAULT_SEED_ENTRIES: SeedEntry[] = [
  // Phase 6.7a: グローバルルール(全エージェント共通の前段プロンプト)
  //   - agentName は GLOBAL_AGENT_NAME 固定
  //   - PromptMutation / MetaEvolution の対象外(安全装置あり)
  //   - 更新は人間承認フロー経由のみ
  { agentName: GLOBAL_AGENT_NAME, file: `${GLOBAL_AGENT_NAME}.md`, notes: 'Phase 6.7a Global Rules' },
  {
    agentName: SPECIALIST_COMMON_AGENT_NAME,
    file: `${SPECIALIST_COMMON_AGENT_NAME}.md`,
    notes: 'Phase 6.7c Specialist Common Rules',
  },
  { agentName: 'strategist', file: 'strategist.md', notes: 'Phase 4c StrategistAgent' },
  { agentName: 'devils_advocate', file: 'devils_advocate.md', notes: 'Phase 2 DevilsAdvocate' },
  { agentName: 'discovery', file: 'discovery.md', notes: 'Phase 4a DiscoveryAgent' },
  { agentName: 'hypothesis_generator', file: 'hypothesis_generator.md', notes: 'Phase 4a HypothesisGenerator' },
  { agentName: 'strategy_thinker', file: 'strategy_thinker.md', notes: 'Phase 2 StrategyThinker(planAIService)' },
  { agentName: 'mutation', file: 'mutation.md', notes: 'Phase 5A MutationAgent' },
  { agentName: 'crossover', file: 'crossover.md', notes: 'Phase 5A CrossoverAgent' },
  {
    agentName: 'indicator_specialist',
    file: 'specialists/indicator_specialist.md',
    notes: 'Phase 6.8 IndicatorSpecialist (= 旧 trend/oscillator/volatility_volume 統合)',
  },
  {
    agentName: 'prompt_mutation',
    file: 'prompt_mutation.md',
    notes: 'Phase 6 PromptMutationAgent',
  },
  {
    agentName: 'meta_evolution',
    file: 'meta_evolution.md',
    notes: 'Phase 6 MetaEvolutionAgent',
  },
  // Phase 6.7a: BullBearDebateAgent を seed 対象に追加
  {
    agentName: 'bull_bear_debate',
    file: 'bull_bear_debate.md',
    notes: 'Phase 6.7a BullBearDebateAgent (PR#55 で追加)',
  },
  // Phase D-1b: GenerationReflectionAgent (PR #145 で追加)。
  // seed リスト漏れにより本番で「Registry 合成失敗 → ファイル fallback」が頻発していた問題を解消。
  {
    agentName: 'generation_reflection',
    file: 'generation_reflection.md',
    notes: 'Phase D-1b GenerationReflectionAgent (PR #145)',
  },
  // P2 (PR #241): Phase 5.5 経路 (reflectionAIService / researchAIService) を
  // Registry 配下に統合。これにより両 service もプロンプト進化 / PromptMutation
  // の対象になり、global ルール (`__global__`) も自動で前置される。
  {
    agentName: 'reflection',
    file: 'reflection.md',
    notes: 'Phase 5.5 reflectionAIService (PDCALoop REFLECTING ハンドラから呼出)',
  },
  {
    agentName: 'research',
    file: 'research.md',
    notes: 'Phase 5.5 researchAIService (= MarketAnalyst、aiOrchestrator 多段の段1)',
  },
  // Phase B+ (2026-05-24): Top-Level Orchestrator
  // Cron 起動時に「次にどのループを回すか」だけを LLM 判断する薄い最上位層。
  // 旧 AgentLoop の轍 (= 1 LLM で PDCA 全部 → 機能せず PR #231 撤去) を踏まないため、
  // 責務を action 選択のみに限定し、実行は既存 Job に委ねる。
  {
    agentName: 'top_level_orchestrator',
    file: 'top_level_orchestrator.md',
    notes: 'Phase B+ TopLevelOrchestrator (= 薄い最上位判断層、Cron 起動経路に挿入)',
  },
];

export interface SeedResult {
  inserted: number;
  skipped: number;
  missingFiles: string[];
  insertedAgents: string[];
}

/**
 * 指定した seed エントリーを PromptRegistry に一括登録する。
 *
 * - ファイルが存在しない agentName は `missingFiles` に記録して継続
 * - 既に当該 (agentName) に active が存在する場合はスキップ
 * - 登録は `status: 'active'`, `createdBy: 'human'` で行う
 */
export async function seedInitialPrompts(
  entries: SeedEntry[] = DEFAULT_SEED_ENTRIES,
  registry: PromptRegistry = new PromptRegistry(),
  promptsDir: string = path.resolve(__dirname, '..'),
): Promise<SeedResult> {
  const result: SeedResult = {
    inserted: 0,
    skipped: 0,
    missingFiles: [],
    insertedAgents: [],
  };

  for (const entry of entries) {
    const filePath = path.join(promptsDir, entry.file);
    if (!fs.existsSync(filePath)) {
      result.missingFiles.push(filePath);
      continue;
    }
    const existing = await registry.getActive(entry.agentName);
    if (existing) {
      result.skipped++;
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    await registry.register({
      agentName: entry.agentName,
      version: entry.version ?? 'initial',
      content,
      createdBy: 'human',
      status: 'active',
      notes: entry.notes,
    });
    result.inserted++;
    result.insertedAgents.push(entry.agentName);
  }

  return result;
}

async function main(): Promise<void> {
  const r = await seedInitialPrompts();
  console.log(
    `[prompt-seed] inserted=${r.inserted} skipped=${r.skipped} missing=${r.missingFiles.length}`,
  );
  if (r.insertedAgents.length > 0) {
    console.log(`[prompt-seed] inserted agents: ${r.insertedAgents.join(', ')}`);
  }
  if (r.missingFiles.length > 0) {
    console.warn(`[prompt-seed] missing files:\n  - ${r.missingFiles.join('\n  - ')}`);
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('[prompt-seed] failed:', err);
      process.exit(1);
    });
}
