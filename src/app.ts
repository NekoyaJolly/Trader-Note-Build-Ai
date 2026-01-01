import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config';
import tradeRoutes from './routes/tradeRoutes';
import matchingRoutes from './routes/matchingRoutes';
import notificationRoutes from './routes/notificationRoutes';
import orderRoutes from './routes/orderRoutes';
import indicatorRoutes from './routes/indicatorRoutes';
import backtestRoutes from './routes/backtestRoutes';
import barLocatorRoutes from './controllers/barLocatorController';
import strategyRoutes from './backend/api/strategyRoutes';
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
    // CORS設定: 本番環境のVercelからのアクセスを許可
    // Vercel ドメイン一覧:
    //   - trader-note-build-ai.vercel.app (本番)
    //   - trader-note-build-ai-git-main-nekoya258.vercel.app (main ブランチプレビュー)
    //   - trader-note-build-XXXX-nekoya258.vercel.app (コミットプレビュー)
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3102',
      // 本番ドメイン
      'https://trader-note-build-ai.vercel.app',
      // Git ブランチ / コミットプレビュー（nekoya258 ユーザー）
      'https://trader-note-build-ai-*-nekoya258.vercel.app',
      'https://trader-note-build-*-nekoya258.vercel.app',
    ];

    this.app.use(cors({
      origin: (origin, callback) => {
        // origin が undefined の場合（same-origin リクエスト）は許可
        if (!origin) return callback(null, true);
        
        // 許可リストに含まれるか、ワイルドカードにマッチするかをチェック
        const isAllowed = allowedOrigins.some(allowed => {
          if (allowed.includes('*')) {
            const regex = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
            return regex.test(origin);
          }
          return allowed === origin;
        });

        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn(`CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    
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
    this.app.use('/api/indicators', indicatorRoutes);
    this.app.use('/api/backtest', backtestRoutes);
    this.app.use('/api/bars', barLocatorRoutes);
    this.app.use('/api/strategies', strategyRoutes);

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
      console.log('  POST /api/bars/locate');
      console.log('  GET  /api/bars/locate/:symbol/:timestamp/:timeframe');
      console.log('═══════════════════════════════════════\n');

      // スケジューラー起動: 本番運用ルールに従い、CRON_ENABLED が true の場合のみ起動
      // 理由: 開発環境では通知ファイルの更新が再起動ループの原因となるため、デフォルト無効化
      const cronEnabled = process.env.CRON_ENABLED === 'true';
      if (cronEnabled) {
        this.scheduler.start();
      } else {
        // 本番環境ではデバッグログを抑制
        if (!config.server.isProduction) {
          console.log('スケジューラーはCRON_ENABLEDがtrueの時のみ起動（現在は無効）');
        }
      }
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
