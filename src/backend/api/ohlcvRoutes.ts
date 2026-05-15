/**
 * OHLCV API ルート
 * 
 * エンドポイント:
 * - POST /api/ohlcv/import - CSV からヒストリカルデータをインポート
 * - GET /api/ohlcv/presets - プリセット一覧取得
 * - GET /api/ohlcv/coverage - 指定期間のデータカバレッジチェック
 * - DELETE /api/ohlcv/presets/:id - プリセット削除
 * 
 * @see NOTE.md - ドメイン仕様
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { ohlcvImportService } from '../services/ohlcvImportService';
import { ohlcvRepository } from '../repositories/ohlcvRepository';

// multipart/form-data の body 部分（ファイル以外のフィールド）バリデーション。
// すべて任意フィールド扱い。
const OhlcvImportBodySchema = z.object({
  symbol: z.string().optional(),
  timeframe: z.string().optional(),
  presetName: z.string().optional(),
  description: z.string().optional(),
});

const router = Router();

// ファイルアップロード設定
const uploadDir = path.join(process.cwd(), 'data', 'ohlcv');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // オリジナルのファイル名を保持
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}_${sanitized}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.csv') {
      cb(new Error('CSV ファイルのみアップロード可能です'));
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

/**
 * POST /api/ohlcv/import
 * CSV ファイルからヒストリカルデータをインポート
 * 
 * Request:
 *   - multipart/form-data
 *   - file: CSV ファイル（必須）
 *   - symbol: シンボル（任意、ファイル名から推定）
 *   - timeframe: 時間足（任意、ファイル名から推定）
 *   - presetName: プリセット名（任意）
 *   - description: 説明（任意）
 * 
 * Response:
 *   - 200: { success: true, data: OHLCVImportResult }
 *   - 400: { success: false, error: string }
 */
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  console.log('[OHLCV Import] リクエスト受信');
  console.log('[OHLCV Import] Content-Type:', req.headers['content-type']);
  console.log('[OHLCV Import] File:', req.file ? req.file.originalname : 'なし');
  console.log('[OHLCV Import] Body:', req.body);

  try {
    if (!req.file) {
      console.log('[OHLCV Import] エラー: ファイルがありません');
      res.status(400).json({
        success: false,
        error: 'CSV ファイルが指定されていません',
      });
      return;
    }

    // multipart/form-data の他フィールドを Zod で具体型に narrow
    const bodyParsed = OhlcvImportBodySchema.safeParse(req.body);
    const bodyData = bodyParsed.success ? bodyParsed.data : {};
    const options = {
      symbol: bodyData.symbol,
      timeframe: bodyData.timeframe,
      presetName: bodyData.presetName,
      description: bodyData.description,
      source: 'csv',
    };

    const result = await ohlcvImportService.importFromCSV(req.file.path, options);

    // インポート後、一時ファイルを削除（オプション）
    // fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      data: {
        ...result,
        startDate: result.startDate?.toISOString() || null,
        endDate: result.endDate?.toISOString() || null,
      },
    });
  } catch (error) {
    console.error('[OHLCV Import Error]', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'インポートに失敗しました',
    });
  }
});

/**
 * GET /api/ohlcv/presets
 * プリセット一覧を取得
 * 
 * Response:
 *   - 200: { success: true, data: DataPreset[] }
 */
router.get('/presets', async (req: Request, res: Response) => {
  try {
    const presets = await ohlcvImportService.listPresets();

    res.json({
      success: true,
      data: presets.map(p => ({
        ...p,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate.toISOString(),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[OHLCV Presets Error]', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'プリセット一覧の取得に失敗しました',
    });
  }
});

/**
 * GET /api/ohlcv/coverage
 * 指定期間のデータカバレッジをチェック
 * 
 * Query Parameters:
 *   - symbol: シンボル（必須）
 *   - timeframe: 時間足（必須）
 *   - startDate: 開始日時 ISO 8601（必須）
 *   - endDate: 終了日時 ISO 8601（必須）
 * 
 * Response:
 *   - 200: { success: true, data: CoverageResult }
 */
router.get('/coverage', async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe, startDate, endDate } = req.query;

    if (!symbol || !timeframe || !startDate || !endDate) {
      res.status(400).json({
        success: false,
        error: '必須パラメータが不足しています: symbol, timeframe, startDate, endDate',
      });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({
        success: false,
        error: '無効な日時フォーマットです。ISO 8601 形式で指定してください',
      });
      return;
    }

    const coverage = await ohlcvImportService.checkCoverage({
      symbol: symbol as string,
      timeframe: timeframe as string,
      startDate: start,
      endDate: end,
    });

    res.json({
      success: true,
      data: {
        ...coverage,
        missingStart: coverage.missingStart?.toISOString() || null,
        missingEnd: coverage.missingEnd?.toISOString() || null,
      },
    });
  } catch (error) {
    console.error('[OHLCV Coverage Error]', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'カバレッジチェックに失敗しました',
    });
  }
});

/**
 * DELETE /api/ohlcv/presets/:id
 * プリセットを削除（関連 OHLCV データも削除）
 * 
 * Response:
 *   - 200: { success: true, data: { deletedOhlcvCount: number } }
 *   - 404: { success: false, error: string }
 */
router.delete('/presets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await ohlcvImportService.deletePreset(id);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[OHLCV Delete Preset Error]', error);
    const statusCode = error instanceof Error && error.message.includes('見つかりません') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'プリセット削除に失敗しました',
    });
  }
});

/**
 * GET /api/ohlcv/candles
 * DB に保存された OHLCV キャンドルデータを取得
 * 
 * Query Parameters:
 *   - symbol: シンボル（必須）
 *   - timeframe: 時間足（必須）
 *   - limit: 取得件数（任意、デフォルト: 200）
 * 
 * Response:
 *   - 200: { success: true, data: OHLCVCandle[] }
 */
router.get('/candles', async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe, limit, startDate, endDate } = req.query;

    if (!symbol || !timeframe) {
      res.status(400).json({
        success: false,
        error: '必須パラメータが不足しています: symbol, timeframe',
      });
      return;
    }

    // 期間指定がある場合は limit を緩和（バックテストチャート用）
    const hasDateRange = startDate && endDate;
    const maxRecords = hasDateRange
      ? Math.min(parseInt(limit as string) || 10000, 10000)
      : Math.min(parseInt(limit as string) || 200, 1000);

    const filter: Parameters<typeof ohlcvRepository.findMany>[0] = {
      symbol: symbol as string,
      timeframe: timeframe as string,
      limit: maxRecords,
      orderBy: hasDateRange ? 'asc' : 'desc',
    };

    // 期間フィルター
    if (startDate) {
      const start = new Date(startDate as string);
      if (!isNaN(start.getTime())) {
        filter.startTime = start;
      }
    }
    if (endDate) {
      const end = new Date(endDate as string);
      if (!isNaN(end.getTime())) {
        filter.endTime = end;
      }
    }

    const candles = await ohlcvRepository.findMany(filter);

    // 時系列順（古い→新しい）に並び替え（descで取得した場合のみ）
    if (!hasDateRange) {
      candles.reverse();
    }

    res.json({
      success: true,
      data: candles.map(c => ({
        timestamp: c.timestamp.toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      })),
      meta: {
        symbol,
        timeframe,
        count: candles.length,
      },
    });
  } catch (error) {
    console.error('[OHLCV Candles Error]', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'キャンドルデータの取得に失敗しました',
    });
  }
});

export default router;
