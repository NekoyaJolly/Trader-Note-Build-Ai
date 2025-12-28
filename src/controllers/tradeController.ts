import { Request, Response } from 'express';
import { TradeImportService } from '../services/tradeImportService';
import path from 'path';
import { config } from '../config';
import fs from 'fs';
import { TradeRepository } from '../backend/repositories/tradeRepository';
import { TradeNoteService } from '../services/tradeNoteService';

export class TradeController {
  private importService: TradeImportService;
  private tradeRepository: TradeRepository;
  private noteService: TradeNoteService;

  constructor() {
    this.importService = new TradeImportService();
    this.tradeRepository = new TradeRepository();
    this.noteService = new TradeNoteService();
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
        tradesSkipped: result.skipped,
        importErrors: result.errors,
        insertedIds: result.insertedIds,
        // Phase1 ではノート生成を行わないため空で返す
        notesGenerated: 0,
        notes: []
      });
    } catch (error) {
      console.error('Error importing CSV:', error);
      res.status(500).json({ error: 'Failed to import CSV' });
    }
  };

  // クライアントから CSV テキストを受け取り、サーバー側でファイル保存→取り込み→Draft ノート生成までを一気通貫で実行する
  uploadCSVText = async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename, csvText } = req.body as { filename?: string; csvText?: string };

      // 入力検証（技術用語を避けたメッセージはフロント側で実施）
      if (!filename || !csvText) {
        res.status(400).json({ error: 'CSV ファイル名と内容が必要です' });
        return;
      }

      // サーバーの trades ディレクトリに保存（既存ファイルがあれば上書き）
      const savePath = path.join(process.cwd(), config.paths.trades, filename);
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, csvText, 'utf-8');

      // 取り込みを実行
      const result = await this.importService.importFromCSV(savePath);

      // 取り込んだトレードから Draft ノートを作成（DB 未設定でも parsedTrades を用いて生成可能）
      let trades = [] as Awaited<ReturnType<typeof this.tradeRepository.findByIds>>;
      try {
        trades = await this.tradeRepository.findByIds(result.insertedIds);
      } catch {
        // DB 未接続時は parsedTrades を使ってノート生成を継続
        trades = result.parsedTrades as any;
      }
      const generatedNoteIds: string[] = [];
      for (const t of trades) {
        try {
          const note = await this.noteService.generateNote({
            id: t.id as any,
            timestamp: (t as any).timestamp as Date,
            symbol: (t as any).symbol,
            side: (t as any).side,
            price: Number((t as any).price),
            quantity: Number((t as any).quantity),
          }, {
            timeframe: '15m',
            trend: 'neutral',
            indicators: { rsi: 50, macd: 0, volume: 0 }
          });
          await this.noteService.saveNote(note);
          generatedNoteIds.push(note.id);
        } catch (noteError) {
          console.error('Error generating note for trade:', (noteError as Error).message);
          result.errors.push(`ノート生成失敗: ${(noteError as Error).message}`);
        }
      }

      res.json({
        success: true,
        tradesImported: result.tradesImported,
        tradesSkipped: result.skipped,
        importErrors: result.errors,
        insertedIds: result.insertedIds,
        notesGenerated: generatedNoteIds.length,
        noteIds: generatedNoteIds,
      });
    } catch (error) {
      console.error('Error uploading CSV text:', error);
      const errorMsg = (error as Error).message || 'CSV の取り込みに失敗しました';
      res.status(500).json({ error: errorMsg });
    }
  };

  /**
   * Get all trade notes
   */
  getAllNotes = async (req: Request, res: Response): Promise<void> => {
    // ファイルストレージ上のノートを全件返却する
    const notes = await this.noteService.loadAllNotes();
    res.json({ notes });
  };

  /**
   * Get a specific note by ID
   */
  getNoteById = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    const note = await this.noteService.getNoteById(noteId);
    if (!note) {
      res.status(404).json({ error: 'ノートが見つかりませんでした' });
      return;
    }
    res.json(note);
  };

  // ノート承認（簡易実装）：JSON ファイルに承認フラグと時刻を書き込む
  approveNote = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    const notesDir = path.join(process.cwd(), config.paths.notes);
    const filepath = path.join(notesDir, `${noteId}.json`);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: 'ノートが見つかりませんでした' });
      return;
    }
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);
      data.status = 'approved';
      data.approvedAt = new Date().toISOString();
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
      res.json({ success: true, status: 'approved' });
    } catch (e) {
      console.error('Error approving note:', e);
      res.status(500).json({ error: 'ノートの承認に失敗しました' });
    }
  };
}
