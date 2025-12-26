import { Request, Response } from 'express';
import { TradeImportService } from '../services/tradeImportService';
import path from 'path';
import { config } from '../config';

export class TradeController {
  private importService: TradeImportService;

  constructor() {
    this.importService = new TradeImportService();
  }

  // CSV からトレードを取り込み、DB に保存する（Phase1 ではノート生成しない）
  importCSV = async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename } = req.body;
      
      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }

      const filepath = path.join(process.cwd(), config.paths.trades, filename);
      const result = await this.importService.importFromCSV(filepath);

      res.json({
        success: true,
        tradesImported: result.tradesImported,
        // Phase1 ではノート生成を行わないため空で返す
        notesGenerated: 0,
        notes: []
      });
    } catch (error) {
      console.error('Error importing CSV:', error);
      res.status(500).json({ error: 'Failed to import CSV' });
    }
  };

  /**
   * Get all trade notes
   */
  getAllNotes = async (req: Request, res: Response): Promise<void> => {
    // Phase1 スコープ外（ノート生成未対応）。利用者に空配列を返却する。
    res.json({ notes: [] });
  };

  /**
   * Get a specific note by ID
   */
  getNoteById = async (req: Request, res: Response): Promise<void> => {
    // Phase1 スコープ外（ノート生成未対応）。常に 404 を返却する。
    res.status(404).json({ error: 'Note not found (Phase1: not generated yet)' });
  };
}
