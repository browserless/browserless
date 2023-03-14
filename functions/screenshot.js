/* global document, module, require, setTimeout, window */

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
const scrollThroughPage = async (page) => {
  // Scroll to page end to trigger lazy loading elements
  const viewport = (await page.viewport()) || {
    width: 640,
    height: 480,
  }; // default Puppeteer viewport

  await page.evaluate((bottomThreshold) => {
    const scrollInterval = 100;
    const scrollStep = Math.floor(window.innerHeight / 2);

    function bottomPos() {
      return window.pageYOffset + window.innerHeight;
    }

    return new Promise((resolve) => {
      function scrollDown() {
        window.scrollBy(0, scrollStep);

        if (document.body.scrollHeight - bottomPos() < bottomThreshold) {
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
          return;
        }

        setTimeout(scrollDown, scrollInterval);
      }

      scrollDown();
    });
  }, viewport.height);
};

module.exports = async function screenshot({ page, context } = {}) {
  const {
    authenticate = null,
    addScriptTag = [],
    addStyleTag = [],
    url = null,
    cookies = [],
    gotoOptions,
    html = '',
    userAgent = '',
    manipulate = null,
    options = {},
    scrollPage = null,
    selector = null,
    rejectRequestPattern = [],
    rejectResourceTypes = [],
    requestInterceptors = [],
    setExtraHTTPHeaders = null,
    setJavaScriptEnabled = null,
    viewport,
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

  if (
    rejectRequestPattern.length ||
    requestInterceptors.length ||
    rejectResourceTypes.length
  ) {
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      if (
        !!rejectRequestPattern.find((pattern) => req.url().match(pattern)) ||
        rejectResourceTypes.includes(req.resourceType())
      ) {
        return req.abort();
      }
      const interceptor = requestInterceptors.find((r) =>
        req.url().match(r.pattern),
      );
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

  if (userAgent) {
    await page.setUserAgent(userAgent);
  }

  const response =
    url !== null
      ? await page.goto(url, gotoOptions)
      : await page.setContent(html, gotoOptions);

  if (addStyleTag.length) {
    for (const tag in addStyleTag) {
      await page.addStyleTag(addStyleTag[tag]);
    }
  }

  if (addScriptTag.length) {
    for (const script in addScriptTag) {
      await page.addScriptTag(addScriptTag[script]);
    }
  }

  if (waitFor) {
    if (typeof waitFor === 'string') {
      const isSelector = await page
        .evaluate(
          `document.createDocumentFragment().querySelector("${waitFor}")`,
        )
        .then(() => true)
        .catch(() => false);

      await (isSelector
        ? page.waitForSelector(waitFor)
        : page.evaluate(`(${waitFor})()`));
    } else {
      await new Promise((r) => setTimeout(r, waitFor));
    }
  }

  if (scrollPage) {
    await scrollThroughPage(page);
  }

  const data =
    selector !== null
      ? await (async () => {
          const elementHandle = await page.$(selector);
          return await elementHandle.screenshot(options);
        })()
      : await page.screenshot(options);

  const headers = {
    'x-response-url': response?.url().substring(0, 1000),
    'x-response-code': response?.status(),
    'x-response-status': response?.statusText(),
    'x-response-ip': response?.remoteAddress().ip,
    'x-response-port': response?.remoteAddress().port,
  };

  let contentType = options.type ? options.type : 'png';

  if (options.encoding && options.encoding === 'base64') {
    contentType = 'text';
  }

  if (manipulate) {
    const sharp = require('sharp');
    const chain = sharp(data);

    if (manipulate.resize) {
      chain.resize(manipulate.resize);
    }

    if (manipulate.flip) {
      chain.flip();
    }

    if (manipulate.flop) {
      chain.flop();
    }

    if (manipulate.rotate) {
      chain.rotate(manipulate.rotate);
    }

    return {
      data: await chain.toBuffer(),
      headers,
      type: contentType,
    };
  }

  return {
    data,
    headers,
    type: contentType,
  };
};
