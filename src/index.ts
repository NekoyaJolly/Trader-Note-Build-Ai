import App from './app';

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
