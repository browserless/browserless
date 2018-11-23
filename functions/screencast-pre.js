module.exports = async function setupScreencast ({ page }) {
  await page._client.send('Emulation.clearDeviceMetricsOverride')
  await page.setBypassCSP(true);
};
