import * as fs from 'fs';
import { noop } from 'lodash';

const rimraf = require('rimraf');

export const before = async ({ page, code }) => {

  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setBypassCSP(true);

  const startScreencast = () => page.evaluate(() =>
    window.postMessage({
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

export const after = async ({ page, res, done, debug, code, stopScreencast }) => {
  if (!code.includes('stopScreencast')) {
    await stopScreencast();
  }

  await page.waitForSelector('html.downloadComplete', { timeout: 0 });
  const filePath = await page.evaluate(() => document.querySelector('html')!.getAttribute('data-filepath'));

  debug(`Screencast download "${filePath}" complete!`);

  if (!fs.existsSync(filePath)) {
    debug(`Couldn't located screencast in the filesystem at "${filePath}"`);
    throw new Error(`Couldn't locate screencast file "${filePath}"`);
  }

  if (res.headersSent) {
    rimraf(filePath, noop);
    return done();
  }

  return res.sendFile(filePath, (err) => {
    const message = err ?
      `Error streaming file back ${err}` :
      `File sent successfully`;

    debug(message);
    rimraf(filePath, noop);

    done(err);
  });
};
