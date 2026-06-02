/**
 * Cronエンドポイント
 *
 * 目的: 外部Cronサービスから呼び出される自動実行エンドポイント
 *
 * エンドポイント:
 * - GET /api/cron/side-b/daily-plan - 日次プラン生成（毎朝）
 * - GET /api/cron/side-b/monitor - 監視実行（毎時）
 * - GET /api/cron/side-b/run-screening - 仮説スクリーニング手動実行（PDCA-2 検証用）
 * - GET /api/cron/side-b/run-full-validation - フル検証手動実行（screening_passed → confirmed/rejected）
 * - POST /api/cron/side-b/run-evolution - 進化ループ手動実行（Phase 4 手動トリガー）
 * - POST /api/cron/side-b/reset-not-testable - not_testable 仮説を unverified に戻す救済操作
 * - GET /api/cron/matching-pipeline - マッチング＋通知パイプライン（15分間隔）
 * - GET /api/cron/health - ヘルスチェック
 *
 * 認証: CRON_SECRET による Bearer 認証
 *
 * @see src/middleware/cronAuth.ts
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { cronAuth } from '../../middleware/cronAuth';
import { getSideBScheduler } from '../../side-b/jobs/sideBScheduler';
import { isFXMarketOpen, getMarketStatusJST } from '../../side-b/utils/marketHours';
import { MatchingService } from '../../services/matchingService';
import { edgeLedger } from '../../side-b/ledger';
import { validateBody, validateQuery, getValidatedQuery } from '../../middleware/validateRequest';
import {
  ResetNotTestableBodySchema,
  RunScreeningQuerySchema,
  type ResetNotTestableBody,
  type RunScreeningQuery,
} from '../../schemas/api/sideB';

const router = Router();

// 全Cronエンドポイントに認証を適用
router.use(cronAuth);

/**
 * GET /api/cron/health
 * Cronヘルスチェック
 */
router.get('/health', (_req: Request, res: Response) => {
  const marketStatus = getMarketStatusJST();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    market: {
      isOpen: marketStatus.isOpen,
      message: marketStatus.message,
    },
  });
});

/**
 * GET /api/cron/side-b/daily-plan
 * 日次プラン生成（Research → Plan → Trade）
 * 
 * 推奨実行時刻: 毎日 00:00 UTC（09:00 JST）
 * 
 * 動作:
 * 1. 市場開場チェック（休場時はスキップ）
 * 2. 各シンボルのOHLCVデータ取得
 * 3. Research AI → Plan AI → VirtualTrade作成
 */
