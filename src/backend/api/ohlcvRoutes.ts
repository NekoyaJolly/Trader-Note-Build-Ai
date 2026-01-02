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

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ohlcvImportService } from '../services/ohlcvImportService';

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

    const options = {
      symbol: req.body.symbol as string | undefined,
      timeframe: req.body.timeframe as string | undefined,
      presetName: req.body.presetName as string | undefined,
      description: req.body.description as string | undefined,
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

export default router;
