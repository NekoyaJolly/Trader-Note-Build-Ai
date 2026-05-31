import type { Application, Request, Response, NextFunction } from 'express';
import express from 'express';
import type { Server } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import tradeRoutes from './backend/api/tradeRoutes';
import matchingRoutes from './backend/api/matchingRoutes';
import notificationRoutes from './backend/api/notificationRoutes';
import orderRoutes from './backend/api/orderRoutes';
import indicatorRoutes from './backend/api/indicatorRoutes';
import backtestRoutes from './backend/api/backtestRoutes';
import settingsRoutes from './backend/api/settingsRoutes';
import barLocatorRoutes from './backend/api/barLocatorRoutes';
import strategyRoutes from './backend/api/strategyRoutes';
import strategyComparisonRoutes from './backend/api/strategyComparisonRoutes';
import patternAnalysisRoutes from './backend/api/patternAnalysisRoutes';
import watchlistRoutes from './backend/api/watchlistRoutes';
import pushRoutes from './backend/api/pushRoutes';
import ohlcvRoutes from './backend/api/ohlcvRoutes';
import profileRoutes from './backend/api/profileRoutes';
import { sideBRoutes } from './side-b/routes';
import cronRoutes from './backend/api/cronRoutes';
import ctraderAuthRoutes from './backend/api/ctraderAuthRoutes';
import tradingRoutes from './backend/api/tradingRoutes';
import chartDrawingsRoutes from './backend/api/chartDrawingsRoutes';
import marketAnalysisRoutes from './backend/api/marketAnalysisRoutes';
import realtimeRoutes from './backend/api/realtimeRoutes';
import similarityRoutes from './backend/api/similarityRoutes';
import { MatchingScheduler } from './utils/scheduler';
import { getSideBScheduler } from './side-b/jobs/sideBScheduler';

/**
 * TradeAssist Application
 */
class App {
  public app: Application;
  private scheduler: MatchingScheduler;
  private server: Server | null = null;

  constructor() {
    console.log('[App] コンストラクタ開始');
    this.app = express();
    this.scheduler = new MatchingScheduler();
    // 2026-05-24 (PR #250 Copilot review #1): Cloud Run / LB 配下で req.ip を正しく
    // 取得するため trust proxy を有効化。`1` = 1 hop の proxy (= Cloud Run のフロント
    // プロキシ) を信頼し、X-Forwarded-For の最初の値を req.ip として採用する。
    // これにより express-rate-limit の keyGenerator (= 既定 req.ip) がクライアント
    // 単位で正しく動作する。
    this.app.set('trust proxy', 1);
    console.log('[App] ミドルウェアを初期化中...');
    this.initializeMiddlewares();
    // ルート初期化は start() で行う（Next.js ハンドラーの準備を待つため）
    console.log('[App] コンストラクタ完了');
  }

  /**
   * Initialize middlewares
   */
  private initializeMiddlewares(): void {
    // 2026-05-24: セキュリティヘッダー (helmet)。memory `feedback_codebase_review_skill.md`
    // で「最低品質ゲート」として追加。CSP は frontend (Next.js + lightweight-charts +
    // last-mile-context) の inline script / eval を一部許容するため、開発時は緩めて
    // 本番では NEXT 標準 nonce ベース CSP に頼る方針 (= ここでは contentSecurityPolicy=false)。
    // X-Frame-Options / X-Content-Type-Options / Strict-Transport-Security 等の標準ヘッダーは付ける。
    console.log('[App] helmet セキュリティヘッダーを設定中...');
    this.app.use(
      helmet({
        // Phase 1: CSP は Next.js 側で管理 (= express 側で二重定義しない)
        contentSecurityPolicy: false,
        // 同一オリジン埋め込みは許可 (= TradeAssist 自身の iframe / SSR 想定)
        crossOriginEmbedderPolicy: false,
        // strict CORS 既定で同一オリジン以外からの埋め込みを拒否、ただし opener は許可
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      }),
    );

    console.log('[App] CORS設定を初期化中...');
    // CORS設定: 開発環境と Vercel デプロイの両方を許可
    // 本番 Cloud Run 統合の同一オリジンリクエストは origin=undefined で自動許可
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3102',
      'https://trader-note-build-ai.vercel.app',
      // 環境変数で追加オリジンを指定可能（カンマ区切り）
      ...(process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || []),
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
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

      // Health check
      console.log('[App] /health エンドポイントを登録中...');
      this.app.get('/health', (req: Request, res: Response) => {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          schedulerRunning: this.scheduler.isSchedulerRunning(),
        });
      });

      // 2026-05-24 (PR #250): auth route に rate-limit を適用 (= ログイン試行 / OAuth
      // callback 連打防止)。memory `feedback_codebase_review_skill.md` で P1「helmet +
      // rate-limit 導入」として追加。
      //
      // 制限: 15 分窓で 30 req/IP (= keyGenerator は既定で req.ip、trust proxy=1 で
      // X-Forwarded-For 解釈済み)。
      //
      // **既知の制約 (PR #250 Copilot review #2 対応の明文化)**: 本実装は MemoryStore
      // を使うため、Cloud Run の水平スケール (= 複数インスタンス) 時はインスタンス間で
      // rate-limit が分断される (= 1 インスタンス 30 req/15min を回避すれば、N インスタンス
      // で 30N req/15min まで通過可能)。攻撃側並列回避を完全に防ぐには共有 store
      // (= Redis 等) または Cloud Armor 等のエッジ側 rate-limit が必要。
      // 本 PR は **best-effort の最低品質ゲート** として位置付け、本格 rate-limit は
      // 別 PR (= Redis store 導入 or Cloud Armor 設定) で扱う。
      const authRateLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many auth requests, try again later' },
      });

      // API routes
      // cTrader OAuth 認証ルート（認証不要、rate-limit 適用）
      console.log('[App] /api/auth ルートを登録中 (rate-limit 適用)...');
      this.app.use('/api/auth', authRateLimiter, ctraderAuthRoutes);

      // トレーディングルート（認証必須）
      console.log('[App] /api/trading ルートを登録中...');
      this.app.use('/api/trading', tradingRoutes);

      // チャート描画データ同期（認証必須）
      console.log('[App] /api/chart-drawings ルートを登録中...');
      this.app.use('/api/chart-drawings', chartDrawingsRoutes);

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

      // 404 ハンドラー: FE は Vercel で別途ホスティング
      console.log('[App] 404 ハンドラーを登録中...');
      this.app.use((req: Request, res: Response) => {
        res.status(404).json({ error: 'Route not found' });
      });

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
   * Start the application
   */
  public start(): Promise<void> {
    // ルートを初期化
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
    console.log(`  Mode: API-only (FE is hosted on Vercel)`);
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

    return Promise.resolve();
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
