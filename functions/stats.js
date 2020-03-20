const path = require('path');
const { fork } = require('child_process');
const kill = require('tree-kill');

const DEFAULT_AUDIT_CONFIG = {
  extends: 'lighthouse:default'
};

module.exports = async ({ browser, context, timeout }) => {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'functions', 'stats-child'));
    const port = browser._parsed.port;

    let closed = false;
    let timeoutId = timeout !== -1 ?
      setTimeout(() => {
        close(child.pid);
      }, timeout) :
      null;

    const close = (pid) => {
      if (closed) return;
      timeoutId && clearTimeout(timeoutId);
      kill(pid, 'SIGKILL');
      closed = true;
      timeoutId = null;
    };

    const {
      url,
      config = DEFAULT_AUDIT_CONFIG,
      budgets
    } = context;

    const options = {
      port,
      output: 'json',
      logLevel: 'info',
    };

    if (budgets) {
      options.budgets = budgets;
    }

    child.send({
      event: 'start',
      url,
      config,
      options,
    });

    child.on('error', (err) => {
      reject('stats error: ', err.message);
      close(child.pid);
    });

    child.on('message', (payload) => {
      close(child.pid);

      if (payload.event === 'complete') {
        return resolve({
          data: payload.data,
          type: 'json',
        });
      }

      if (payload.event === 'error') {
        reject(new Error('stats error: ', payload.error));
      }
    });
  });
};
