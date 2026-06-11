import type { Request, Response } from 'express';
import type { MatchingPipelineRun } from '@prisma/client';
import { getValidatedQuery } from '../../middleware/validateRequest';
import { MatchingService } from '../../services/matchingService';
import { NotificationService } from '../../services/notificationService';
import { TradeNoteService } from '../../services/tradeNoteService';

/**
 * MatchingPipelineRun の API レスポンス DTO（内部 DB 行をそのまま返さない）。
 */
interface PipelineRunDTO {
  runId: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalMatches: number;
  notified: number;
  skipped: number;
  errorCount: number;
  errors: string[];
  skipReasons: MatchingPipelineRun['skipReasons'];
  marketStatus: string | null;
}

/**
 * DB 行を API DTO に整形する。
 */
function toPipelineRunDTO(row: MatchingPipelineRun): PipelineRunDTO {
  return {
    runId: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    durationMs: row.durationMs,
    totalMatches: row.totalMatches,
    notified: row.notified,
    skipped: row.skipped,
    errorCount: row.errorCount,
    errors: row.errors,
    skipReasons: row.skipReasons,
    marketStatus: row.marketStatus,
  };
}

/**
 * マッチングコントローラー
 * 
 * 責務:
 * - 市場条件と過去トレードノートの一致判定 API
 * - マッチ履歴の取得 API（DB から）
 */
export class MatchingController {
  private matchingService: MatchingService;
  private notificationService: NotificationService;
  private noteService: TradeNoteService;

  constructor() {
    this.matchingService = new MatchingService();
    this.notificationService = new NotificationService();
    this.noteService = new TradeNoteService();
  }

  /**
   * 手動でマッチチェックをトリガー
   * POST /api/matching/check
   */
  checkMatches = async (req: Request, res: Response): Promise<void> => {
    try {
      // Phase α-4: 手動チェックは認証ユーザーの所有ノートのみ評価する
      const userId = req.user!.userId;
      const matches = await this.matchingService.checkForMatches(userId);
      await this.notificationService.trigger(matches);

      res.json({
        success: true,
        matchesFound: matches.length,
        matches: await Promise.all(
          matches.map(async (m) => {
            const note = await this.noteService.getNoteById(m.historicalNoteId, userId);
            return {
              id: m.id,
              matchScore: m.matchScore,
              timestamp: m.evaluatedAt,
              symbol: m.symbol,
              threshold: m.threshold,
              trendMatched: m.trendMatched,
              priceRangeMatched: m.priceRangeMatched,
              reasons: m.reasons,
              note: note
                ? {
                    id: note.id,
                    symbol: note.symbol,
                    side: note.side,
                    entryPrice: note.entryPrice,
                  }
                : null,
              marketSnapshot: m.marketSnapshot,
            };
          })
        ),
      });
    } catch (error) {
      console.error('マッチチェックエラー:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '一致判定処理に失敗しました' });
    }
  };

  /**
   * マッチ履歴を取得（DB から）
   * GET /api/matching/history
   * 
   * クエリパラメータ:
   * - symbol?: string - シンボルでフィルタ
   * - limit?: number - 取得件数（デフォルト: 50）
   * - offset?: number - オフセット（ページング用）
   * - minScore?: number - 最小スコアでフィルタ
   */
  getMatchHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, limit, offset, minScore } = getValidatedQuery<{
        symbol?: string;
        limit?: string;
        offset?: string;
        minScore?: string;
      }>(res);

      const matches = await this.matchingService.getMatchHistory({
        symbol: symbol,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
        minScore: minScore ? parseFloat(minScore) : undefined,
        // Phase α-4: 認証ユーザーのマッチ履歴のみ返す
        userId: req.user!.userId,
      });

      res.json({
        success: true,
        count: matches.length,
        matches: matches.map(m => ({
          id: m.id,
          noteId: m.historicalNoteId,
          symbol: m.symbol,
          matchScore: m.matchScore,
          threshold: m.threshold,
          trendMatched: m.trendMatched,
          priceRangeMatched: m.priceRangeMatched,
          reasons: m.reasons,
          evaluatedAt: m.evaluatedAt,
          createdAt: m.createdAt,
          marketSnapshotId: m.marketSnapshotId,
        })),
      });
    } catch (error) {
      console.error('マッチ履歴取得エラー:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: 'マッチ履歴の取得に失敗しました' });
    }
  };

  /**
   * matching pipeline run 一覧を取得（observability）
   * GET /api/matching/pipeline-runs?limit=N
   *
   * 運用者が「いつ動いたか / 何件マッチ・通知・スキップしたか」を最新順で確認する。
   */
  getPipelineRuns = async (req: Request, res: Response): Promise<void> => {
    try {
      // limit は Zod 側で数値化・1〜100 範囲制約・デフォルト 20 まで済み（GetPipelineRunsQuerySchema）
      const { limit } = getValidatedQuery<{ limit: number }>(res);

      const runs = await this.matchingService.getPipelineRuns(limit);

      res.json({
        success: true,
        count: runs.length,
        runs: runs.map(toPipelineRunDTO),
      });
    } catch (error) {
      console.error('pipeline run 一覧取得エラー:', error);
      res.status(500).json({ error: 'パイプライン実行履歴の取得に失敗しました' });
    }
  };

  /**
   * 最新の matching pipeline run を取得（observability）
   * GET /api/matching/pipeline-runs/latest
   *
   * run がまだ無い場合は run: null を返す。
   */
  getLatestPipelineRun = async (_req: Request, res: Response): Promise<void> => {
    try {
      const run = await this.matchingService.getLatestPipelineRun();
      res.json({
        success: true,
        run: run ? toPipelineRunDTO(run) : null,
      });
    } catch (error) {
      console.error('最新 pipeline run 取得エラー:', error);
      res.status(500).json({ error: '最新のパイプライン実行状態の取得に失敗しました' });
    }
  };
}
