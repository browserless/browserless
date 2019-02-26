import * as fs from 'fs';
import { noop } from 'lodash';

const path = require('path');
const homeDir = require('os').homedir();
const rimraf = require('rimraf');

export const before = async ({ page, jobId, code }) => {
  const file = `${jobId}.webm`;
  const filePath = path.join(homeDir, 'Downloads', file);

  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setBypassCSP(true);

  const startScreencast = () => page.evaluate(() =>
    window.postMessage({
      data: {
        url: window.location.origin,
      },
      type: 'REC_CLIENT_PLAY',
    }, '*'));

  const stopScreencast = () =>
    page.evaluate((filename) => {
      window.postMessage({ type: 'SET_EXPORT_PATH', filename }, '*');
      window.postMessage({ type: 'REC_STOP' }, '*');
    }, file);

  if (!code.includes('startScreencast')) {
    await startScreencast();
  }

  return {
    filePath,
    startScreencast,
    stopScreencast,
  };
};

export const after = async ({ page, filePath, res, done, debug, code, stopScreencast }) => {
  if (!code.includes('stopScreencast')) {
    await stopScreencast();
  }

  await page.waitForSelector('html.downloadComplete', { timeout: 0 });

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
