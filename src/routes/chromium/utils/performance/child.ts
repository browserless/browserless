// @ts-ignore no types :/
import lighthouse from 'lighthouse';

import * as util from '../../../../utils.js';

import { Message, start } from './types.js';

const debug = util.createLogger('http:performance:child');

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
