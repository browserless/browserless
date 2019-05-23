import { Response } from 'express';
import * as fs from 'fs';
import { noop } from 'lodash';
import { Page } from 'puppeteer';

const rimraf = require('rimraf');

interface IBefore {
  page: Page;
  code: string;
}

interface IAfter {
  page: Page;
  res: Response;
  done: (err?: Error) => any;
  debug: (message: string) => any;
  code: string;
  stopScreencast: () => void;
}

export const before = async ({ page, code }: IBefore) => {
  const startScreencast = async () =>
    page.evaluate(() => window.postMessage({
      data: {
        url: window.location.origin,
      },
      type: 'REC_CLIENT_PLAY',
    }, '*'));

  const stopScreencast = () => page.evaluate(() => window.postMessage({ type: 'REC_STOP' }, '*'));

  if (!code.includes('startScreencast')) {
    page.on('load', startScreencast);
  }

  return {
    startScreencast,
    stopScreencast,
  };
};

export const after = async ({ page, res, done, debug, code, stopScreencast }: IAfter) => {
  if (!code.includes('stopScreencast')) {
    await stopScreencast();
  }

  await page.waitForSelector('html.downloadComplete', { timeout: 0 });
  const filePath = await page.evaluate(() => document.querySelector('html')!.getAttribute('data-filepath'));

  debug(`Screencast download "${filePath}" complete!`);

  if (!filePath || !fs.existsSync(filePath)) {
    debug(`Couldn't located screencast in the filesystem at "${filePath}"`);
    throw new Error(`Couldn't locate screencast file "${filePath}"`);
  }

  if (res.headersSent) {
    rimraf(filePath, noop);
    return done();
  }

  return res.sendFile(filePath, (err: Error) => {
    const message = err ?
      `Error streaming file back ${err}` :
      `File sent successfully`;

    debug(message);
    rimraf(filePath, noop);

    done(err);
  });
};
