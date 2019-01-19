import { noop } from 'lodash';
import * as path from 'path';
import {
  downloadDir,
  id,
  mkdir,
  readdir,
  sleep,
} from '../utils';

const rimraf = require('rimraf');

export const before = async ({ page }) => {
  const downloadPath = path.join(downloadDir, `.browserless.download.${id()}`);
  await mkdir(downloadPath);

  await page._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
  });

  return { downloadPath };
};

export const after = async (
  { downloadPath, debug, res, done }:
  { downloadPath: string, debug: (...args) => {}, res: any, done: (errBack?: Error | null) => {} },
) => {
  debug(`Waiting for download to finish in ${downloadPath}`);

  async function checkIfDownloadComplete() {
    if (res.headersSent) {
      return null;
    }
    const [ fileName ] = await readdir(downloadPath);
    if (!fileName || fileName.endsWith('.crdownload')) {
      await sleep(500);
      return checkIfDownloadComplete();
    }

    debug(`All files have finished downloading`);

    return path.join(downloadPath, fileName);
  }

  const filePath = await checkIfDownloadComplete();

  if (res.headersSent || !filePath) {
    rimraf(downloadPath, noop);
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
