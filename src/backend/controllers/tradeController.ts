import type { Request, Response } from 'express';
import { getValidatedQuery } from '../../middleware/validateRequest';
import { TradeImportService } from '../../services/tradeImportService';
import path from 'path';
import { config } from '../../config';
import fs from 'fs';
import { TradeRepository } from '../repositories/tradeRepository';
import type { NoteUpdatePayload } from '../../services/tradeNoteService';
import { TradeNoteService } from '../../services/tradeNoteService';
import type { NoteStatus } from '../../models/types';
import type { Prisma } from '@prisma/client';
import { FeatureService } from '../../services/featureService';
import type { PerformanceReportOptions } from '../../services/performance';
import { NotePerformanceService } from '../../services/performance';
import { z } from 'zod';
import { LensNoteCoreService } from '../../services/lensNoteCoreService';
import { getIndicatorProfileService } from '../../services/indicatorProfileService';
import { isReservedProfileId } from '../../models/indicatorProfile';
import type { IndicatorConfig } from '../../models/indicatorConfig';

const ImportCsvFilenameSchema = z.object({
  filename: z.string().min(1, 'ファイル名が必要です'),
}).strict();

const UploadCsvTextBodySchema = z
  .object({
    filename: z.string().min(1),
    csvText: z.string(),
    profileId: z.string().optional(),
    // 後方互換のための受け口。individual は未実装で UI からは送られない (一括適用のみ)。
    // サーバー処理では未使用 (uploadCSVText 参照)。
    applyMode: z.enum(['bulk', 'individual']).optional(),
    userComment: z.string().optional(),
  })
  .strict();

const UpdatePriorityBodySchema = z.object({
  priority: z.coerce.number().int().min(1).max(10),
}).strict();

const SetEnabledBodySchema = z.object({
  enabled: z.boolean(),
}).strict();

const SetPausedUntilBodySchema = z.object({
  pausedUntil: z.union([z.string().min(1), z.null()]).optional(),
}).strict();

const BulkPerformanceBodySchema = z
  .object({
    noteIds: z.array(z.string().min(1)).min(1),
    from: z.string().optional(),
    to: z.string().optional(),
    timeframe: z.string().optional(),
  })
  .strict();

