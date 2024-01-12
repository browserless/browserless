import { Message, start } from './types.js';
import { createLogger } from '@browserless.io/browserless';
import lighthouse from 'lighthouse';

const debug = createLogger('http:performance:child');

debug(`Child init`);

const send = (msg: Message) => process.send && process.send(msg);

const start = async ({ url, config, options }: start) => {
  try {
    debug(`Child got payload, starting lighthouse`);
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
