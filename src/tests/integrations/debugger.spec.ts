import { expect } from 'chai';
import fetch from 'node-fetch';

import { BrowserlessServer } from '../../browserless';
import { IBrowserlessOptions } from '../../types.d';

import { defaultParams } from './utils';

describe('Browserless Debugger', () => {
  let browserless: BrowserlessServer;
  const start = (args: IBrowserlessOptions) =>
    (browserless = new BrowserlessServer(args));

  afterEach(async () => {
    await browserless.kill();
  });

  it('serves the debugger page', async () => {
    const params = defaultParams();
    const browserless = start(params);
    await browserless.startServer();

    return fetch(`http://127.0.0.1:${params.port}/`).then((res) =>
      expect(res.headers.get('content-type')).to.contain('text/html'),
    );
  });
});
