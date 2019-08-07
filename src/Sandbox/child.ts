import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import { NodeVM } from 'vm2';

import { ILaunchOptions, launchChrome } from '../chrome-helper';
import { IMessage } from '../models/sandbox.interface';
import { ISandboxOpts } from '../models/sandbox.interface';
import { getDebug } from '../utils';

const debug = getDebug('sandbox');
type consoleMethods = 'log' | 'warn' | 'debug' | 'table' | 'info';

const send = (msg: IMessage) => {
  debug(`Sending parent message: ${JSON.stringify(msg)}`);

  if (process.send) {
    return process.send(msg);
  }

  throw new Error('Not running in a child process, closing');
};

const buildBrowserSandbox = (page: puppeteer.Page): { console: any } => {
  debug(`Generating sandbox console`);

  return {
    console: _.reduce(_.keys(console), (browserConsole: any, consoleMethod: consoleMethods) => {
      browserConsole[consoleMethod] = (...args: any[]) => {
        args.unshift(consoleMethod);
        return page.evaluate((...args: [consoleMethods, any]) => {
          const [consoleMethod, ...consoleArgs] = args;
          return console[consoleMethod](...consoleArgs);
        }, ...args);
      };

      return browserConsole;
    }, {}),
  };
};

const start = async (
  { code, opts, sandboxOpts }:
  { code: string; opts: ILaunchOptions, sandboxOpts: ISandboxOpts },
) => {
  debug(`Starting sandbox running code "${code}"`);

  const browser = await launchChrome(opts);
  const page: any = await browser.newPage();
  page.on('error', (error: Error) => {
    debug(`Page error: ${error.message}`);
    send({
      error: error.message,
      event: 'error',
    });
  });
  const pageLocation = `/devtools/page/${page._target._targetId}`;
  const port = browser._parsed.port;
  const data = {
    context: {
      port,
      url: pageLocation,
    },
    event: 'launched',
  };

  debug(`Browser launched on port ${port}`);

  send(data);

  const sandbox = buildBrowserSandbox(page);
  const vm: any = new NodeVM({
    require: sandboxOpts,
    sandbox,
  });
  const handler = vm.run(code);

  await handler({ page, context: {} });
};

process.on('message', (message) => {
  const { event } = message;

  if (event === 'start') {
    return start(message.context);
  }

  return;
});
