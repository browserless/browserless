/*
 * scrape function
 *
 * Example invocation:
 *
 * scrape({
 *  page: await browser.newPage(),
 *  context: {
 *    url: 'https://example.com',
 *  },
 * });
 */

async function waitForElement(selector, timeout = 30000) {
  return new Promise((resolve) => {
    const timeOutId = setTimeout(resolve, timeout);

    if (document.querySelector(selector)) return resolve();

    const observer = new MutationObserver(function(_mutations, observation) {
      const found = document.querySelector(selector);
      if (found) {
        observation.disconnect();
        clearTimeout(timeOutId);
        return resolve();
      }
    });

    // start observing
    observer.observe(document, {
      childList: true,
      subtree: true,
    });
  });
}

module.exports = async function scrape ({ page, context }) {
  const {
    authenticate = null,
    addScriptTag = [],
    addStyleTag = [],
    cookies = [],
    gotoOptions,
    rejectRequestPattern = [],
    requestInterceptors = [],
    setExtraHTTPHeaders = null,
    url,
    elements,
    userAgent = null,
    waitFor,
    debug = {
      cookies: false,
      html: false,
      screenshot: false,
      network: false,
      console: false,
    },
  } = context;

  const messages = [];
  const outbound = [];
  const inbound = [];

  debug.console && page.on('console', msg => messages.push(msg.text()));

  debug.network && page.on('request', (req) => {
    outbound.push({
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
    });
  });

  debug.network && page.on('response', (res) => {
    inbound.push({
      status: res.status(),
      url: res.url(),
      headers: res.headers(),
    });
  });

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

  if (userAgent) {
    await page.setUserAgent(userAgent);
  }

  await page.goto(url, gotoOptions);

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

  const data = await page.evaluate(async (elements, waitForElementString) => {
    const wait = new Function('return ' + waitForElementString)();

    await Promise.all(elements.map(({ selector, timeout }) => wait(selector, timeout)));

    return elements.map(({ selector }) => {
      const $els = [...document.querySelectorAll(selector)];
      return {
        selector,
        results: $els.map(($el) => ({
          html: $el.innerHTML,
          text: $el.innerText,
          attributes: [...$el.attributes].map((attr) => ({
            name: attr.name,
            value: attr.value,
          })),
        })),
      }
    });
  }, elements, waitForElement.toString());

  const [
    html,
    screenshot,
    pageCookies,
  ] = await Promise.all([
    debug.html ? page.content() : Promise.resolve(null),
    debug.screenshot ? page.screenshot({ fullPage: true, type: 'jpeg', quality: 20, encoding: 'base64' }) : Promise.resolve(null),
    debug.cookies ? page.cookies() : Promise.resolve(null),
  ]);

  return {
    type: 'application/json',
    data: {
      data,
      debug: {
        html,
        screenshot,
        cookies: pageCookies,
        console: messages,
        network: {
          outbound,
          inbound,
        },
      },
    },
  };
};
