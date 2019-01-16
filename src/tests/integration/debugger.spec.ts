import { BrowserlessServer } from '../../browserless-web-server';
import {
  defaultParams,
  killChrome,
} from './utils';

const fetch = require('node-fetch');

describe('Browserless Debugger', () => {
  let browserless: BrowserlessServer;
  const start = (args) => browserless = new BrowserlessServer(args);

  afterEach(async () => {
    await browserless.kill();

    return killChrome();
  });

  it('serves the debugger page', async () => {
    const params = defaultParams();
    const browserless = start(params);
    await browserless.startServer();

    return fetch(`http://localhost:${params.port}/`)
      .then((res) =>
        expect(res.headers.get('content-type')).toContain('text/html'),
      );
  });
});
