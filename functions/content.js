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
module.exports = async function content({ page, context }) {
  const {
    addScriptTag = [],
    addStyleTag = [],
    authenticate = null,
    url = null,
    html,
    gotoOptions,
    rejectRequestPattern = [],
    rejectResourceTypes = [],
    requestInterceptors = [],
    cookies = [],
    setExtraHTTPHeaders = null,
    setJavaScriptEnabled = null,
    userAgent = null,
    viewport = null,
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

  if (userAgent) {
    await page.setUserAgent(userAgent);
  }

  if (viewport) {
    await page.setViewport(viewport);
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

  const data = await page.content();

  const headers = {
    'x-response-url': response?.url().substring(0, 1000),
    'x-response-code': response?.status(),
    'x-response-status': response?.statusText(),
    'x-response-ip': response?.remoteAddress().ip,
    'x-response-port': response?.remoteAddress().port,
  };

  return {
    data,
    headers,
    type: 'html',
  };
};
