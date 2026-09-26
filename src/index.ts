import {
  Browserless,
  InvalidConfig,
  Logger,
} from '@browserless.io/browserless';

(async () => {
  const browserless = new Browserless();
  const logger = new Logger('index.js');
  let exitCode = 0;
  browserless.start().catch((err) => {
    // Only invalid config fails the process; anything else keeps the
    // existing unhandled-rejection behavior.
    if (!(err instanceof InvalidConfig)) throw err;
    // console.error, not the logger: DEBUG can silence the logger.
    console.error(`Failed to start: ${err.message}`);
    exitCode = 1;
    process.exit(exitCode);
  });

  process
    .on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    })
    .once('uncaughtException', async (err, origin) => {
      console.error('Unhandled exception at:', origin, 'error:', err);
      await browserless.stop();
      process.exit(1);
    })
    .once('SIGTERM', async () => {
      logger.info(`SIGTERM received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('SIGINT', async () => {
      logger.info(`SIGINT received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('SIGHUP', async () => {
      logger.info(`SIGHUP received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('SIGUSR2', async () => {
      logger.info(`SIGUSR2 received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('exit', () => {
      logger.info(`Process is finished, exiting`);
      process.exit(exitCode);
    });
})();