/** getBulkSummary の値型（Record の unknown 禁止回避用） */
type BulkPerfSummaryEntry = {
  triggerRate: number;
  avgSimilarity: number;
  totalEvaluations: number;
};

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
  private performanceService: NotePerformanceService;
  // Note コア行(lensSnapshot)の生成 (Phase α-2、NOTE_SIMILARITY_FOUNDATION.md §9-1)
  private lensNoteCoreService: LensNoteCoreService;

  constructor() {
    this.importService = new TradeImportService();
    this.tradeRepository = new TradeRepository();
    this.noteService = new TradeNoteService();
    this.featureService = new FeatureService();
    this.performanceService = new NotePerformanceService();
    this.lensNoteCoreService = new LensNoteCoreService();
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
      const parsed = ImportCsvFilenameSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'ファイル名が必要です', details: parsed.error.format() });
        return;
      }
      const { filename } = parsed.data;

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

      // Phase α-4: 取り込みデータを認証ユーザーに帰属させる (requireAuth 配下)
      const userId = req.user!.userId;
      const result = await this.importService.importFromCSV(filepath, userId);

      // 取り込んだトレードからノートを生成
      const generatedNoteIds: string[] = [];
      const noteErrors: string[] = [];

      // DB から取得、失敗時は parsedTrades を使用
      let trades: TradeData[] = [];
      try {
        if (result.insertedIds.length > 0) {
          trades = await this.tradeRepository.findByIds(result.insertedIds, userId);
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
          await this.noteService.saveNote(note, userId);
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
      const parsedBody = UploadCsvTextBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        res.status(400).json({ error: 'CSV ファイル名と内容が必要です', details: parsedBody.error.format() });
        return;
      }
      const { filename, csvText, profileId, userComment } = parsedBody.data;
      // applyMode は後方互換のための受け口。個別選択(individual)は未実装のため UI からは
      // 送信されなくなった (現在は一括適用のみ)。古いクライアントが送ってきても 400 にしない
      // ようスキーマでは optional で受け付けるが、サーバー処理では使用しない。
      // individual を実装する場合は P0 の範囲外として別 PR で扱う。
      // プロファイル参照と取り込みデータの帰属に使用 (requireAuth 配下、Phase α-4)
      const userId = req.user!.userId;

      // 入力検証（技術用語を避けたメッセージはフロント側で実施）
      const savePath = path.join(process.cwd(), config.paths.trades, filename);
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, csvText, 'utf-8');

      // 取り込みを実行
      const result = await this.importService.importFromCSV(savePath, userId);

      // 取り込んだトレードから Draft ノートを作成（DB 未設定でも parsedTrades を用いて生成可能）
      // ユーザー設定のインジケーターを適用してノートを生成
      type TradeRecord = { id: string; timestamp: Date; symbol: string; side: 'buy' | 'sell'; price: number | { toNumber(): number }; quantity: number | { toNumber(): number } };
      let trades: TradeRecord[] = [];
      try {
        const dbTrades = await this.tradeRepository.findByIds(result.insertedIds, userId);
        trades = dbTrades.map(t => ({
          id: t.id,
          timestamp: t.timestamp,
          symbol: t.symbol,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
        }));
      } catch {
        // DB 未接続時は parsedTrades を使ってノート生成を継続
        trades = result.parsedTrades;
      }
      // Note コア(lensSnapshot)生成用に、プロファイルのインジケーター設定を 1 回だけ解決する。
      // 予約 ID(__AI_AUTO__/__NONE__)・プロファイル未指定・参照失敗は「状態レンズのみ」(空配列)。
      let lensIndicatorConfigs: IndicatorConfig[] = [];
      if (profileId && !isReservedProfileId(profileId)) {
        try {
          const lensProfile = await getIndicatorProfileService().getProfileById(profileId, userId);
          lensIndicatorConfigs = lensProfile?.indicators.filter((i) => i.enabled) ?? [];
        } catch (profileError) {
          console.warn('[TradeController] レンズ用プロファイル解決失敗(状態レンズのみで継続):', profileError);
        }
      }

      const generatedNoteIds: string[] = [];
      for (const t of trades) {
        try {
          // Decimal型（Prisma）の場合はtoNumber()で変換、それ以外はNumber()
          const price = typeof t.price === 'object' && 'toNumber' in t.price ? t.price.toNumber() : Number(t.price);
          const quantity = typeof t.quantity === 'object' && 'toNumber' in t.quantity ? t.quantity.toNumber() : Number(t.quantity);
          
          // プロファイルIDが指定されている場合はそれを使用、なければ従来の処理
          const note = profileId 
            ? await this.noteService.generateNoteWithProfile({
                id: t.id,
                timestamp: new Date(t.timestamp),
                symbol: t.symbol,
                side: t.side,
                price,
                quantity,
              }, profileId, userId, '15m', userComment)
            : await this.noteService.generateNoteWithUserIndicators({
                id: t.id,
                timestamp: new Date(t.timestamp),
                symbol: t.symbol,
                side: t.side,
                price,
                quantity,
              }, '15m');
          
          // saveNote はDBに保存された実際のノートIDを返す (Phase α-4: 所有ユーザー付き)
          const savedNoteId = await this.noteService.saveNote(note, userId);
          generatedNoteIds.push(savedNoteId);

          // Note コア行(lensSnapshot)を生成 (Phase α-2)。
          // トレード時刻(eventTime)起点で「その瞬間の市場」を特徴化する。
          // 失敗しても取り込みフローは継続する(lensSnapshot=null で登録 → バックフィル対象)。
          try {
            const lensResult = await this.lensNoteCoreService.createForSideATradeNote({
              tradeNoteId: savedNoteId,
              userId,
              symbol: t.symbol,
              side: t.side,
              timeframe: '15m',
              entryPrice: price,
              eventTime: new Date(t.timestamp),
              indicatorConfigs: lensIndicatorConfigs,
            });
            if (!lensResult.snapshotGenerated || lensResult.warnings.length > 0) {
              console.warn(
                `[TradeController] lensSnapshot 生成警告 (noteId=${savedNoteId}): ` +
                  lensResult.warnings.join(' / ')
              );
            }
          } catch (lensError) {
            console.warn(
              `[TradeController] Note コア生成失敗 (noteId=${savedNoteId}、取り込みは継続):`,
              lensError
            );
          }
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
   * ?status=active / ?status=draft / ?status=archived
   */
  getAllNotes = async (req: Request, res: Response): Promise<void> => {
    const { status: statusParam } = getValidatedQuery<{ status?: string }>(res);
    // Phase α-4: 認証ユーザーのノートのみ返す
    const userId = req.user!.userId;

    let notes;
    if (statusParam && ['draft', 'active', 'archived'].includes(statusParam)) {
      notes = await this.noteService.loadNotesByStatus(statusParam as NoteStatus, userId);
    } else {
      notes = await this.noteService.loadAllNotes(userId);
    }

    res.json({ notes });
  };

  /**
   * Get status counts for dashboard
   */
  getStatusCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const counts = await this.noteService.getStatusCounts(req.user!.userId);
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
    // Phase α-4: 他ユーザーのノートは存在しない扱い (404)
    const note = await this.noteService.getNoteById(noteId, req.user!.userId);
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
      const note = await this.noteService.approveNote(noteId, req.user!.userId);
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
      const note = await this.noteService.rejectNote(noteId, req.user!.userId);
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
      const note = await this.noteService.revertToDraft(noteId, req.user!.userId);
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
      }, req.user!.userId);
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
      const parsed = UpdatePriorityBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: '優先度は 1-10 の整数で指定してください',
          details: parsed.error.format(),
        });
        return;
      }
      const { priority } = parsed.data;

      await this.noteService.updateNotePriority(id, priority, req.user!.userId);

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
      const parsed = SetEnabledBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'enabled は boolean で指定してください',
          details: parsed.error.format(),
        });
        return;
      }
      const { enabled } = parsed.data;

      await this.noteService.setNoteEnabled(id, enabled, req.user!.userId);

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
      const parsed = SetPausedUntilBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'pausedUntil の形式が不正です',
          details: parsed.error.format(),
        });
        return;
      }
      const { pausedUntil } = parsed.data;

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

      await this.noteService.setNotePausedUntil(id, parsedDate, req.user!.userId);

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

  // ============================================
  // フェーズ9: ノートパフォーマンス
  // ============================================

  /**
   * ノートのパフォーマンスレポートを取得
   * GET /api/trades/notes/:id/performance
   * 
   * クエリパラメータ:
   * - from: 集計開始日時（ISO 8601）
   * - to: 集計終了日時（ISO 8601）
   * - timeframe: 時間足で絞り込み（例: 15m, 1h）
   * - weakThreshold: 弱いパターン検出閾値（0.0〜1.0）
   */
  getPerformanceReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { from, to, timeframe, weakThreshold } = getValidatedQuery<{
        from?: string;
        to?: string;
        timeframe?: string;
        weakThreshold?: string;
      }>(res);

      // オプション構築 (Phase α-4: 認証ユーザーのノートのみ対象)
      const options: PerformanceReportOptions = { userId: req.user!.userId };

      if (from) {
        const fromDate = new Date(from);
        if (!isNaN(fromDate.getTime())) {
          options.from = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!isNaN(toDate.getTime())) {
          options.to = toDate;
        }
      }
      if (timeframe) {
        options.timeframe = timeframe;
      }
      if (weakThreshold) {
        const threshold = parseFloat(weakThreshold);
        if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
          options.weakThreshold = threshold;
        }
      }

      const report = await this.performanceService.generateReport(id, options);

      if (!report) {
        res.status(404).json({
          success: false,
          error: 'パフォーマンスデータが見つかりません（評価ログがありません）',
        });
        return;
      }

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error getting performance report:', error);
      res.status(500).json({
        success: false,
        error: message || 'パフォーマンスレポートの取得に失敗しました',
      });
    }
  };

  /**
   * ノートランキングを取得
   * GET /api/trades/notes/performance/ranking
   * 
   * クエリパラメータ:
   * - limit: 取得件数（デフォルト: 20）
   * - from: 集計開始日時（ISO 8601）
   * - to: 集計終了日時（ISO 8601）
   * - timeframe: 時間足で絞り込み
   */
  getPerformanceRanking = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, from, to, timeframe } = getValidatedQuery<{
        limit?: string;
        from?: string;
        to?: string;
        timeframe?: string;
      }>(res);

      // オプション構築 (Phase α-4: 認証ユーザーのノートのみ対象)
      const options: PerformanceReportOptions = { userId: req.user!.userId };

      if (from) {
        const fromDate = new Date(from);
        if (!isNaN(fromDate.getTime())) {
          options.from = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!isNaN(toDate.getTime())) {
          options.to = toDate;
        }
      }
      if (timeframe) {
        options.timeframe = timeframe;
      }

      const limitNum = limit ? parseInt(limit, 10) : 20;
      const ranking = await this.performanceService.getRanking(limitNum, options);

      res.json({
        success: true,
        data: ranking,
        meta: {
          limit: limitNum,
          count: ranking.length,
        },
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error getting performance ranking:', error);
      res.status(500).json({
        success: false,
        error: message || 'パフォーマンスランキングの取得に失敗しました',
      });
    }
  };

  /**
   * 複数ノートのパフォーマンスサマリーを一括取得
   * POST /api/trades/notes/performance/bulk
   * 
   * リクエストボディ:
   * - noteIds: string[] - ノート ID 配列
   * - from?: 集計開始日時
   * - to?: 集計終了日時
   */
  getBulkPerformanceSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = BulkPerformanceBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'noteIds は必須です（string 配列）',
          details: parsed.error.format(),
        });
        return;
      }
      const { noteIds, from, to, timeframe } = parsed.data;

      // オプション構築 (Phase α-4: 認証ユーザーの所有ノートに絞り込み)
      const options: PerformanceReportOptions = { userId: req.user!.userId };

      if (from) {
        const fromDate = new Date(from);
        if (!isNaN(fromDate.getTime())) {
          options.from = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!isNaN(toDate.getTime())) {
          options.to = toDate;
        }
      }
      if (timeframe) {
        options.timeframe = timeframe;
      }

      const summaryMap = await this.performanceService.getBulkSummary(noteIds, options);

      // Map を Object に変換
      const summaries: Record<string, BulkPerfSummaryEntry> = {};
      summaryMap.forEach((value, key) => {
        summaries[key] = value;
      });

      res.json({
        success: true,
        data: summaries,
        meta: {
          requestedCount: noteIds.length,
          returnedCount: Object.keys(summaries).length,
        },
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error('Error getting bulk performance summary:', error);
      res.status(500).json({
        success: false,
        error: message || 'パフォーマンスサマリーの取得に失敗しました',
      });
    }
  };
}
