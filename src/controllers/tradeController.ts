import { Request, Response } from 'express';
import { TradeImportService } from '../services/tradeImportService';
import { TradeNoteService } from '../services/tradeNoteService';
import path from 'path';
import { config } from '../config';

export class TradeController {
  private importService: TradeImportService;
  private noteService: TradeNoteService;

  constructor() {
    this.importService = new TradeImportService();
    this.noteService = new TradeNoteService();
  }

  /**
   * Import trades from CSV file
   */
  importCSV = async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename } = req.body;
      
      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }

      const filepath = path.join(process.cwd(), config.paths.trades, filename);
      const trades = await this.importService.importFromCSV(filepath);

      // Generate notes for each trade
      const notes = [];
      for (const trade of trades) {
        const note = await this.noteService.generateNote(trade);
        await this.noteService.saveNote(note);
        notes.push(note);
      }

      res.json({
        success: true,
        tradesImported: trades.length,
        notesGenerated: notes.length,
        notes: notes.map(n => ({ id: n.id, symbol: n.symbol, timestamp: n.timestamp }))
      });
    } catch (error) {
      console.error('Error importing CSV:', error);
      res.status(500).json({ error: 'Failed to import CSV' });
    }
  };

  /**
   * Import trades from API
   */
  importAPI = async (req: Request, res: Response): Promise<void> => {
    try {
      const { exchange, apiKey } = req.body;

      if (!exchange || !apiKey) {
        res.status(400).json({ error: 'Exchange and API key are required' });
        return;
      }

      const trades = await this.importService.importFromAPI(exchange, apiKey);

      res.json({
        success: true,
        tradesImported: trades.length,
        message: 'API import not yet fully implemented'
      });
    } catch (error) {
      console.error('Error importing from API:', error);
      res.status(500).json({ error: 'Failed to import from API' });
    }
  };

  /**
   * Get all trade notes
   */
  getAllNotes = async (req: Request, res: Response): Promise<void> => {
    try {
      const notes = await this.noteService.loadAllNotes();
      res.json({ notes });
    } catch (error) {
      console.error('Error getting notes:', error);
      res.status(500).json({ error: 'Failed to retrieve notes' });
    }
  };

  /**
   * Get a specific note by ID
   */
  getNoteById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const note = await this.noteService.getNoteById(id);

      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }

      res.json({ note });
    } catch (error) {
      console.error('Error getting note:', error);
      res.status(500).json({ error: 'Failed to retrieve note' });
    }
  };
}
