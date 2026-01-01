import { Request, Response } from 'express';
import { TradeImportService } from '../services/tradeImportService';
import path from 'path';
import { config } from '../config';
import fs from 'fs';
import { TradeRepository } from '../backend/repositories/tradeRepository';
import { TradeNoteService, NoteUpdatePayload } from '../services/tradeNoteService';
import { NoteStatus } from '../models/types';
import { Trade as DbTrade, Prisma } from '@prisma/client';
import { FeatureService } from '../services/featureService';
import { SIMILARITY_THRESHOLDS } from '../services/featureVectorService';

/**
 * トレードデータの共通型
 * DB 型と ParsedTrade の両方に対応
 */
interface TradeData {
  id: string;
  timestamp: Date | string;
  symbol: string;
  side: string;
  price: number | Prisma.Decimal;
  quantity: number | Prisma.Decimal;
}

export class TradeController {
  private importService: TradeImportService;
  private tradeRepository: TradeRepository;
  private noteService: TradeNoteService;
  private featureService: FeatureService;

  constructor() {
    this.importService = new TradeImportService();
    this.tradeRepository = new TradeRepository();
    this.noteService = new TradeNoteService();
    this.featureService = new FeatureService();
  }

  /**
   * CSV からトレードを取り込み、DB に保存し、ノートを生成する
   * 
   * ワークフロー:
   * 1. CSV ファイルを読み込みトレードデータを DB に保存
   * 2. 保存したトレードごとにトレードノートを生成
   * 3. 結果を返却（tradesImported, notesGenerated を実数で返す）
   */
  importCSV = async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename } = req.body;
      
      if (!filename) {
        res.status(400).json({ error: 'ファイル名が必要です' });
        return;
      }

      // ファイル名のバリデーション（パストラバーサル防止）
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: '不正なファイル名です' });
        return;
      }

      const filepath = path.join(process.cwd(), config.paths.trades, filename);
      
      // CSV ファイルの存在確認
      if (!fs.existsSync(filepath)) {
        res.status(404).json({ error: `CSVファイルが見つかりません: ${filename}` });
        return;
      }

      const result = await this.importService.importFromCSV(filepath);

      // 取り込んだトレードからノートを生成
      const generatedNoteIds: string[] = [];
      const noteErrors: string[] = [];

      // DB から取得、失敗時は parsedTrades を使用
      let trades: TradeData[] = [];
      try {
        if (result.insertedIds.length > 0) {
          trades = await this.tradeRepository.findByIds(result.insertedIds);
        }
      } catch {
        // DB 未接続時は parsedTrades を使ってノート生成を継続
        trades = result.parsedTrades;
      }

      // 各トレードに対してノートを生成
      // ユーザー設定のインジケーターを適用してノートを生成
      for (const t of trades) {
        try {
          // side を 'buy' | 'sell' 型に変換（小文字に正規化）
          const normalizedSide = t.side.toLowerCase() as 'buy' | 'sell';
          
          const note = await this.noteService.generateNoteWithUserIndicators({
            id: t.id,
            timestamp: new Date(t.timestamp),
            symbol: t.symbol,
            side: normalizedSide,
            price: Number(t.price),
            quantity: Number(t.quantity),
          }, '15m');
          await this.noteService.saveNote(note);
          generatedNoteIds.push(note.id);
        } catch (noteError) {
          const errorMsg = `ノート生成失敗 (trade: ${t.id}): ${(noteError as Error).message}`;
          console.error(errorMsg);
          noteErrors.push(errorMsg);
        }
      }

      res.json({
        success: true,
        tradesImported: result.tradesImported,
        tradesSkipped: result.skipped,
        importErrors: [...result.errors, ...noteErrors],
        insertedIds: result.insertedIds,
        notesGenerated: generatedNoteIds.length,
        noteIds: generatedNoteIds,
      });
    } catch (error) {
      console.error('Error importing CSV:', error);
      // エラーメッセージの詳細判定
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('CSV ファイルが見つかりません')) {
        res.status(404).json({ error: errorMessage });
      } else if (errorMessage.includes('ヘッダーが不足') || errorMessage.includes('拡張子')) {
        res.status(400).json({ error: errorMessage });
      } else {
        // 本番環境では内部エラーの詳細を隠蔽
        res.status(500).json({ error: 'CSV の取り込みに失敗しました' });
      }
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
      // ユーザー設定のインジケーターを適用してノートを生成
      type TradeRecord = { id: string; timestamp: Date; symbol: string; side: 'buy' | 'sell'; price: number | { toNumber(): number }; quantity: number | { toNumber(): number } };
      let trades: TradeRecord[] = [];
      try {
        const dbTrades = await this.tradeRepository.findByIds(result.insertedIds);
        trades = dbTrades.map(t => ({
          id: t.id,
          timestamp: t.timestamp,
          symbol: t.symbol,
          side: t.side as 'buy' | 'sell',
          price: t.price,
          quantity: t.quantity,
        }));
      } catch {
        // DB 未接続時は parsedTrades を使ってノート生成を継続
        trades = result.parsedTrades as TradeRecord[];
      }
      const generatedNoteIds: string[] = [];
      for (const t of trades) {
        try {
          // Decimal型（Prisma）の場合はtoNumber()で変換、それ以外はNumber()
          const price = typeof t.price === 'object' && 'toNumber' in t.price ? t.price.toNumber() : Number(t.price);
          const quantity = typeof t.quantity === 'object' && 'toNumber' in t.quantity ? t.quantity.toNumber() : Number(t.quantity);
          const note = await this.noteService.generateNoteWithUserIndicators({
            id: t.id,
            timestamp: new Date(t.timestamp),
            symbol: t.symbol,
            side: t.side,
            price,
            quantity,
          }, '15m');
          // saveNote はDBに保存された実際のノートIDを返す
          const savedNoteId = await this.noteService.saveNote(note);
          generatedNoteIds.push(savedNoteId);
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
      // 本番環境では内部エラーの詳細を隠蔽
      const isProduction = process.env.NODE_ENV === 'production';
      const safeMessage = 'CSV の取り込みに失敗しました。ファイル形式を確認してください。';
      const errorMsg = isProduction ? safeMessage : ((error as Error).message || safeMessage);
      res.status(500).json({ error: errorMsg });
    }
  };

  /**
   * Get all trade notes
   * クエリパラメータで status フィルタ可能
   * ?status=approved / ?status=draft / ?status=rejected
   */
  getAllNotes = async (req: Request, res: Response): Promise<void> => {
    const statusParam = req.query.status as string | undefined;
    
    let notes;
    if (statusParam && ['draft', 'approved', 'rejected'].includes(statusParam)) {
      notes = await this.noteService.loadNotesByStatus(statusParam as NoteStatus);
    } else {
      notes = await this.noteService.loadAllNotes();
    }
    
    res.json({ notes });
  };

  /**
   * Get status counts for dashboard
   */
  getStatusCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const counts = await this.noteService.getStatusCounts();
      res.json(counts);
    } catch (error) {
      console.error('Error getting status counts:', error);
      res.status(500).json({ error: 'ステータス集計の取得に失敗しました' });
    }
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

  // ノート承認
  approveNote = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    try {
      const note = await this.noteService.approveNote(noteId);
      res.json({ success: true, status: note.status, note });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('見つかりませんでした')) {
        res.status(404).json({ error: message });
      } else {
        console.error('Error approving note:', error);
        res.status(500).json({ error: 'ノートの承認に失敗しました' });
      }
    }
  };

  // ノート非承認（reject）
  rejectNote = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    try {
      const note = await this.noteService.rejectNote(noteId);
      res.json({ success: true, status: note.status, note });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('見つかりませんでした')) {
        res.status(404).json({ error: message });
      } else {
        console.error('Error rejecting note:', error);
        res.status(500).json({ error: 'ノートの非承認に失敗しました' });
      }
    }
  };

  // ノートを下書きに戻す
  revertToDraft = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    try {
      const note = await this.noteService.revertToDraft(noteId);
      res.json({ success: true, status: note.status, note });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('見つかりませんでした')) {
        res.status(404).json({ error: message });
      } else {
        console.error('Error reverting note to draft:', error);
        res.status(500).json({ error: 'ノートの状態変更に失敗しました' });
      }
    }
  };

  // ノート内容の更新
  updateNote = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    const { aiSummary, userNotes, tags } = req.body as NoteUpdatePayload;

    try {
      const note = await this.noteService.updateNote(noteId, {
        aiSummary,
        userNotes,
        tags,
      });
      res.json({ success: true, note });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('見つかりませんでした')) {
        res.status(404).json({ error: message });
      } else {
        console.error('Error updating note:', error);
        res.status(500).json({ error: 'ノートの更新に失敗しました' });
      }
    }
  };

  /**
   * 類似ノートを検索
   * POST /api/trades/notes/:id/similar
   * 
   * 12次元特徴量ベクトル + コサイン類似度を使用
   */
  findSimilarNotes = async (req: Request, res: Response): Promise<void> => {
    const noteId = String(req.params.id);
    // リクエストボディから閾値と件数を取得（デフォルト: WEAK閾値, 10件）
    const threshold = Number(req.body.threshold) || SIMILARITY_THRESHOLDS.WEAK;
    const limit = Number(req.body.limit) || 10;

    try {
      const results = await this.featureService.findSimilarToNote(
        noteId,
        limit,
        threshold
      );

      // フロントエンド用にレスポンスを整形
      // note は include で trade と aiSummary を含む拡張型
      type NoteWithRelations = typeof results[number]['note'] & {
        trade?: { side: string } | null;
        aiSummary?: { summary: string } | null;
        entryTime?: Date;
        pnl?: Prisma.Decimal | null;
      };

      const formattedResults = results.map(r => {
        const note = r.note as NoteWithRelations;
        return {
          noteId: note.id,
          symbol: note.symbol,
          side: note.trade?.side || 'buy',
          timestamp: note.entryTime || note.createdAt,
          similarity: Math.round(r.similarity * 100), // パーセンテージに変換
          summarySnippet: note.aiSummary?.summary || note.userNotes || '',
          result: this.determineTradeResult(note),
        };
      });

      res.json({
        success: true,
        data: {
          baseNoteId: noteId,
          similarNotes: formattedResults,
          threshold,
          limit,
        },
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error finding similar notes:', error);
      res.status(500).json({
        success: false,
        error: message || '類似ノートの検索に失敗しました',
      });
    }
  };

  /**
   * ノートの結果を判定（win/loss/breakeven）
   * TODO: 実際の損益計算ロジックに置き換え
   */
  private determineTradeResult(note: { pnl?: number | null | Prisma.Decimal }): string {
    if (!note.pnl) return 'pending';
    const pnl = typeof note.pnl === 'number' ? note.pnl : Number(note.pnl);
    if (pnl > 0) return 'win';
    if (pnl < 0) return 'loss';
    return 'breakeven';
  }

  // ============================================
  // フェーズ8: ノート優先度/有効無効管理
  // ============================================

  /**
   * ノートの優先度を更新
   * PATCH /api/trades/notes/:id/priority
   * 
   * リクエストボディ:
   * - priority: 1-10 の整数（高いほど優先）
   */
  updatePriority = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { priority } = req.body;

      if (typeof priority !== 'number' || priority < 1 || priority > 10) {
        res.status(400).json({
          success: false,
          error: '優先度は 1-10 の整数で指定してください',
        });
        return;
      }

      await this.noteService.updateNotePriority(id, priority);

      res.json({
        success: true,
        message: `ノートの優先度を ${priority} に更新しました`,
        data: { noteId: id, priority },
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error updating note priority:', error);
      res.status(500).json({
        success: false,
        error: message || '優先度の更新に失敗しました',
      });
    }
  };

  /**
   * ノートの有効/無効を切り替え
   * PATCH /api/trades/notes/:id/enabled
   * 
   * リクエストボディ:
   * - enabled: boolean
   */
  setEnabled = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({
          success: false,
          error: 'enabled は boolean で指定してください',
        });
        return;
      }

      await this.noteService.setNoteEnabled(id, enabled);

      res.json({
        success: true,
        message: enabled ? 'ノートを有効にしました' : 'ノートを無効にしました',
        data: { noteId: id, enabled },
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error setting note enabled:', error);
      res.status(500).json({
        success: false,
        error: message || '有効/無効の切り替えに失敗しました',
      });
    }
  };

  /**
   * ノートを一時停止（指定日時まで無効）
   * PATCH /api/trades/notes/:id/pause
   * 
   * リクエストボディ:
   * - pausedUntil: ISO 8601 形式の日時文字列、または null（停止解除）
   */
  setPausedUntil = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { pausedUntil } = req.body;

      let parsedDate: Date | null = null;
      if (pausedUntil !== null && pausedUntil !== undefined) {
        parsedDate = new Date(pausedUntil);
        if (isNaN(parsedDate.getTime())) {
          res.status(400).json({
            success: false,
            error: 'pausedUntil は有効な日時形式で指定してください',
          });
          return;
        }
      }

      await this.noteService.setNotePausedUntil(id, parsedDate);

      res.json({
        success: true,
        message: parsedDate 
          ? `ノートを ${parsedDate.toISOString()} まで一時停止しました` 
          : 'ノートの一時停止を解除しました',
        data: { noteId: id, pausedUntil: parsedDate?.toISOString() || null },
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error setting note paused until:', error);
      res.status(500).json({
        success: false,
        error: message || '一時停止の設定に失敗しました',
      });
    }
  };
}
