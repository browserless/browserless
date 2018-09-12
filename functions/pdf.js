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
const buildPages = async (page, opts = {}) => {
  const pdftk = require('node-pdftk');
  const pageBuffers = [];
  let complete = false;
  let pageCount = 1;

  // If ranges are specified, don't render them all
  if (opts.pageRanges) {
    return page.pdf(opts);
  }

  while (!complete) {
    try {
      const buffer = await page.pdf({
        ...opts,
        pageRanges: pageCount.toString(),
      });
      pageBuffers.push(buffer);
      pageCount = pageCount + 1;
    } catch(error) {
      if (error.message && error.message.includes('Page range exceeds page count')) {
        complete = true;
      } else {
        throw error;
      }
    }
  }

  return pdftk
    .input(pageBuffers)
    .cat()
    .compress()
    .output();
};

module.exports = async function pdf({ page, context }) {
  const {
    emulateMedia,
    html,
    options,
    url = null,
    safeMode,
    gotoOptions,
    rejectRequestPattern,
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

  if (emulateMedia) {
    await page.emulateMedia(emulateMedia);
  }

  if (url !== null) {
    await page.goto(url, gotoOptions);
  } else {
    // Whilst there is no way of waiting for all requests to finish with setContent,
    // you can simulate a webrequest this way
    // see issue for more details: https://github.com/GoogleChrome/puppeteer/issues/728

    await page.setRequestInterception(true);
    page.once('request', request => {
      request.respond({ body: html });
      page.on('request', request => request.continue());
    });

    await page.goto('http://localhost', gotoOptions);
  }

  const data = safeMode ?
    await buildPages(page, options) :
    await page.pdf(options);

  return {
    data,
    type: 'pdf',
  };
};
