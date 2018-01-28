import * as puppeteer from 'puppeteer';

import { Chrome, opts } from '../Chrome';

const fetch = require('node-fetch');

const defaultParams: opts = {
  port: 3000,
  maxConcurrentSessions: 1,
  maxQueueLength: 1,
  connectionTimeout: 5,
  debugConnectionTimeout: 1000,
  logActivity: false,
};

describe('browserless/chrome', () => {
  let chrome = null;

  beforeAll(async(done) => {
    chrome = await new Chrome(defaultParams);
    const server = await chrome.startServer();
    server.on('listening', done);
  });

  afterAll((done) => {
    chrome.close();
    setTimeout(done, 0);
  });

  it('should expose a debugger UI', async() => {
    const res = await fetch(`http://127.0.0.1:${defaultParams.port}`);

    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('should expose the /json endpoint', async() => {
    const res = await fetch(`http://127.0.0.1:${defaultParams.port}/json`);
    const body = await res.json();

    expect(body).toBeInstanceOf(Array);
  });

  it('should expose the /json/version endpoint', async() => {
    const res = await fetch(`http://127.0.0.1:${defaultParams.port}/json/version`);
    const body = await res.json();

    expect(body).toHaveProperty('Browser');
    expect(body).toHaveProperty('Protocol-Version');
    expect(body).toHaveProperty('Puppeteer-Version');
    expect(body).toHaveProperty('WebKit-Version');
    expect(body).toHaveProperty('User-Agent');
  });

  it('should allow remote connections', async() => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${defaultParams.port}`
    });
    expect(browser).toBeTruthy();
    browser.close();
  });
});
