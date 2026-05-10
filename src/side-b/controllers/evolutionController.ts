import { Request, Response } from 'express';
import { prisma } from '../../backend/db/client';
import { generationLessonRepository } from '../../backend/repositories/generationLessonRepository';
import { evolutionBacktestRunRepository } from '../../backend/repositories/evolutionBacktestRunRepository';

export const evolutionController = {
  /**
   * GET /api/side-b/evolution/lessons
   * 世代単位の振り返り（GenerationLesson）の一覧を取得する
   */
  async getLessons(req: Request, res: Response) {
    try {
      const { regime, limit } = req.query as { regime?: string; limit?: string };
      const parsedLimit = limit ? parseInt(limit, 10) : 20;

      let lessons;
      if (regime) {
        lessons = await generationLessonRepository.findRecentByRegime(regime, parsedLimit);
      } else {
        lessons = await generationLessonRepository.findRecent(parsedLimit);
      }

      res.json({ success: true, lessons });
    } catch (error) {
      console.error('[EvolutionController] getLessons error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch generation lessons' });
    }
  },

  /**
   * GET /api/side-b/evolution/runs
   * 進化ループ (EvolutionRun) の一覧を取得する
   */
  async getRuns(req: Request, res: Response) {
    try {
      const { limit } = req.query as { limit?: string };
      const parsedLimit = limit ? parseInt(limit, 10) : 10;

      // EvolutionBacktestRun から distinct な evolutionRunId を最新順で取得する
      const runs = await prisma.evolutionBacktestRun.findMany({
        distinct: ['evolutionRunId'],
        orderBy: { createdAt: 'desc' },
        select: {
          evolutionRunId: true,
          createdAt: true,
        },
        take: parsedLimit,
      });

      res.json({ success: true, runs });
    } catch (error) {
      console.error('[EvolutionController] getRuns error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch evolution runs' });
    }
  },

  /**
   * GET /api/side-b/evolution/runs/:runId/summary
   * 特定の進化ループのサマリー（世代ごとのPF, 通過率など）を取得する
   */
  async getRunSummary(req: Request, res: Response) {
    try {
      const { runId } = req.params;
      const summary = await evolutionBacktestRunRepository.summarizeByEvolutionRun(runId);
      res.json({ success: true, summary });
    } catch (error) {
      console.error('[EvolutionController] getRunSummary error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch evolution run summary' });
    }
  },

  /**
   * GET /api/side-b/evolution/runs/:runId/candidates
   * 特定の進化ループで評価された候補一覧を取得する
   */
  async getRunCandidates(req: Request, res: Response) {
    try {
      const { runId } = req.params;
      const { limit } = req.query as { limit?: string };
      const parsedLimit = limit ? parseInt(limit, 10) : 100;

      const candidates = await evolutionBacktestRunRepository.findByEvolutionRun(runId, parsedLimit);
      
      // フロント向けに JSON データをそのまま返す
      res.json({ success: true, candidates });
    } catch (error) {
      console.error('[EvolutionController] getRunCandidates error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch evolution run candidates' });
    }
  }
};
