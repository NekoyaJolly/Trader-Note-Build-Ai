import App from './app';

// グローバルエラーハンドリング: 未処理の例外でサーバーがクラッシュしないようにする
process.on('uncaughtException', (error: Error) => {
  console.error('═══════════════════════════════════════');
  console.error('  未処理の例外が発生しました');
  console.error('═══════════════════════════════════════');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('═══════════════════════════════════════');
  // 本番環境では再起動が必要な場合もあるが、開発中はサーバーを維持
  // process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('═══════════════════════════════════════');
  console.error('  未処理のPromise Rejectが発生しました');
  console.error('═══════════════════════════════════════');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('═══════════════════════════════════════');
  // サーバーを維持（クラッシュさせない）
});

const application = new App();
application.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing application');
  application.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing application');
  application.stop();
  process.exit(0);
});
