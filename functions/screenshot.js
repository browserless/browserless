/*
 * screenshot function
 *
 * Example invocation:
 *
 * screenshot({
 *  page: await browser.newPage(),
 *  context: {
 *    url: 'https://example.com',
 *    type: 'jpeg',
 *    quality: 50,
 *    fullPage: false,
 *    omitBackground: true,
 * },
 * });
 *
 * @param args - object - An object with a puppeteer page object, and context.
 * @param args.page - object - Puppeteer's page object (from await browser.newPage)
 * @param args.context - object - An object of parameters that the function is called with. See src/schemas.ts
 */
module.exports = async function screenshot ({ page, context } = {}) {
  const {
    authenticate = null,
    url = null,
    cookies = [],
    gotoOptions,
    html = '',
    options = {},
    rejectRequestPattern = [],
    requestInterceptors = [],
    setExtraHTTPHeaders = null,
    viewport,
    waitFor,
  } = context;

  if (authenticate) {
    await page.authenticate(authenticate);
  }

  if (setExtraHTTPHeaders) {
    await page.setExtraHTTPHeaders(setExtraHTTPHeaders);
  }

  if (rejectRequestPattern.length || requestInterceptors.length) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (rejectRequestPattern.find((pattern) => req.url().match(pattern))) {
        return req.abort();
      }
      const interceptor = requestInterceptors
        .find(r => req.url().match(r.pattern));
      if (interceptor) {
        return req.respond(interceptor.response);
      }
      return req.continue();
    });
  }

  if (cookies.length) {
    await page.setCookie(...cookies);
  }

  if (viewport) {
    await page.setViewport(viewport);
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

  if (waitFor) {
    if (typeof waitFor === 'string') {
      const isSelector = await page.evaluate((s) => {
        try { document.createDocumentFragment().querySelector(s); }
        catch (e) { return false; }
        return true;
      }, waitFor);

      await (isSelector ? page.waitFor(waitFor) : page.waitForFunction(waitFor));
    } else {
      await page.waitFor(waitFor);
    }
  }

  const data = await page.screenshot(options);

  return {
    data,
    type: options.type ? options.type : 'png'
  };
};
