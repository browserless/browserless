/*
 * content function
 *
 * Example invocation:
 *
 * content({
 *  page: await browser.newPage(),
 *  context: {
 *    url: 'https://example.com',
 *  },
 * });
 *
 * @param args - object - An object with a puppeteer page object, and context.
 * @param args.page - object - Puppeteer's page object (from await browser.newPage)
 * @param args.context - object - An object of parameters that the function is called with. See src/schemas.ts
 */
module.exports = async function content ({ page, context }) {
  const {
    url,
    gotoOptions,
    rejectRequestPattern,
    cookies,
  } = context;

  if (rejectRequestPattern.length) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (rejectRequestPattern.find((pattern) => req.url().match(pattern))) {
        return req.abort();
      }
      return req.continue();
    });
  }

  if (cookies.length) {
    await page.setCookie(...cookies);
  }

  await page.goto(url, gotoOptions);

  const data = await page.content();

  return {
    data,
    type: 'html'
  };
};
