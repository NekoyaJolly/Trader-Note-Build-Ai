import { Request, Response } from 'express';
import { OrderPreset } from '../models/types';
import { TradeNoteService } from '../services/tradeNoteService';
import { MarketDataService } from '../services/marketDataService';

export class OrderController {
  private noteService: TradeNoteService;
  private marketService: MarketDataService;

  constructor() {
    this.noteService = new TradeNoteService();
    this.marketService = new MarketDataService();
  }

  /**
   * Generate order presets based on a matched note
   */
  generatePreset = async (req: Request, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;
      const note = await this.noteService.getNoteById(noteId);

      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }

      // Get current market data
      const currentMarket = await this.marketService.getCurrentMarketData(note.symbol);

      // 過去ノートと現在市場データに基づいてプリセットを生成
      const preset: OrderPreset = {
        symbol: note.symbol,
        side: note.side,
        suggestedPrice: currentMarket.close,
        suggestedQuantity: note.quantity,
        basedOnNoteId: note.id,
        confidence: 0.8, // 信頼度スコア（将来的に算出ロジックを追加予定）
      };

      res.json({ preset });
    } catch (error) {
      console.error('Error generating preset:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '注文プリセットの生成に失敗しました' });
    }
  };

  /**
   * 注文確認データを取得
   * 注意: 本システムは自動売買を行いません。これは参考情報のみを提供します。
   */
  getConfirmation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, side, price, quantity } = req.body;

      if (!symbol || !side || !price || !quantity) {
        res.status(400).json({ error: '必須項目が不足しています（symbol, side, price, quantity）' });
        return;
      }

      // 概算コストを計算（参考値）
      const estimatedCost = price * quantity;
      const estimatedFee = estimatedCost * 0.001; // 0.1% 手数料想定

      res.json({
        confirmation: {
          symbol,
          side,
          price,
          quantity,
          estimatedCost,
          estimatedFee,
          total: estimatedCost + estimatedFee,
          // 重要: 自動売買ではなく参考情報であることを明示
          warning: 'これは参考情報です。本システムは自動売買を行いません。実際の注文は取引所で行ってください。',
        }
      });
    } catch (error) {
      console.error('Error getting confirmation:', error);
      // 本番環境では内部エラーの詳細を隠蔽
      res.status(500).json({ error: '注文確認情報の取得に失敗しました' });
    }
  };
}
