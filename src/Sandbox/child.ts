import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import { NodeVM } from 'vm2';

import { launchChrome } from '../chrome-helper';
import { getDebug } from '../utils';

import {
  ILaunchOptions,
  IMessage,
  ISandboxOpts,
  consoleMethods,
} from '../types';

const debug = getDebug('sandbox');

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

  process.on('unhandledRejection', (error) => {
    debug(`uncaughtException error: ${error}`);
    send({
      error: JSON.stringify(error),
      event: 'error',
    });
  });

  const browser = await launchChrome(opts, false);
  const page = await browser.newPage();

  page.on('error', (error: Error) => {
    debug(`Page error: ${error.message}`);
    send({
      error: error.message,
      event: 'error',
    });
  });

  page.on('request', (request) => {
    if (request.url().startsWith('file://')) {
      page.browser().close();
    }
  });

  page.on('response', (response) => {
    if (response.url().startsWith('file://')) {
      page.browser().close();
    }
  });

  // @ts-ignore
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
