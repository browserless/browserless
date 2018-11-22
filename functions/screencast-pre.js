const Xvfb = require('xvfb');
const xvfb = new Xvfb();
xvfb.startSync();

module.exports = async function setupScreencast ({ page }) {
  await page._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: __dirname,
  });
  await page._client.send('Emulation.clearDeviceMetricsOverride')
  await page.setBypassCSP(true);
};
