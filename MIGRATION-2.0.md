## Browserless 2.0 Migration Guide

Browserless 2.0 is finally here! It's a complete rewrite of the core of browserless, and many things have changed. To keep things short, this rewrite allows us to support many new things which you can read about here: https://www.browserless.io/blog/2023/07/05/browserless-2-0/.

This document serves as a guide to migrate existing systems from browserless 1.x to 2.x. New features are not covered in this guide, but we do recommend checking the new things outBelow is a table of contents from which you can pick to better aide in migrating your existing codebase or REST calls.

For the most comprehensive documentation, feel free to visit the built-in doc-site located at `/docs` route. Browserless also logs this on startup for help.

- [Design Changes](#design)
- [Docker](#docker)
- [Libraries (Playwright, Puppeteer, etc.)](#libraries)
- [/function API](#function)
- [/pdf API](#pdf)
- [/screenshot API](#screenshot)
- [/scrape API](#scrape)
- [/config API](#config)
- [/stats API](#stats)
- [/sessions API](#sessions)
- Other differences

# Design Changes

browserless 2.xx was designed and developed for the sole purpose of making behavior more deterministic. We want to make the process of operating a headless browser stack more developer-friendly since these workflows can often be frustrating to work with. What do we mean by this? Here's a few points

- Unknown parameters will fail with 4xx errors since they're unrecognized.
- No more pre-booting or keep-alive as they can cause so many problems.
- A typescript-first workflow. All routes are strongly typed with a prescriptive approach so you can add your own.

- Better logging and built-in docsite with all parameters and definitions.

# Docker

Multiple environment variables have changed for simplicity and clarity in 2.0, but act similar in functionality to prior environment variables. We did remove a few due to their ability to cause issues, bad performance, and non-deterministic behavior.

browserless does it's best to log these old or deprecated environment variables, so be sure to read those out when using the new 2.0 builds.

### Removed parameters (no replacements):

- CHROME_REFRESH_TIME: No longer support pre-booted chrome.
- DEFAULT_BLOCK_ADS: Use `blockAds` in your API or library connect calls.
- DEFAULT_DUMPIO: Use `dumpio` in the launch arguments in your API or library connect calls.
- DEFAULT_HEADLESS: Use `headless: false` in your API or library connect calls.
- DEFAULT_IGNORE_DEFAULT_ARGS: Use `ignoreDefaultArgs` in your API or library connect calls.
- DEFAULT_IGNORE_HTTPS_ERRORS: Use `ignoreHTTPSErrors` your API or library connect calls.
- DEFAULT_LAUNCH_ARGS: Use the `args` option in your API or library connect calls.
- DEFAULT_STEALTH: Use the `stealth` option in your API or library connect calls.
- DISABLED_FEATURES: Fully ignored and deprecated.
- ENABLE_HEAP_DUMP: No longer supported.
- FUNCTION_BUILT_INS: No longer supported with the new function implementation.
- FUNCTION_ENABLE_INCOGNITO_MODE: No longer supported.
- FUNCTION_ENV_VARS: No longer supported.
- FUNCTION_EXTERNALS: No longer supported with the new function implementation.
- KEEP_ALIVE: No more pre-booting or keep-alive allowed.
- PREBOOT_CHROME: No more pre-booting or keep-alive allowed.
- PRINT_GET_STARTED_LINKS: Ignored
- WORKSPACE_DELETE_EXPIRED: No more workspace since most libraries do this now.
- WORKSPACE_DIR: No more workspace since most libraries do this now.
- WORKSPACE_EXPIRE_DAYS: No more workspace since most libraries do this now.

### Changed Parameters

Browserless will log these and replace them for you internally, but feel free to update these in order to prevent further logged messages:

- `CONNECTION_TIMEOUT`: Is now: `TIMEOUT`
- `DEFAULT_USER_DATA_DIR`: Is now: `DATA_DIR`
- `ENABLE_API_GET`: Is now: `ALLOW_GET`
- `ENABLE_CORS`: Is now: `CORS`
- `MAX_CONCURRENT_SESSIONS`: Is now: `CONCURRENT`
- `PRE_REQUEST_HEALTH_CHECK`: Is now: `HEALTH`
- `PROXY_URL`: Is now: `EXTERNAL`
- `QUEUE_LENGTH`: Is now: `QUEUED`

### Other Changes

We have changed where we serve our Docker images from docker hub to Github's container registry. Please use the `ghcr.io/browserless` or look at our open our [Packages page](https://github.com/orgs/browserless/packages).


# Libraries

We tried to keep library changes as little as possible since the compromise the core of the platform. However, one change is the consolidation of _all_ launch options into a single query string parameter of a JSON-stringified "launch". Connect calls are now more strict with query parameters. Any unknown parameter will cause connect calls to fail since they aren't supported by browserless. In version 1.xx unknown parameters were simply ignored.

browserless 2.xx shims old launch options query parameters internally, so it'll fix 1.xx requests for you. Here's a few examples of this so you can make any changes in code.

You may also optionally base64 encode these JSON stringified `launch` parameter as well.


### Launch flags:
**Before**
`ws://localhost:3000?token=ABCD&--window-size=1920,1080`

**After**
`ws://localhost:3000?token=ABCD&launch={"args":["--window-size=1920,108"]}`

### Headless flags:
**Before**
`ws://localhost:3000?token=ABCD&headless=new`

**After**
`ws://localhost:3000?token=ABCD&launch={"headless":"new"}`

# /function

The biggest difference in the function API is that it no longer operates inside of the NodeJS runtime, but in the browser. It also supports ECMAScript modules, so you'll have to tweak existing code to work inside 2.xx. This is a fairly large change, and any /function calls should be well tested prior to deploying them into production.


The function API is still hybrid in that it can accept a JavaScript file (with content-type application/javascript) OR a JSON file with `code` and `context` properties. Be sure to read more about it on the built-in docsite.

Browserless also now infers the appropriate response type so you no longer need to specify it. Simply return whatever data you wish and it'll write the request appropriately.

browserless 2.xx shims old launch options query parameters internally, so it'll fix 1.xx-style requests for you.

### Basic Request
**Before**
```js
// CommonJS no longer supported
module.exports = async({ page }) => {
  await page.goto('https://example.com');

  // No longer need to response with this object schematic
  return {
    data: await page.screenshot(),
    type: 'image/png',
  };
}
```

**After**
```js
// Use the "export default" keywords
export default async({ page }) => {
  await page.goto('https://example.com');
  // No longer need to tell what type
  return await page.screenshot();
}
```

### Request with requires
**Before**
```js
// npm packages are no longer supported
const url = require('url');

module.exports = async({ page }) => {
  await page.goto('https://example.com');
  const links = await page.evaluate(() => [...document.querySelectorAll('a')].map(l => l.href));
  const parsed = links.map((link) => url.parse(link));

  return {
    data: parsed,
    type: 'application/json',
  };
}
```

**After**
```js
export default async({ page }) => {
  await page.goto('https://example.com');
  const links = await page.evaluate(() => [...document.querySelectorAll('a')].map(l => l.href));

  // Can use URL and other browser-based APIs as well as load them
  // with `import` syntax from hosts like unpkg
  const parsed = links.map((link) => new URL(link));

  return parsed;
}
```
