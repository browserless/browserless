import fs from 'fs/promises';

import playwright from 'playwright-core';
import puppeteer from 'puppeteer-core';

(async () => {
  const browser = await puppeteer.launch({
    args: [`--no-sandbox`],
    executablePath: playwright.chromium.executablePath(),
    pipe: true,
  });
  const [page] = await browser.pages();
  const client = await page.target().createCDPSession();
  const res = await client.send('Browser.getVersion');
  const webKitVersion = res.userAgent.match(/AppleWebKit\/(\d+(\.\d+)*) /);

  if (!webKitVersion || !webKitVersion[1]) {
    throw new Error(
      `Error finding WebKit Version from user agent "${res.userAgent}"`,
    );
  }

  const payload = JSON.stringify(
    {
      Browser: res.product,
      'Protocol-Version': res.protocolVersion,
      'User-Agent': res.userAgent,
      'WebKit-Version': `${webKitVersion[1]} (${res.revision})`,
      webSocketDebuggerUrl: 'ws://localhost:3000',
    },
    null,
    '  ',
  );

  await fs.writeFile('browser.json', payload);

  return browser.close();
})();
