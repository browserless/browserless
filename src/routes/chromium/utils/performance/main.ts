import { fork } from 'child_process';
import path from 'path';

import * as util from '../../../../utils.js';

import { Message, mainOptions } from './types.js';

const DEFAULT_AUDIT_CONFIG = {
  extends: 'lighthouse:default',
};

const debug = util.createLogger('http:performance:main');

export default async ({
  browser,
  context,
  timeout,
}: mainOptions): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const childPath = path.join(
      './',
      'build',
      'routes',
      'chromium',
      'utils',
      'performance',
      'child.js',
    );

    debug(`Starting up child at ${childPath}`);

    const child = fork(childPath);
    const port = new URL(browser.wsEndpoint() || '').port;

    let closed = false;
    let timeoutId =
      timeout !== -1
        ? setTimeout(() => {
            close(child.pid);
          }, timeout)
        : null;

    const close = (pid?: number) => {
      if (closed) return;
      if (pid) process.kill(pid, 'SIGINT');
      timeoutId && clearTimeout(timeoutId);
      closed = true;
      timeoutId = null;
    };

    const { url, config = DEFAULT_AUDIT_CONFIG, budgets } = context;

    const options = {
      budgets,
      logLevel: 'info',
      output: 'json',
      port,
    };

    child.on('error', (err) => {
      debug(`Error in child process`, err);
      reject('Performance run error: ' + err.message);
      close(child.pid);
    });

    child.on('message', (payload: Message) => {
      if (payload.event === 'created') {
        debug(`Child process is up, sending performance request`);
        return child.send({
          config,
          event: 'start',
          options,
          url,
        });
      }

      if (payload.event === 'complete') {
        debug(`Performance gathered, closing and resolving request`);
        close(child.pid);
        return resolve({
          data: payload.data,
          type: 'json',
        });
      }

      if (payload.event === 'error') {
        close(child.pid);
        reject(new Error('Error running performance metrics ' + payload.error));
      }
    });
  });
};