router.get('/side-b/daily-plan', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[Cron] 日次プラン生成を開始します');

    const scheduler = getSideBScheduler();
    const orchestratorEnabled = process.env.TOP_LEVEL_ORCHESTRATOR_ENABLED === 'true';

    // 市場開場チェック (PR #248 Copilot review #7 対応):
    // Orchestrator 経路では action が screening / evolution / wait の場合は市場開場と無関係に
    // 進められるため、ここでの早期 return は **しない** (= Orchestrator 側 / 各 Job 内部で
    // 必要に応じて market gate を適用)。
    // 旧 (= Orchestrator OFF) 経路は従来通り `runDailyPlanNow` だけ呼ばれるため、
    // ここで早期 return する (= planGenerationJob は市場開場必須)。
    if (!orchestratorEnabled && !isFXMarketOpen()) {
      const marketStatus = getMarketStatusJST();
      console.log('[Cron] 市場休場のためスキップ:', marketStatus.message);
      res.json({
        success: true,
        skipped: true,
        reason: '市場休場',
        market: marketStatus.message,
        duration: Date.now() - startTime,
      });
      return;
    }

    // Phase B+ (2026-05-24): TOP_LEVEL_ORCHESTRATOR_ENABLED=true なら、
    // Top-Level Orchestrator が「次にどのループを回すか」を LLM 判断し、判断結果に応じて
    // 既存 Job (planGeneration / screening / fullValidation / evolution) を委ねて呼ぶ。
    // env false (default) は従来通り runDailyPlanNow を直接呼ぶ (= 既存挙動互換)。
    // 設計書: docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md
    if (orchestratorEnabled) {
      console.log('[Cron] TopLevelOrchestrator 経由でサイクル実行');
      const orchResult = await scheduler.runOrchestratedCycle('cron', {
        correlationId: req.correlationId,
      });
      res.json({
        success: true,
        message: orchResult.output
          ? `Orchestrator action=${orchResult.output.action} (${orchResult.executedJobs.length} jobs)`
          : `Orchestrator strictBlocked: ${orchResult.strictBlockedReason ?? 'unknown'}`,
        data: {
          runId: orchResult.runId,
          correlationId: orchResult.correlationId,
          action: orchResult.output?.action ?? null,
          reasoning: orchResult.output?.reasoning ?? null,
          executedJobs: orchResult.executedJobs,
          strictBlockedReason: orchResult.strictBlockedReason ?? null,
        },
        duration: Date.now() - startTime,
      });
      return;
    }

    // スケジューラーから日次プランを実行 (既存経路)
    const result = await scheduler.runDailyPlanNow();

    console.log('[Cron] 日次プラン生成完了:', result.message);

    // 2026-05-26: `0/0 シンボル成功` 事象の原因切り分け用 diagnostics。
    // 本番で fallback (PR #257) が効いているかどうか、scheduler の symbols 設定状態を
    // response に出して即時で判別可能にする。根本原因が特定されたら削除予定。
    const status = scheduler.getStatus();
    const diagnostics = {
      symbols: status.config.symbols,
      symbolsLength: status.config.symbols?.length ?? 0,
      lastDailyPlanRun: status.lastDailyPlanRun ?? null,
      isRunning: status.isRunning,
    };

    res.json({
      success: result.success,
      message: result.message,
      data: result.data,
      diagnostics,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] 日次プラン生成エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * GET /api/cron/side-b/monitor
 * 監視実行（エントリー/決済判定）
 * 
 * 推奨実行間隔: 毎時（0分）
 * 
 * 動作:
 * 1. 市場開場チェック（休場時はスキップ）
 * 2. 1分足60本を取得
 * 3. 高安値ベースでエントリー/決済判定
 * 4. 決済時はAIノート自動生成
 */
router.get('/side-b/monitor', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[Cron] 監視実行を開始します');

    // 市場開場チェック
    if (!isFXMarketOpen()) {
      const marketStatus = getMarketStatusJST();
      console.log('[Cron] 市場休場のためスキップ:', marketStatus.message);
      res.json({
        success: true,
        skipped: true,
        reason: '市場休場',
        market: marketStatus.message,
        duration: Date.now() - startTime,
      });
      return;
    }

    // スケジューラーから監視を実行
    const scheduler = getSideBScheduler();
    const result = await scheduler.runMonitorNow();

    console.log('[Cron] 監視実行完了:', result.message);

    res.json({
      success: result.success,
      message: result.message,
      data: result.data,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] 監視実行エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * GET /api/cron/side-b/run-screening
 * 仮説スクリーニング手動実行(PDCA-2 検証用)
 *
 * 動作:
 *   - unverified 仮説を最大 `max` 件取り出して ScreeningOrchestrator.runScreening を回す
 *   - 市場開場チェックなし(screening は過去 OHLCV を舐める処理でオフライン実行可)
 *
 * Query parameters (Critical-4 段階 1.6):
 *   - start  YYYY-MM-DD 形式の BT 期間開始日 (省略時は env SCREENING_PERIOD_DAYS デフォルト)
 *   - end    YYYY-MM-DD 形式の BT 期間終了日 (省略時は今日)
 *   - max    1 回の実行で処理する上限件数 (省略時は config.screeningMaxPerRun)
 *
 * 用途:
 *   - 自動 cron 走行時はパラメータなしで env / config 既定値で実行
 *   - 手動再 screening: 過去の rejected を新閾値で評価したい場合に start/end を指定
 *   - not_testable に倒れた仮説の再検証
 */
router.get(
  '/side-b/run-screening',
  validateQuery(RunScreeningQuerySchema),
  async (_req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const query = getValidatedQuery<RunScreeningQuery>(res);
      const period =
        query.start && query.end ? { start: query.start, end: query.end } : undefined;
      const limit = query.max;

      console.log(
        `[Cron] スクリーニング手動実行を開始します` +
          (period ? ` period=${period.start}〜${period.end}` : '') +
          (limit ? ` max=${limit}` : ''),
      );
      const scheduler = getSideBScheduler();
      const summary = await scheduler.runScreeningNow({
        ...(period ? { period } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      console.log('[Cron] スクリーニング手動実行完了:', summary);
      res.json({
        success: summary.errors === 0,
        message: `processed=${summary.processed} passed=${summary.passed} rejected=${summary.rejected} not_testable=${summary.notTestable} errors=${summary.errors}`,
        data: summary,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      console.error('[Cron] スクリーニング手動実行エラー:', message);
      res.status(500).json({
        success: false,
        error: message,
        duration: Date.now() - startTime,
      });
    }
  },
);

/**
 * GET /api/cron/side-b/run-full-validation
 * フル検証手動実行（screening_passed → confirmed/rejected）
 *
 * 動作:
 *   - screening_passed 仮説を最大 fullValidationMaxPerRun 件取り出して
 *     StrategistAgent.validate を回す
 *   - Python + LLM 起動を伴うため、各仮説間に 10 秒のクールダウンあり
 */
router.get('/side-b/run-full-validation', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    console.log('[Cron] フル検証手動実行を開始します');
    const scheduler = getSideBScheduler();
    const summary = await scheduler.runFullValidationNow();
    console.log('[Cron] フル検証手動実行完了:', summary);
    res.json({
      success: summary.errors === 0,
      message: `processed=${summary.processed} confirmed=${summary.confirmed} rejected=${summary.rejected} not_testable=${summary.notTestable} errors=${summary.errors}`,
      data: summary,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] フル検証手動実行エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * POST /api/cron/side-b/run-evolution
 * 進化ループ手動実行（進化ループ再設計 Phase 4: 手動トリガー）。
 *
 * 動作:
 *   - SideBScheduler.runEvolutionNow() を呼び、設定 regime ぶんの runOneGeneration /
 *     multi-generation を実行する（mutation / crossover / 正式 BT / 確証ゲート観測）。
 *   - 自動 cron（config.autoEvolution、既定 false = OFF）とは独立に、いつでも明示起動できる。
 *     「自動 cron は任意（OFF も選べる）＋手動実行ボタン」という設計（HTML §2-4）を満たす。
 *
 * POST を要求する理由: LLM × 複数 regime × BT を伴う重い prod-write 操作のため、
 * （reset-not-testable と同様）明示的な POST で誤発火を防ぐ。
 *
 * 認証: cronAuth (CRON_SECRET Bearer)
 */
router.post('/side-b/run-evolution', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    console.log('[Cron] 進化ループ手動実行を開始します');
    const scheduler = getSideBScheduler();
    const result = await scheduler.runEvolutionNow();
    console.log('[Cron] 進化ループ手動実行完了:', result);
    res.json({
      success: result.errors.length === 0,
      message: `regimeReports=${result.regimeReports} errors=${result.errors.length}`,
      data: result,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] 進化ループ手動実行エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * POST /api/cron/side-b/reset-not-testable
 * not_testable 仮説を unverified に戻す救済操作(Critical-1.5 フォローアップ)。
 *
 * 用途:
 *   - Critical-1 / 1.5 デプロイ後、過去のバグで倒れた仮説を再 screening 可能にする
 *   - body の statusNotePrefix を指定すると、該当 statusNote を持つものだけを対象にできる
 *     例: { "statusNotePrefix": "Materialization失敗" }
 *   - 省略時は status='not_testable' の全件をリセット
 *
 * 認証: cronAuth (CRON_SECRET Bearer)
 *
 * これは prod write を伴うため、明示的に POST を要求する。
 */
router.post('/side-b/reset-not-testable', validateBody(ResetNotTestableBodySchema), async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { statusNotePrefix } = req.body as ResetNotTestableBody;

    console.log(
      `[Cron] not_testable リセット開始 (statusNotePrefix=${statusNotePrefix ?? '(全件)'})`,
    );
    const count = await edgeLedger.resetNotTestableToUnverified(
      statusNotePrefix !== undefined ? { statusNotePrefix } : undefined,
    );
    console.log(`[Cron] リセット完了: ${count}件`);
    res.json({
      success: true,
      message: `${count}件を unverified に戻しました`,
      data: { affected: count, statusNotePrefix: statusNotePrefix ?? null },
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] リセット失敗:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * GET /api/cron/matching-pipeline
 * マッチング＋通知パイプライン（Side-A & Side-B 統合）
 *
 * 推奨実行間隔: 15分
 *
 * 動作:
 * 1. 市場開場チェック（休場時はスキップ）
 * 2. Side-A (TradeNote) + Side-B (AITradeNote) の勝ちパターンを現在市場と照合
 * 3. 同時ヒット制御で通知対象を絞り込み
 * 4. NotificationTriggerService で閾値・クールダウン判定
 * 5. アプリ内通知を送信
 */
router.get('/matching-pipeline', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[Cron] マッチングパイプラインを開始します');

    // 市場開場チェック
    if (!isFXMarketOpen()) {
      const marketStatus = getMarketStatusJST();
      console.log('[Cron] 市場休場のためマッチングスキップ:', marketStatus.message);
      res.json({
        success: true,
        skipped: true,
        reason: '市場休場',
        market: marketStatus.message,
        duration: Date.now() - startTime,
      });
      return;
    }

    const matchingService = new MatchingService();
    const result = await matchingService.runMatchingPipeline();

    console.log(
      `[Cron] マッチングパイプライン完了: ` +
      `matches=${result.totalMatches}, notified=${result.notified}, ` +
      `skipped=${result.skipped}, errors=${result.errors.length}`
    );

    res.json({
      success: result.errors.length === 0,
      message: `マッチ${result.totalMatches}件, 通知${result.notified}件, スキップ${result.skipped}件`,
      data: result,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron] マッチングパイプラインエラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * POST /api/cron/matching-pipeline/test
 * マッチングパイプライン手動テスト（市場チェックなし）
 *
 * デバッグ・開発用。市場休場中でも実行可能。
 * bodyにsideBOnlyを渡すとSide-Bのみテスト可能。
 */
/**
 * /matching-pipeline/test 用の入力スキーマ。
 *
 * sideBOnly は任意 boolean フラグ。未指定なら false。
 */
const MatchingPipelineTestBodySchema = z
  .object({
    sideBOnly: z.boolean().optional(),
  })
  .optional();

router.post('/matching-pipeline/test', async (req: Request, res: Response) => {
  const startTime = Date.now();
  // Zod で req.body を具体型に narrow
  const parsed = MatchingPipelineTestBodySchema.safeParse(req.body);
  const sideBOnly: boolean = parsed.success ? parsed.data?.sideBOnly ?? false : false;

  try {
    console.log(`[Cron/Test] マッチングテストを開始 (sideBOnly=${sideBOnly})`);

    const matchingService = new MatchingService();

    if (sideBOnly) {
      // Side-B のみテスト
      const sideBMatches = await matchingService.checkForSideBMatches();
      res.json({
        success: true,
        mode: 'sideBOnly',
        matchCount: sideBMatches.length,
        matches: sideBMatches.map(m => ({
          noteId: m.historicalNoteId,
          symbol: m.symbol,
          score: m.matchScore.toFixed(4),
          reasons: m.reasons,
          evaluatedAt: m.evaluatedAt,
        })),
        duration: Date.now() - startTime,
      });
    } else {
      // 全パイプラインテスト
      const result = await matchingService.runMatchingPipeline();
      res.json({
        success: true,
        mode: 'full',
        data: result,
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('[Cron/Test] マッチングテストエラー:', message);
    res.status(500).json({
      success: false,
      error: message,
      duration: Date.now() - startTime,
    });
  }
});

export default router;
