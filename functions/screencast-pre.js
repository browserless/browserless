const Xvfb = require('xvfb');

module.exports = async function setupScreencast ({ page }) {
  const xvfb = new Xvfb({ silent: true });
  xvfb.startSync();
  await page._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: __dirname,
  });
  await page._client.send('Emulation.clearDeviceMetricsOverride')
  await page.setBypassCSP(true);

  return xvfb;
};
