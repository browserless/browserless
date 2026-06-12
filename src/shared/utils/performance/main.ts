import { Message, mainOptions } from './types.js';
import { Timeout } from '@browserless.io/browserless';
import { fork } from 'child_process';
import path from 'path';

const __dirname = import.meta.dirname;
const DEFAULT_AUDIT_CONFIG = {
  extends: 'lighthouse:default',
};

export default async ({
  browser,
  context,
  logger,
  timeout,
}: mainOptions): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const childPath = path.join(__dirname, 'child.js');

    logger.trace(`Starting up child at ${childPath}`);

    const child = fork(childPath);
    const port = new URL(browser.wsEndpoint() || '').port;

    let closed = false;
    let timeoutId =
      timeout !== -1
        ? setTimeout(() => {
            close(child.pid);
            // Settle the promise — without this a timed-out run hangs the
            // request until the global limiter timeout.
            reject(new Timeout(`Performance run timed out after ${timeout}ms`));
          }, timeout)
        : null;

    const close = (pid?: number) => {
      if (closed) return;
      closed = true;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      if (pid) {
        // The child may have already exited; ESRCH here would otherwise be
        // an uncaught exception inside a timer callback.
        try {
          process.kill(pid, 'SIGINT');
        } catch {
          // Process already gone
        }
      }
    };

    // A child killed externally (OOM, SIGKILL) never sends 'complete' or
    // 'error' — settle instead of hanging the request.
    child.on('exit', (code) => {
      if (!closed) {
        close();
        reject(
          new Error(
            `Performance child process exited unexpectedly with code ${code}`,
          ),
        );
      }
    });

    const { url, config = DEFAULT_AUDIT_CONFIG, budgets } = context;

    const options = {
      budgets,
      logLevel: 'info',
      output: 'json',
      port,
    };

    child.on('error', (err) => {
      logger.error(`Error in child process`, err);
      reject('Performance run error: ' + err.message);
      close(child.pid);
    });

    child.on('message', (payload: Message) => {
      if (payload.event === 'created') {
        logger.debug(`Child process is up, sending performance request`);
        return child.send({
          config,
          event: 'start',
          options,
          url,
        });
      }

      if (payload.event === 'complete') {
        logger.debug(`Performance gathered, closing and resolving request`);
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
