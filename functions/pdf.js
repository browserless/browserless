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
    await page.setContent(html);
  }

  const data = await page.pdf(options);

  return {
    data,
    type: 'pdf',
  };
};
