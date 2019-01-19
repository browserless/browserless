import * as fs from 'fs';
const path = require('path');
const homeDir = require('os').homedir();

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
    fs.unlinkSync(filePath);
    return done();
  }

  res.type('video/webm');

  const stream = fs.createReadStream(filePath);

  stream.pipe(res);

  debug(`Streaming screencast "${file}" to client`);

  return stream
    .on('error', (error) => {
      debug(`Error streaming screencast "${file}": ${error}`);
      fs.unlinkSync(filePath);
      done(error);
    })
    .on('end', () => {
      debug(`Screencast "${file}" is done streaming, deleting and closing job.`);
      fs.unlinkSync(filePath);
      done();
    });
};
