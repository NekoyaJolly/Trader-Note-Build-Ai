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

      // Generate preset based on historical note and current market
      const preset: OrderPreset = {
        symbol: note.symbol,
        side: note.side,
        suggestedPrice: currentMarket.close,
        suggestedQuantity: note.quantity,
        basedOnNoteId: note.id,
        confidence: 0.8, // Placeholder confidence score
      };

      res.json({ preset });
    } catch (error) {
      console.error('Error generating preset:', error);
      res.status(500).json({ error: 'Failed to generate order preset' });
    }
  };

  /**
   * Get order confirmation data
   */
  getConfirmation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, side, price, quantity } = req.body;

      if (!symbol || !side || !price || !quantity) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // Calculate estimated costs
      const estimatedCost = price * quantity;
      const estimatedFee = estimatedCost * 0.001; // 0.1% fee estimate

      res.json({
        confirmation: {
          symbol,
          side,
          price,
          quantity,
          estimatedCost,
          estimatedFee,
          total: estimatedCost + estimatedFee,
          warning: 'This is a suggestion only. Please review carefully before executing.',
        }
      });
    } catch (error) {
      console.error('Error getting confirmation:', error);
      res.status(500).json({ error: 'Failed to get order confirmation' });
    }
  };
}
