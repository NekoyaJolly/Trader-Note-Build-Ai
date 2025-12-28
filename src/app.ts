import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config';
import tradeRoutes from './routes/tradeRoutes';
import matchingRoutes from './routes/matchingRoutes';
import notificationRoutes from './routes/notificationRoutes';
import orderRoutes from './routes/orderRoutes';
import { MatchingScheduler } from './utils/scheduler';

/**
 * TradeAssist MVP Application
 */
class App {
  public app: Application;
  private scheduler: MatchingScheduler;

  constructor() {
    this.app = express();
    this.scheduler = new MatchingScheduler();
    this.initializeMiddlewares();
    this.initializeRoutes();
  }

  /**
   * Initialize middlewares
   */
  private initializeMiddlewares(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  /**
   * Initialize routes
   */
  private initializeRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        schedulerRunning: this.scheduler.isSchedulerRunning(),
      });
    });

    // API routes
    this.app.use('/api/trades', tradeRoutes);
    this.app.use('/api/matching', matchingRoutes);
    this.app.use('/api/notifications', notificationRoutes);
    this.app.use('/api/orders', orderRoutes);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Route not found' });
    });
  }

  /**
   * Start the application
   */
  public start(): void {
    const port = config.server.port;

    this.app.listen(port, () => {
      console.log('═══════════════════════════════════════');
      console.log('  TradeAssist MVP Server');
      console.log('═══════════════════════════════════════');
      console.log(`  Environment: ${config.server.env}`);
      console.log(`  Server running on port: ${port}`);
      console.log(`  Match threshold: ${config.matching.threshold}`);
      console.log(`  Check interval: ${config.matching.checkIntervalMinutes} minutes`);
      console.log('═══════════════════════════════════════');
      console.log('\nAvailable endpoints:');
      console.log('  GET  /health');
      console.log('  POST /api/trades/import/csv');
      console.log('  POST /api/trades/import/upload-text');
      console.log('  GET  /api/trades/notes');
      console.log('  GET  /api/trades/notes/:id');
      console.log('  POST /api/trades/notes/:id/approve');
      console.log('  POST /api/matching/check');
      console.log('  GET  /api/matching/history');
      console.log('  GET  /api/notifications');
      console.log('  PUT  /api/notifications/:id/read');
      console.log('  GET  /api/orders/preset/:noteId');
      console.log('  POST /api/orders/confirmation');
      console.log('═══════════════════════════════════════\n');

      // Start the matching scheduler
      this.scheduler.start();
    });
  }

  /**
   * Stop the application
   */
  public stop(): void {
    this.scheduler.stop();
  }
}

export default App;
