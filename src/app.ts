import express, { Application, Request, Response, NextFunction } from 'express';
import { Server, IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import tradeRoutes from './routes/tradeRoutes';
import matchingRoutes from './routes/matchingRoutes';
import notificationRoutes from './routes/notificationRoutes';
import orderRoutes from './routes/orderRoutes';
import indicatorRoutes from './routes/indicatorRoutes';
import backtestRoutes from './routes/backtestRoutes';
import settingsRoutes from './routes/settingsRoutes';
import barLocatorRoutes from './controllers/barLocatorController';
import strategyRoutes from './backend/api/strategyRoutes';
import strategyComparisonRoutes from './backend/api/strategyComparisonRoutes';
import patternAnalysisRoutes from './backend/api/patternAnalysisRoutes';
import watchlistRoutes from './routes/watchlistRoutes';
import pushRoutes from './routes/pushRoutes';
import ohlcvRoutes from './backend/api/ohlcvRoutes';
import profileRoutes from './routes/profileRoutes';
import { sideBRoutes } from './side-b/routes';
import cronRoutes from './routes/cronRoutes';
import ctraderAuthRoutes from './backend/api/ctraderAuthRoutes';
import tradingRoutes from './backend/api/tradingRoutes';
import marketAnalysisRoutes from './routes/marketAnalysisRoutes';
import realtimeRoutes from './backend/api/realtimeRoutes';
import similarityRoutes from './routes/similarityRoutes';
import { MatchingScheduler } from './utils/scheduler';
import { getSideBScheduler } from './side-b/jobs/sideBScheduler';

/**
 * TradeAssist Application
 */
class App {
  public app: Application;
  private scheduler: MatchingScheduler;
  private server: Server | null = null;
  private nextHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

  constructor() {
    console.log('[App] コンストラクタ開始');
    this.app = express();
    this.scheduler = new MatchingScheduler();
    console.log('[App] ミドルウェアを初期化中...');
    this.initializeMiddlewares();
    // ルート初期化は start() で行う（Next.js ハンドラーの準備を待つため）
    console.log('[App] コンストラクタ完了');
  }

  /**
   * Initialize middlewares
   */
  private initializeMiddlewares(): void {
    console.log('[App] CORS設定を初期化中...');
    // CORS設定: 本番環境では同一オリジン（Cloud Run 統合）のため localhost のみ許可
    // 開発環境では FE dev server (3102) と BE (3100) が別ポートで動作
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3102',
    ];

    this.app.use(cors({
      origin: (origin, callback) => {
        // origin が undefined の場合（same-origin リクエスト）は許可
        if (!origin) return callback(null, true);

        const isAllowed = allowedOrigins.some(allowed => allowed === origin);

        if (isAllowed) {
          callback(null, true);
        } else {
          // 本番環境では同一オリジンなので CORS は不要だが、念のためログ
          console.warn(`CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Set-Cookie'],
    }));

    console.log('[App] JSON パーサーを設定中...');
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Cookie パーサー（cTrader認証のJWT Cookie用）
    console.log('[App] Cookie パーサーを設定中...');
    this.app.use(cookieParser());
    console.log('[App] ミドルウェア初期化完了');
  }

  /**
   * Initialize routes
   */
  private initializeRoutes(): void {
    console.log('[App] ルート初期化開始...');

    try {
      // 本番環境: Next.js 静的ファイルを Express で配信
      if (config.server.isProduction) {
        const frontendDir = path.join(process.cwd(), 'frontend');
        console.log('[App] Next.js 静的ファイルを配信設定中...');
        // _next/static/* → ハッシュ付き JS/CSS バンドル（長期キャッシュ可能）
        this.app.use('/_next/static', express.static(
          path.join(frontendDir, '.next/static'),
          { maxAge: '365d', immutable: true }
        ));
        // public/* → favicon, manifest, アイコン等
        this.app.use(express.static(
          path.join(frontendDir, 'public'),
          { maxAge: '1d' }
        ));
      }

      // Health check
      console.log('[App] /health エンドポイントを登録中...');
      this.app.get('/health', (req: Request, res: Response) => {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          schedulerRunning: this.scheduler.isSchedulerRunning(),
        });
      });

      // API routes
      // cTrader OAuth 認証ルート（認証不要）
      console.log('[App] /api/auth ルートを登録中...');
      this.app.use('/api/auth', ctraderAuthRoutes);

      // トレーディングルート（認証必須）
      console.log('[App] /api/trading ルートを登録中...');
      this.app.use('/api/trading', tradingRoutes);

      // ウォッチリスト（認証必須）
      console.log('[App] /api/watchlist ルートを登録中...');
      this.app.use('/api/watchlist', watchlistRoutes);

      // Push通知（認証必須、一部認証不要）
      console.log('[App] /api/push ルートを登録中...');
      this.app.use('/api/push', pushRoutes);

      // データルート
      console.log('[App] /api/trades ルートを登録中...');
      this.app.use('/api/trades', tradeRoutes);

      console.log('[App] /api/matching ルートを登録中...');
      this.app.use('/api/matching', matchingRoutes);

      console.log('[App] /api/notifications ルートを登録中...');
      this.app.use('/api/notifications', notificationRoutes);

      console.log('[App] /api/orders ルートを登録中...');
      this.app.use('/api/orders', orderRoutes);

      console.log('[App] /api/indicators ルートを登録中...');
      this.app.use('/api/indicators', indicatorRoutes);

      console.log('[App] /api/profiles ルートを登録中...');
      this.app.use('/api/profiles', profileRoutes);

      console.log('[App] /api/backtest ルートを登録中...');
      this.app.use('/api/backtest', backtestRoutes);

      console.log('[App] /api/settings ルートを登録中...');
      this.app.use('/api/settings', settingsRoutes);

      console.log('[App] /api/bars ルートを登録中...');
      this.app.use('/api/bars', barLocatorRoutes);

      console.log('[App] /api/strategies ルートを登録中...');
      this.app.use('/api/strategies', strategyRoutes);

      console.log('[App] /api/strategy-comparison ルートを登録中...');
      this.app.use('/api/strategy-comparison', strategyComparisonRoutes);

      console.log('[App] /api/pattern-analysis ルートを登録中...');
      this.app.use('/api/pattern-analysis', patternAnalysisRoutes);

      console.log('[App] /api/ohlcv ルートを登録中...');
      this.app.use('/api/ohlcv', ohlcvRoutes);

      // Side-B: AI トレードプラン生成
      console.log('[App] /api/side-b ルートを登録中...');
      this.app.use('/api/side-b', sideBRoutes);

      // マーケット分析（OHLCV + 12次元特徴量）
      console.log('[App] /api/market-analysis ルートを登録中...');
      this.app.use('/api/market-analysis', marketAnalysisRoutes);

      // リアルタイムデータ配信（cTrader WebSocket → SSE）
      console.log('[App] /api/realtime ルートを登録中...');
      this.app.use('/api/realtime', realtimeRoutes);

      // 横断類似ノート検索（Side-A/Side-B統合）
      console.log('[App] /api/similarity ルートを登録中...');
      this.app.use('/api/similarity', similarityRoutes);

      // Cron エンドポイント（Cloud Run Cron用）
      console.log('[App] /api/cron ルートを登録中...');
      this.app.use('/api/cron', cronRoutes);

      console.log('[App] エラーハンドラーを登録中...');
      // グローバルエラーハンドラー: ルート内で発生した例外をキャッチしてサーバーを維持
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
        console.error('═══════════════════════════════════════');
        console.error('  Express エラーハンドラーがエラーをキャッチしました');
        console.error('═══════════════════════════════════════');
        console.error('URL:', req.method, req.url);
        console.error('Error:', err.message);
        console.error('Stack:', err.stack);
        console.error('═══════════════════════════════════════');

        res.status(500).json({
          error: 'Internal Server Error',
          message: config.server.isProduction ? 'サーバーエラーが発生しました' : err.message,
        });
      });

      // Next.js キャッチオール or 404: 本番では Next.js がFEリクエストを処理
      if (config.server.isProduction && this.nextHandler) {
        console.log('[App] Next.js キャッチオールハンドラーを登録中...');
        const handler = this.nextHandler;
        this.app.all('*', (req: Request, res: Response) => {
          handler(req, res);
        });
      } else {
        // 開発環境: FE は別ポートの Next.js dev server が担当
        console.log('[App] 404 ハンドラーを登録中...');
        this.app.use((req: Request, res: Response) => {
          res.status(404).json({ error: 'Route not found' });
        });
      }

      console.log('[App] ✅ ルート初期化完了');
    } catch (error) {
      console.error('═══════════════════════════════════════');
      console.error('  ルート初期化中にエラーが発生しました');
      console.error('═══════════════════════════════════════');
      console.error('Error:', error);
      console.error('═══════════════════════════════════════');
      throw error;
    }
  }

  /**
   * Next.js standalone サーバーを初期化（本番環境のみ）
   * standalone 出力の next/dist/server/next-server を直接ロードし、
   * Express のキャッチオールハンドラーとして使う
   */
  private async initializeNextJs(): Promise<void> {
    if (!config.server.isProduction) {
      console.log('[App] 開発環境: Next.js は別プロセスで動作（port 3102）');
      return;
    }

    console.log('[App] Next.js standalone サーバーを初期化中...');
    try {
      // 1. パスの定義
      const frontendDir = path.join(process.cwd(), 'frontend');
      console.log(`[App]   cwd: ${process.cwd()}`);
      console.log(`[App]   frontend dir exists: ${fs.existsSync(frontendDir)}`);
      console.log(`[App]   frontend/.next exists: ${fs.existsSync(path.join(frontendDir, '.next'))}`);

      // 2. NextServer クラスのロード
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NextServer = require('next/dist/server/next-server').default;

      // 3. 設定ファイルのロード (required-server-files.json)
      // Next.js 16 では conf に完全な設定が必要（runtimeServerDeploymentId 等）
      let nextConfig: Record<string, unknown> = {};
      const configPath = path.join(frontendDir, '.next/required-server-files.json');

      if (fs.existsSync(configPath)) {
        try {
          const serverFiles = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          nextConfig = serverFiles.config || {};
          console.log('[App]   required-server-files.json をロードしました');
        } catch (e) {
          console.error('[App]   ⚠️ 設定ファイルのパースに失敗:', e);
        }
      } else {
        console.warn(`[App]   ⚠️ 設定ファイルが見つかりません: ${configPath}`);
      }

      // 4. NextServer インスタンス化 (conf に完全な設定を渡す)
      const nextApp = new NextServer({
        dir: frontendDir,
        dev: false,
        conf: {
          ...nextConfig,
          distDir: '.next',
        },
      });

      this.nextHandler = nextApp.getRequestHandler();
      await nextApp.prepare();
      console.log('[App] ✅ Next.js standalone サーバー初期化完了');
      console.log(`[App]   dir: ${frontendDir}`);
    } catch (error) {
      console.error('[App] ⚠️ Next.js 初期化に失敗しました（APIのみで動作を継続）');
      console.error('[App] Error:', error);
      // Next.js が起動できなくても API は動作し続ける
    }
  }

  /**
   * Start the application
   */
  public async start(): Promise<void> {
    // 本番環境: Next.js を先に初期化
    await this.initializeNextJs();

    // Next.js 初期化後にルートを登録（キャッチオールハンドラーの有無が決まる）
    console.log('[App] ルートを初期化中...');
    this.initializeRoutes();

    const port = config.server.port;

    console.log('═══════════════════════════════════════');
    console.log('  TradeAssist Server Starting');
    console.log('═══════════════════════════════════════');
    console.log(`  PORT env: ${process.env.PORT}`);
    console.log(`  BACKEND_PORT env: ${process.env.BACKEND_PORT}`);
    console.log(`  Resolved port: ${port}`);
    console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`  Next.js: ${this.nextHandler ? 'integrated' : 'not available'}`);
    console.log('═══════════════════════════════════════');

    // サーバーインスタンスを保持してイベントループを維持
    try {
      this.server = this.app.listen(port, '0.0.0.0', () => {
        console.log('═══════════════════════════════════════');
        console.log('  TradeAssist Server STARTED');
        console.log('═══════════════════════════════════════');
        console.log(`  Environment: ${config.server.env}`);
        console.log(`  Server running on port: ${port}`);
        console.log(`  Match threshold: ${config.matching.threshold}`);
        console.log(`  Check interval: ${config.matching.checkIntervalMinutes} minutes`);
        console.log('═══════════════════════════════════════');
        console.log('\nAvailable endpoints:');
        console.log('  GET  /health');
        console.log('  GET  /api/auth/me');
        console.log('  POST /api/auth/logout');
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

        // Side-B スケジューラー起動: SIDE_B_SCHEDULER_ENABLED が true の場合のみ自動開始
        // 理由: AI取引は明示的に有効化する必要があるため、デフォルト無効
        const sideBEnabled = process.env.SIDE_B_SCHEDULER_ENABLED === 'true';
        if (sideBEnabled) {
          console.log('Side-B スケジューラーを自動開始します...');
          const sideBScheduler = getSideBScheduler({ enabled: true });
          sideBScheduler.start();
        } else {
          if (!config.server.isProduction) {
            console.log('Side-B スケジューラーはSIDE_B_SCHEDULER_ENABLEDがtrueの時のみ自動起動（UIから手動起動可能）');
          }
        }
      });

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        console.error('═══════════════════════════════════════');
        console.error('  サーバー起動エラー');
        console.error('═══════════════════════════════════════');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Port:', port);
        console.error('Stack:', error.stack);
        console.error('═══════════════════════════════════════');
        process.exit(1);
      });
    } catch (error) {
      console.error('═══════════════════════════════════════');
      console.error('  listen() 呼び出しエラー');
      console.error('═══════════════════════════════════════');
      console.error('Error:', error);
      console.error('═══════════════════════════════════════');
      process.exit(1);
    }
  }

  /**
   * Stop the application
   */
  public stop(): void {
    this.scheduler.stop();

    // Side-B スケジューラー停止
    const sideBScheduler = getSideBScheduler();
    sideBScheduler.stop();

    if (this.server) {
      this.server.close(() => {
        console.log('HTTPサーバーを正常に停止しました');
      });
    }
  }
}

export default App;
