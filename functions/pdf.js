/*
 * pdf function
 *
 * Example invocation:
 *
 * pdf({
 *  page: await browser.newPage(),
 *  context: {
 *    url: 'https://example.com',
 *    html: '<div>example</div>
 *    options: {
 *      ...
 *      see https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions for available options
 *    }
 *  },
 * });
 *
 * @param args - object - An object with a puppeteer page object, and context.
 * @param args.page - object - Puppeteer's page object (from await browser.newPage)
 * @param args.context - object - An object of parameters that the function is called with. See src/schemas.ts
 */
module.exports = async function pdf({ page, context }) {
  const { url, html, options } = context;

  if (url != null) {
    await page.goto(url);
  } else {
    // Whilst there is no way of waiting for all requests to finish with setContent,
    // you can simulate a webrequest this way
    // see issue for more details: https://github.com/GoogleChrome/puppeteer/issues/728

    await page.setRequestInterception(true);
    page.once('request', request => {
      request.respond({body: html});
      page.on('request', request => request.continue());
    });

    page.goto('http://localhost');

    await Promise.all([
      page.waitForNavigation({waitUntil: 'load'}),
      page.waitForNavigation({waitUntil: 'networkidle0'})
    ]);

  }

  const data = await page.pdf(options);

  return {
    data,
    type: 'pdf',
  };
};
