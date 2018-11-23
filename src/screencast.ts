import * as fs from 'fs';
const path = require('path');
const homeDir = require('os').homedir();

export const before = async ({ page }) => {
  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setBypassCSP(true);
};

export const after = async ({ page, jobId, res, done }) => {
  const file = `${jobId}.webm`;
  const filePath = path.join(homeDir, 'Downloads', file);

  await page.evaluate((filename) => {
    window.postMessage({ type: 'SET_EXPORT_PATH', filename }, '*');
    window.postMessage({ type: 'REC_STOP' }, '*');
  }, file);

  await page.waitForSelector('html.downloadComplete', { timeout: 0 });

  if (fs.existsSync) {
    throw new Error(`Couldn't locate screencast file "${filePath}"`);
  }

  if (res.headersSent) {
    fs.unlinkSync(filePath);
    return done();
  }

  res.type('video/webm');

  const stream = fs.createReadStream(filePath);

  stream.pipe(res);

  return stream
    .on('error', (error) => {
      fs.unlinkSync(filePath);
      done(error);
    })
    .on('end', () => {
      fs.unlinkSync(filePath);
      done();
    });
};
