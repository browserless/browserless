## Browserless 2.0 Migration Guide

Browserless 2.0 is finally here! It's a complete rewrite of the core of browserless, and many things have changed. To keep things short, this rewrite allows us to support many new things which you can read about here: https://www.browserless.io/blog/2023/07/05/browserless-2-0/.

This document serves as a guide to migrate existing systems from browserless 1.x to 2.x. New features are not covered in this guide, but we do recommend checking the new things outBelow is a table of contents from which you can pick to better aide in migrating your existing codebase or REST calls.

For the most comprehensive documentation, feel free to visit the built-in doc-site located at `/docs` route. Browserless also logs this on startup for help.

## Table of Contents
- [Design Changes](#design-changes-and-overall-goals)
- [List of Major Changes](#list-of-major-and-potentially-breaking-changes)
- [Docker](#docker)
- [Libraries (Playwright, Puppeteer, etc.)](#libraries)
- [/function API](#function)
- [/pdf API](#pdf)
- [/screenshot API](#screenshot)
- [/scrape API](#scrape)
- [/stats API](#stats)
- [/screencast API](#screencast)
- [/sessions API](#sessions)
- [/config API](#config)

# Design Changes and overall goals

browserless 2.xx was designed and developed for the sole purpose of making browser behavior more deterministic. We want to make the process of operating a headless browser stack more developer-friendly since these workflows can often be frustrating to work with. What do we mean by this? Here's a few points

- Unknown parameters will fail with 4xx errors since they're unrecognized.
- No more pre-booting or keep-alive as they can cause so many problems.
- A typescript-first workflow. All routes are strongly typed with a prescriptive approach so you can add your own.
- Forcing of best practices: we generate a unique TOKEN when none is present, meaning you *must* have a token at all times.
- Better logging and built-in doc-site with all parameters and definitions.
- Enhanced and comprehensive security.

This, in combination with the past 5+ years experience in headless, means there's several things that are different in browserless 2.xx. Please refer to the above Table of Contents to find the most relevant information for your API, library or use-case.

Finally, browserless does its best to be friendly and helpful by logging things like out-of-date parameters and configuration. Please be sure to read through logs when migrating existing workflows over and we'll continue to improve these messages as time goes on.

# List of Major and Potentially Breaking Changes
- Drop support for Selenium and Webdriver.
- Many docker environment variable changes (see below).
- Drop support for DEFAULT_* arguments.
- Drop support for pre-booting and keep-alive.
- TOKEN is now randomly generated when none is present to enforce some authentication.
- When using custom launch flags for APIs and Libraries: please update to the new format which is a consolidated `&launch` parameter.
- Playwright's Chromium path is now `/playwright/chromium` in order to reflect other browsers in different paths.
- Unknown query parameters or JSON POST parameters will now respond with a 4xx error.
- New `/function` API environment and uses Ecmascript modules. We no longer run /function calls in the NodeJS environment, and instead run inside the browser's JavaScript runtime. `import` does work and loads modules over HTTP instead of locally.
- `blockAds` now uses Ublock Origin to facilitate ad-blocking. No more request interception.
- The prior `/stats` API is now located at `/performance`.

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
- `TOKEN`: Remains `TOKEN` but is randomly generated when none is present.

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

The function API is still hybrid in that it can accept a JavaScript file (with content-type application/javascript) OR a JSON file with `code` and `context` properties. Be sure to read more about it on the built-in doc-site.

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

# /pdf

The PDF API operates in a similar fashion as the in browserless 1.xx. The biggest difference is how launch flags are handled, which now use a consolidated `launch` object to hold all CLI arguments and flags.

`waitFor` has now been removed and deprecated in favor of puppeteer's discrete API methods: `waitForEvent`, `waitForFunction`, `waitForSelector` and `waitForTimeout`.

`rotate` has been removed due to lack of usage and included 3rd party dependencies. `safeMode` has also been removed in favor of using puppeteer's streaming capabilities that are much less error-prone.

# /screenshot

The /screenshot API operates very similarly to how it did in browserless 1.xx. A few properties and options have been removed due to their infrequent usage and 3rd party dependencies.

`waitFor` has now been removed and deprecated in favor of puppeteer's discrete API methods: `waitForEvent`, `waitForFunction`, `waitForSelector` and `waitForTimeout`.

`manipulate` has also been removed since it was infrequently used and required numerous other dependencies in order to run properly.

# /scrape

The /scrape API operates similarly to how it did in browserless 1.xx. A few properties and options have been removed due to their infrequent usage and 3rd party dependencies.

`waitFor` has now been removed and deprecated in favor of puppeteer's discrete API methods: `waitForEvent`, `waitForFunction`, `waitForSelector` and `waitForTimeout`.

# /stats

The /stats API has been moved to /performance now to better reflect the action its doing since the word "stats" in this context can be ambiguous. Internally, it still runs lighthouse reports and you can provide various configurations to it.

# /screencast

The /screencast API has been removed in favor of a library-based approach. browserless 2.xx now ships with what we call an "embedded" API which you can use to initiate a recording of a page and get the response back (with audio!).

Please refer to the built-in doc-site for how to do screencasting or consult your library of choice for how to screencast.

# /config

The /config API now returns more meta-data about the instance including more parameters. Please visit the internal doc-site page to see the JSON response and all the properties.
