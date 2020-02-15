import * as fs from 'fs';
import { noop } from 'lodash';
import {
  IAfter,
  IBefore,
  IPreferences,
} from '../types';

const rimraf = require('rimraf');

export const before = async ({ page, code, debug }: IBefore) => {
  let prefs: IPreferences;

  const startScreencast = () => page.evaluate(() => window.postMessage({ type: 'REC_START' }, '*'));
  const stopScreencast = () => page.evaluate(() => window.postMessage({ type: 'REC_STOP' }, '*'));
  const setPreferences = (preferences: IPreferences) => prefs = preferences;

  const setupScreencast = () => page.evaluate(
    (viewport) => {
      const { height, width } = JSON.parse(viewport);
      return window.postMessage({
        height,
        type: 'REC_CLIENT_SETUP',
        width,
      }, '*');
    },
    JSON.stringify(page.viewport()),
  );

  page.on('load', async () => {
    if (prefs) {
      debug(`Injecting preferences: ${JSON.stringify(prefs, null, '  ')}`);
      await page.evaluate(
        (prefs) => window.postMessage({
          prefs: JSON.parse(prefs),
          type: 'SET_PREFERENCES',
        }, '*'),
        JSON.stringify(prefs),
      );
    }

    debug(`Setting up screencast`);
    await setupScreencast();

    if (!code.includes('startScreencast')) {
      debug(`Starting to record`);
      setTimeout(startScreencast, 0);
    }
  });

  return {
    setPreferences,
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
