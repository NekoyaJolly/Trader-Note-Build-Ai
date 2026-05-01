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
import { cronAuth } from '../../middleware/cronAuth';
import { getSideBScheduler } from '../../side-b/jobs/sideBScheduler';
import { isFXMarketOpen, getMarketStatusJST } from '../../side-b/utils/marketHours';
import { MatchingService } from '../../services/matchingService';
import { edgeLedger } from '../../side-b/ledger';
import { validateBody } from '../../middleware/validateRequest';
import { ResetNotTestableBodySchema, type ResetNotTestableBody } from '../../schemas/api/sideB';

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
router.get('/side-b/daily-plan', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[Cron] 日次プラン生成を開始します');

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

    // スケジューラーから日次プランを実行
    const scheduler = getSideBScheduler();
    const result = await scheduler.runDailyPlanNow();

    console.log('[Cron] 日次プラン生成完了:', result.message);

    res.json({
      success: result.success,
      message: result.message,
      data: result.data,
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
 * 仮説スクリーニング手動実行（PDCA-2 検証用 / orchestration_health_report Critical-1 対応）
 *
 * 動作:
 *   - unverified 仮説を最大 screeningMaxPerRun 件取り出して
 *     ScreeningOrchestrator.runScreening を回す
 *   - 市場開場チェックなし（screening は OHLCV 取得経由なのでオフライン実行可）
 *
 * 用途:
 *   - Phase 6.7b デプロイ後の動作確認
 *   - not_testable に倒れた仮説の再検証（仮説ID 指定は Phase 7 以降）
 */
router.get('/side-b/run-screening', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    console.log('[Cron] スクリーニング手動実行を開始します');
    const scheduler = getSideBScheduler();
    const summary = await scheduler.runScreeningNow();
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
});

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
router.post('/matching-pipeline/test', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const sideBOnly = req.body?.sideBOnly ?? false;

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
