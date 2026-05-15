import App from './app';

// 標準出力をフラッシュするヘルパー
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

// Node の unhandledRejection ハンドラは (reason, promise) のシグネチャが固定で
// reason の型は何でも入りうるため Error | string | object と JSON 化可能な広い具体型で受ける。
// promise 側はログ用途で型タグを取るだけなので Promise<void> で十分。
type RejectionReason = Error | string | number | boolean | null | object;
process.on('unhandledRejection', (reason: RejectionReason, promise: Promise<void>) => {
  logError('═══════════════════════════════════════');
  logError('  未処理のPromise Rejectが発生しました');
  logError('═══════════════════════════════════════');
  logError(`Reason: ${JSON.stringify(reason)}`);
  // Promise オブジェクトを直接 template literal に埋め込むと '[object Object]' になり
  // 暗黙の toString 警告が出るため、型タグを明示的に取得する
  logError(`Promise: ${Object.prototype.toString.call(promise)}`);
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
  }).catch((err: Error | string | object | null) => {
    logError('═══════════════════════════════════════');
    logError('  アプリケーション起動エラー (async)');
    logError('═══════════════════════════════════════');
    // object 系を直接 template literal に埋め込むと '[object Object]' になるため
    // JSON.stringify で構造化文字列に変換する。
    const errStr =
      err instanceof Error ? err.message
      : typeof err === 'string' ? err
      : err === null ? 'null'
      : JSON.stringify(err);
    logError(`Error: ${errStr}`);
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
