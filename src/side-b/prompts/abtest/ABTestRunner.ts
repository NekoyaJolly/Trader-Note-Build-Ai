/**
 * Phase 6: ABTestRunner
 *
 * 同一入力を複数のプロンプトバリアントで並行実行し、結果を比較する。
 *
 * 使い方:
 *   const runner = new ABTestRunner(executor, scoreFn, registry);
 *   const result = await runner.runTest(agentName, input, [variantId1, variantId2]);
 *
 * 設計:
 * - 並行実行は Promise.allSettled、1 バリアントの失敗が他を止めない
 * - 勝者判定は単純: 最高スコア > 2位スコア * WINNER_MARGIN なら勝者、それ以外 undefined
 * - 結果は DB(PromptAbTestResult)に自動記録(persist=false で無効化可)
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import type {
  AbTestResult,
  AbVariantResult,
  ScoringFunction,
  VariantExecutor,
} from './types';
import { PromptRegistry } from '../registry/PromptRegistry';

/** 勝者判定の閾値: 最高スコアが 2 位スコアの 1.15 倍以上なら勝者。 */
const WINNER_MARGIN = 1.15;

let defaultPrisma: PrismaClient | null = null;
function getDefaultPrisma(): PrismaClient {
  if (!defaultPrisma) {
    defaultPrisma = new PrismaClient();
  }
  return defaultPrisma;
}

export interface ABTestRunnerOptions {
  registry?: PromptRegistry;
  prisma?: PrismaClient;
  /** DB への結果永続化を行うか(既定 true)。テストで false にできる。 */
  persist?: boolean;
}

export class ABTestRunner<TInput = unknown, TOutput = unknown> {
  private readonly registry: PromptRegistry;
  private readonly prisma: PrismaClient;
  private readonly persist: boolean;

  constructor(
    private readonly executor: VariantExecutor<TInput, TOutput>,
    private readonly scoreFn: ScoringFunction<TInput, TOutput>,
    options: ABTestRunnerOptions = {},
  ) {
    this.registry = options.registry ?? new PromptRegistry();
    this.prisma = options.prisma ?? getDefaultPrisma();
    this.persist = options.persist ?? true;
  }

  /**
   * 複数バリアントを並行実行し、結果を比較する。
   *
   * @param agentName  対象エージェント名
   * @param input      共通入力(全バリアントに渡す)
   * @param variantIds PromptVersion.id の配列(active + experimental を含む)
   */
  async runTest(
    agentName: string,
    input: TInput,
    variantIds: string[],
  ): Promise<AbTestResult<TOutput>> {
    if (variantIds.length === 0) {
      throw new Error('ABTestRunner.runTest: variantIds must not be empty');
    }

    const variants = await Promise.all(
      variantIds.map((id) => this.registry.getById(id)),
    );
    for (let i = 0; i < variants.length; i++) {
      if (!variants[i]) {
        throw new Error(`ABTestRunner: variant not found: id=${variantIds[i]}`);
      }
      if (variants[i]!.agentName !== agentName) {
        throw new Error(
          `ABTestRunner: variant ${variantIds[i]} belongs to agentName=${variants[i]!.agentName}, expected ${agentName}`,
        );
      }
    }

    const settled = await Promise.allSettled(
      variants.map(async (v) => {
        const start = Date.now();
        try {
          const output = await this.executor(v!.content, input);
          const durationMs = Date.now() - start;
          const score = this.clampScore(this.scoreFn(input, output));
          return {
            promptVersionId: v!.id,
            output,
            score,
            durationMs,
          } satisfies AbVariantResult<TOutput>;
        } catch (err) {
          const durationMs = Date.now() - start;
          return {
            promptVersionId: v!.id,
            output: undefined as unknown as TOutput,
            score: 0,
            durationMs,
            error: err instanceof Error ? err.message : String(err),
          } satisfies AbVariantResult<TOutput>;
        }
      }),
    );

    const variantResults: AbVariantResult<TOutput>[] = settled.map((s) => {
      if (s.status === 'fulfilled') return s.value;
      // Promise.allSettled 配下のラッパー自体は例外を投げない設計だが念のため
      return {
        promptVersionId: '',
        output: undefined as unknown as TOutput,
        score: 0,
        durationMs: 0,
        error: String(s.reason),
      };
    });

    const { winnerVersionId, winnerReason } = determineWinner(variantResults);

    const result: AbTestResult<TOutput> = {
      agentName,
      testedAt: new Date(),
      variants: variantResults,
      winnerVersionId,
      winnerReason,
    };

    if (this.persist) {
      await this.recordResult(agentName, result, input);
    }

    return result;
  }

  private clampScore(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  private async recordResult(
    agentName: string,
    result: AbTestResult<TOutput>,
    input: TInput,
  ): Promise<void> {
    const digest = crypto
      .createHash('sha256')
      .update(safeStringify(input))
      .digest('hex')
      .slice(0, 32);
    await this.prisma.promptAbTestResult.create({
      data: {
        agentName,
        variantIds: result.variants.map((v) => v.promptVersionId),
        variantResults: result.variants.map((v) => ({
          promptVersionId: v.promptVersionId,
          score: v.score,
          durationMs: v.durationMs,
          error: v.error,
          outputDigest: crypto
            .createHash('sha256')
            .update(safeStringify(v.output))
            .digest('hex')
            .slice(0, 32),
        })),
        winnerVersionId: result.winnerVersionId,
        inputDigest: digest,
      },
    });
  }
}

/**
 * 勝者判定: 最高スコア > 2 位スコア * WINNER_MARGIN なら勝者。
 * スコアが 0 の場合は勝者なし。バリアント 1 つしかない場合も勝者なし。
 */
function determineWinner<TOutput>(
  variants: AbVariantResult<TOutput>[],
): { winnerVersionId?: string; winnerReason?: string } {
  if (variants.length < 2) {
    return { winnerReason: 'バリアントが1件以下のため判定不能' };
  }
  const sorted = [...variants].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const runnerUp = sorted[1];
  if (!top || !runnerUp) {
    return { winnerReason: '結果不足' };
  }
  if (top.score <= 0) {
    return { winnerReason: '全バリアントのスコアが 0 以下' };
  }
  if (runnerUp.score <= 0) {
    return {
      winnerVersionId: top.promptVersionId,
      winnerReason: `次点スコアが 0 以下 (top=${top.score.toFixed(3)})`,
    };
  }
  const ratio = top.score / runnerUp.score;
  if (ratio >= WINNER_MARGIN) {
    return {
      winnerVersionId: top.promptVersionId,
      winnerReason: `top/runnerUp ratio=${ratio.toFixed(3)} >= ${WINNER_MARGIN}`,
    };
  }
  return {
    winnerReason: `有意差なし (top=${top.score.toFixed(3)} runnerUp=${runnerUp.score.toFixed(3)} ratio=${ratio.toFixed(3)})`,
  };
}

function safeStringify(v: unknown): string {
  if (v === undefined) return 'undefined';
  try {
    const s = JSON.stringify(v);
    return s ?? String(v);
  } catch {
    return String(v);
  }
}
