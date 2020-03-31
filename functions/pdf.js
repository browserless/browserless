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
    authenticate = null,
    addScriptTag = [],
    addStyleTag = [],
    cookies = [],
    emulateMedia,
    viewport,
    html,
    options,
    url = null,
    rotate = null,
    safeMode,
    gotoOptions,
    rejectRequestPattern = [],
    requestInterceptors = [],
    setExtraHTTPHeaders,
    setJavaScriptEnabled = null,
    userAgent = null,
    waitFor,
  } = context;

  if (authenticate) {
    await page.authenticate(authenticate);
  }

  if (setExtraHTTPHeaders) {
    await page.setExtraHTTPHeaders(setExtraHTTPHeaders);
  }

  if (setJavaScriptEnabled !== null) {
    await page.setJavaScriptEnabled(setJavaScriptEnabled);
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

  if (emulateMedia) {
    await page.emulateMedia(emulateMedia);
  }

  if (cookies.length) {
    await page.setCookie(...cookies);
  }

  if (viewport) {
    await page.setViewport(viewport);
  }

  if (userAgent) {
    await page.setUserAgent(userAgent);
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

  if (addStyleTag.length) {
    for (tag in addStyleTag) {
      await page.addStyleTag(addStyleTag[tag]);
    }
  }

  if (addScriptTag.length) {
    for (script in addScriptTag) {
      await page.addScriptTag(addScriptTag[script]);
    }
  }

  if (waitFor) {
    if (typeof waitFor === 'string') {
      const isSelector = await page.evaluate((s) => {
        try { document.createDocumentFragment().querySelector(s); }
        catch (e) { return false; }
        return true;
      }, waitFor);

      await (isSelector ? page.waitFor(waitFor) : page.evaluate(`(${waitFor})()`));
    } else {
      await page.waitFor(waitFor);
    }
  }

  let data = safeMode ?
    await buildPages(page, options) :
    await page.pdf(options);

  if (rotate) {
    const pdftk = require('node-pdftk');
    const rotateValue = rotate === 90 ?
      '1-endright' :
      rotate === -90 ?
      '1-endleft' :
      rotate === 180 ?
      '1-enddown' :
      '';

    data = await pdftk
      .input(data)
      .rotate(rotateValue)
      .output();
  }

  return {
    data,
    type: 'pdf',
  };
};
