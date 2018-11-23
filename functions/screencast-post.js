const fs = require('fs');
const homeDir = require('os').homedir();
const shortid = require('shortid');

module.exports = async function setupScreencast ({ page }) {
  const file = shortid.generate() + '.webm';

  await page.evaluate((filename) => {
    window.postMessage({ type: 'SET_EXPORT_PATH', filename }, '*');
    window.postMessage({ type: 'REC_STOP' }, '*');
  }, file);

  // Wait for download of webm to complete
  await page.waitForSelector('html.downloadComplete', { timeout: 0 });

  return {
    type: 'video/webm',
    data: fs.readFileSync(path.join(homeDir, 'Downloads', file)),
  }
};
