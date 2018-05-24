/*
 * pdf function
 *
 * Example invocation:
 *
 * content({
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
module.exports = async function content ({ page, context }) {
  const { url, html, options } = context;
  console.log(url);
  console.log(html);
  console.log(options);
  if(url != null) {
    await page.goto(url);
  } else {
    await page.setContent(html);
  }

  const pdfBuffer = await page.pdf(options);

  return { data: pdfBuffer, type: 'pdf' }
};
