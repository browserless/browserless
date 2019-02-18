import * as fs from 'fs';
import { noop } from 'lodash';

const path = require('path');
const homeDir = require('os').homedir();
const rimraf = require('rimraf');

export const before = async ({ page }) => {
  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setBypassCSP(true);
};

export const after = async ({ page, jobId, res, done, debug }) => {
  const file = `${jobId}.webm`;
  const filePath = path.join(homeDir, 'Downloads', file);

  await page.evaluate((filename) => {
    window.postMessage({ type: 'SET_EXPORT_PATH', filename }, '*');
    window.postMessage({ type: 'REC_STOP' }, '*');
  }, file);

  debug(`Downloading screencast to "${filePath}"`);

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
