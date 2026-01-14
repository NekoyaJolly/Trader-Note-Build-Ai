import App from './app';

console.log('═══════════════════════════════════════');
console.log('  TradeAssist Starting...');
console.log('═══════════════════════════════════════');
console.log(`  Node version: ${process.version}`);
console.log(`  Working directory: ${process.cwd()}`);
console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
console.log('═══════════════════════════════════════');

// グローバルエラーハンドリング: 未処理の例外でサーバーがクラッシュしないようにする
process.on('uncaughtException', (error: Error) => {
  console.error('═══════════════════════════════════════');
  console.error('  未処理の例外が発生しました');
  console.error('═══════════════════════════════════════');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('═══════════════════════════════════════');
  // 本番環境では致命的エラーの場合は終了する
  if (process.env.NODE_ENV === 'production') {
    console.error('本番環境のため、プロセスを終了します');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('═══════════════════════════════════════');
  console.error('  未処理のPromise Rejectが発生しました');
  console.error('═══════════════════════════════════════');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('═══════════════════════════════════════');
  // 本番環境では致命的エラーの場合は終了する
  if (process.env.NODE_ENV === 'production') {
    console.error('本番環境のため、プロセスを終了します');
    process.exit(1);
  }
});

let application: App;

try {
  console.log('App インスタンスを作成中...');
  application = new App();
  console.log('App インスタンス作成完了、サーバーを起動中...');
  application.start();
  console.log('サーバー起動処理が完了しました');
} catch (error) {
  console.error('═══════════════════════════════════════');
  console.error('  アプリケーション起動エラー');
  console.error('═══════════════════════════════════════');
  console.error('Error:', error);
  console.error('═══════════════════════════════════════');
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing application');
  if (application) {
    application.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing application');
  if (application) {
    application.stop();
  }
  process.exit(0);
});
