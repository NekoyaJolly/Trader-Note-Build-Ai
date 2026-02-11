import App from './app';

// 標準出力をフラッシュするヘルパー（Railway ログ遅延対策）
const log = (message: string) => {
  console.log(message);
};

const logError = (message: string) => {
  console.error(message);
};

log('═══════════════════════════════════════');
log('  TradeAssist Starting...');
log('═══════════════════════════════════════');
log(`  Node version: ${process.version}`);
log(`  Working directory: ${process.cwd()}`);
log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
log(`  Available env vars: ${Object.keys(process.env).filter(k => !k.includes('npm_') && !k.includes('PATH')).length} variables`);
log('═══════════════════════════════════════');

// グローバルエラーハンドリング: 未処理の例外でサーバーがクラッシュしないようにする
process.on('uncaughtException', (err: Error) => {
  logError('═══════════════════════════════════════');
  logError('  未処理の例外が発生しました');
  logError('═══════════════════════════════════════');
  logError(`Error: ${err.message}`);
  logError(`Stack: ${err.stack}`);
  logError('═══════════════════════════════════════');
  // 本番環境では致命的エラーの場合は終了する
  if (process.env.NODE_ENV === 'production') {
    logError('本番環境のため、プロセスを終了します');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logError('═══════════════════════════════════════');
  logError('  未処理のPromise Rejectが発生しました');
  logError('═══════════════════════════════════════');
  logError(`Reason: ${JSON.stringify(reason)}`);
  logError(`Promise: ${promise}`);
  logError('═══════════════════════════════════════');
  // 本番環境では致命的エラーの場合は終了する
  if (process.env.NODE_ENV === 'production') {
    logError('本番環境のため、プロセスを終了します');
    process.exit(1);
  }
});

let application: App;

try {
  log('App インスタンスを作成中...');
  application = new App();
  log('App インスタンス作成完了、サーバーを起動中...');
  // start() は async（Next.js 初期化を含む）
  application.start().then(() => {
    log('サーバー起動処理が完了しました');
    log('✅ TradeAssist アプリケーション起動成功');
  }).catch((err: unknown) => {
    logError('═══════════════════════════════════════');
    logError('  アプリケーション起動エラー (async)');
    logError('═══════════════════════════════════════');
    logError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error) {
      logError(`Stack: ${err.stack}`);
    }
    logError('═══════════════════════════════════════');
    process.exit(1);
  });
} catch (err) {
  logError('═══════════════════════════════════════');
  logError('  アプリケーション起動エラー');
  logError('═══════════════════════════════════════');
  logError(`Error: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error) {
    logError(`Stack: ${err.stack}`);
  }
  logError('═══════════════════════════════════════');
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM signal received: closing application');
  if (application) {
    application.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT signal received: closing application');
  if (application) {
    application.stop();
  }
  process.exit(0);
});
