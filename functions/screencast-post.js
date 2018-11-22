const fs = require('fs');

module.exports = async function setupScreencast ({ page }) {
  await page.evaluate((filename) => {
    window.postMessage({ type: 'SET_EXPORT_PATH', filename }, '*');
    window.postMessage({ type: 'REC_STOP' }, '*');
  }, 'temp.webm');

  // Wait for download of webm to complete
  await page.waitForSelector('html.downloadComplete', { timeout: 0 });

  return {
    type: 'video/webm',
    data: fs.readFileSync(__dirname + '/temp.webm')
  }
};
