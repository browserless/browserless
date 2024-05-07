import { Message, start } from './types.js';
import { Logger } from '@browserless.io/browserless';
import lighthouse from 'lighthouse';

const logger = new Logger('http:performance:child');

logger.info(`Child init`);

const send = (msg: Message) => process.send && process.send(msg);

const start = async ({ url, config, options }: start) => {
  try {
    logger.info(`Child got payload, starting lighthouse`);
    const results = await lighthouse(url, options, config);

    send({
      data: results?.lhr,
      event: 'complete',
    });
  } catch (error: unknown) {
    send({
      error,
      event: 'error',
    });
  }
};

process.on('message', (payload) => {
  const { event } = payload as { event: string };

  if (event === 'start') {
    return start(payload as start);
  }

  return;
});

send({ event: 'created' });
