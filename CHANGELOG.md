# [Latest](https://github.com/browserless/chrome/compare/v1.50.0...master)
- Dependency updates.

# [v1.50.0](https://github.com/browserless/chrome/compare/v1.49.1...v1.50.0)
- Dependency updates.
- Drops support for `puppeteer-4.0.1` in favor of `puppeteer-12.0.1`.
- Chrome-stable now utilizes puppeteer @ `12.0.1`.
- Support for `arm64` via production tags (`1-arm64`) as well as in `latest`.
- Static JSON files (`protocol.json`, `version.json`) are built at runtime on their first request and then cached in memory.
- Bumps `browserless/base` to `1.14.0`.
- New `selector` property for screenshot-ing a single DOM node in the screenshot API.
- `puppeteerVersions` in the package.json file has been rename do `chromeVersions`.
- Internal changes for deploying production tag scripts.
- Consolidate scripts for `postinstall`.
- Drop support for `heapdump` due to its age and lack of platform varieties.
- New `/metrics/total` route for summing up all statistics in a single JSON payload.

# [v1.49.1](https://github.com/browserless/chrome/compare/v1.49.0...v1.49.1)
- Dependency updates.
- Fix webhook not using timeout URL.

# [v1.49.0](https://github.com/browserless/chrome/compare/v1.48.0...v1.49.0)
- Dependency updates.
- Support for ARM64 builds by dropping flash for it.
- Bump puppeteer 10.2.0 for 10.4.0.
- New puppeteer-hook for injecting a puppeteer-compatible library, eg. puppeteer-extra.

# [v1.48.0](https://github.com/browserless/chrome/compare/v1.47.0...v1.48.0)
**Potentially Breaking**
- API calls with `html` in their payloads now use the `page.setContent` API versus a prior hack using one-time network-request interception ([example here](https://github.com/browserless/chrome/compare/v1.47.0...master#diff-67b699af1b24472604e21081d0509620d4ab3d986fcd4f8aa0b04d5ee5e4c63fL88)). Old versions of puppeteer might not work properly with this (<= 5.x.x). This effects the following APIS: `/content`, `/pdf` and `/screenshot`.
---
- Dependency updates.
- Bump `browserless/base` to `1.12.0` (add user-id to `blessuser` of `BLESS_USER_ID=999`).
- Bumps puppeteer @10.x.x to `10.2.0` with revision `901912`.
- Makes API calls use `setContent` properly now (no more one-time network interception). This fixes certain issues with images not loading in PDFs and screenshots.
- Fix some typings in tests.

# [v1.47.0](https://github.com/browserless/chrome/compare/v1.46.0...v1.47.0)
- Dependency updates.
- Bump `browserless/base` to `1.11.0`.
- Add new lint task and rename GitHub actions tasks, remove `tslint`.
- Lint and prettier fixes.
- Delay url parsing until after `before` hook runs.
- New `meta` object param for page hooks (passing through arbitrary meta data set by prior hooks).
- New `FUNCTION_ENV_VARS` environment variable pass through an allow-list of environment variables for functions to access.
- Fix `someObject.hasOwnProperty` to `Object.prototype.hasOwnProperty.call`.
-

# [v1.46.0](https://github.com/browserless/chrome/compare/v1.45.0...v1.46.0)
- Dependency updates.
- Move to Node 16.x.x.
- Bump browserless/base to 1.10.0.
- Limit `x-response-url` to 100 characters.
- Add support for puppeteer@10.x.x.
- Add `maxConcurrent` stat for metrics API + log stats every 5 minutes to stdout.
- Some performance improvements to how pages/browsers are setup and torn down.
- Add `API_DOCS_ENDPOINT` as a filterable API to deny access to.
- Minor code reformatting from prettier.
- Better page setup and logging.
- Fixes `DEFAULT_STEALTH` for self-hosted deployments.
- Improvements on how chrome is closed.

# [1.45.0](https://github.com/browserless/chrome/compare/v1.44.0...v1.45.0)
- Dependency Updates.
- Support for [playwright proxies](https://github.com/browserless/chrome/commit/0903795e936b93a511ec04f7ae35c03397682905).
- Fixes an issue with larger headers potentially causing load-balancers to crash and fail.

# [v1.44.0](https://github.com/browserless/chrome/compare/v1.43.0...v1.44.0)
**Potentially Breaking**
- `PROXY_HOST` and `PROXY_PORT` are now replaced with a single `PROXY_URL` param, eg: `https://www.mybrowserless.com/optional/paths`. When set, browserless uses this fully-qualified URL to build out links _back_ to its internal debugger and sessions. Useful when you're instance is behind a proxy or load-balancer of some kind.
---
- Dependency Updates.
- Use recent Node 14 (browserless-base 1.7.0).
- New `rejectResourceTypes` property on most APIs (content, screenshot, pdf, etc.).
- Allow serving of `file://` protocols when explicitly enabled (default is off due to security concerns). Set `ALLOW_FILE_PROTOCOL=true` in your env params.
- The `/pressure` API now takes into account CPU/Memory consumption, and adds a "reason" property for why the machine might be not available.
- Fixes an issue where playwright couldn't download files.
- You can now filter /sessions calls with a `trackingId` parameter.
- `detached` functions now return a `trackingId` when present.
- More types, tests, and utility consolidation.

# [v1.43.0](https://github.com/browserless/chrome/compare/v1.42.0...v1.43.0)
- Dependency Updates.
- Fixes an issue where --user-data-dirs aren't deleted properly, potentially filling disks.
- Changes CPU/Memory checks to be user-based and not the entire OS.
- Adds tests for the user-data-dir issue.

# [v1.42.0](https://github.com/browserless/chrome/compare/v1.41.0...v1.42.0)
- Dependency Updates.
- Move to Node 14!
- Use `esModuleInterop` for imports.
- Remove `page.waitFor` in favor of downstream methods.
- Adds new `?stealth` parameter for API calls (see puppeteer-extra-stealth-plugin).
- New `DEFAULT_STEALTH` param for making stealth calls by default.
- Fixes `ignoreDefaultArgs` in chrome stable.
- Ensure temp user-data-dirs are always cleaned up.

# [v1.41.0](https://github.com/browserless/chrome/compare/v1.40.2...v1.41.0)
- Dependency Updates.
- New `SESSION_CHECK_FAIL_URL` webhook for when pre-session checks fail.
- Health checks now take the last two CPU/Memory samples to determine if a failure (5 minutes).

# [v1.40.2](https://github.com/browserless/chrome/compare/v1.40.1...v1.40.2)
- Dependency Updates.
- Fix potentially unhandled stream error events when closing chrome.
- Bump puppeteer to 5.4.1 for major 5.

# [v1.40.1](https://github.com/browserless/chrome/compare/v1.40.0...v1.40.1)
- Dependency Updates
- New `SOCKET_CLOSE_METHOD` for better load-balancing behavior when under load.

# [v1.40.0](https://github.com/browserless/chrome/compare/v1.39.0...v1.40.0)
- Dependency Updates
- Support for playwright 1.4.0 and greater. [See more here](https://github.com/microsoft/playwright/issues/4054).
- New `PRE_REQUEST_HEALTH_CHECK` env variable to check CPU/Memory prior to running a session. Set `MAX_CPU_PERCENT` or `MAX_MEMORY_PERCENT` for setting these thresholds. Responds with a `503` HTTP code if CPU/Memory are high on any inbound session (API, puppeteer or webdriver).

# [v1.39.0](https://github.com/browserless/chrome/compare/v1.38.0...v1.39.0)
- Dependency Updates
- Fixes a crash due to `browser.close` streams not completing properly.
- Adds a `dumpio` query-string parameter for launching with puppeteer.

# [v1.38.0](https://github.com/browserless/chrome/compare/v1.37.2...v1.38.0)
- Dependency Updates
- Fixes a memory leak when browsers don't close properly.
- Adds a `/heapdump` route for capturing heap dumps. Turn on by setting `ENABLE_HEAP_DUMP=true` in your docker env.
- `emulateMedia` fixes on the pdf route.
- CodeQL implemented.
- README fixes.

# [v1.37.2](https://github.com/browserless/chrome/compare/v1.37.1...v1.37.2)
- Dependency Updates
- Fixes an issue where the webserver can crash after rejecting a request.
- Fixes deployment script not waiting for zip files to be finished unzipped.

# [1.37.1](https://github.com/browserless/chrome/compare/v1.37.0...v1.37.1)
- Dependency Updates
- Fixes an issue in webdriver not starting properly.

# [1.37.0](https://github.com/browserless/chrome/compare/v1.36.0...v1.37.0)
**Potentially Breaking**
- Due to stability issues, puppeteer version 3.x.x and 4.x.x now use chromium revision `782078`. See our `package.json` for details.
---
- Dependency Updates
- README Updates
- Fixes an issue for secured containers using prometheus (plus tests).
- Support for puppeteer `5.2.1`

# [1.36.0](https://github.com/browserless/chrome/compare/v1.35.0...v1.36.0)
- Dependency Updates
- Drops support for puppeteer `2.0.0` and `3.0.4`, please use `2.1.1` and `3.3.0` for those revisions.
- Adds support for puppeteer `5.0.0`.
- Bug-fix with the server randomly closing with an uncaught error event thrown from inside underlying socket connection.
- Adds back in `--disable-dev-shm-usage` to default arguments for better SHM performance.

# [1.35.0](https://github.com/browserless/chrome/compare/v1.34.0...v1.35.0)
- Dependency Updates
- New `maxTime`, `minTime`, `meanTime` and `totalTime` of all sessions for a given period in /stats.
- Bugfix on CPU/Memory triggering health failure webhooks.
- Fix issues in websocket errors by awaiting browser.close (or 5 seconds, whichever is quickest).

# [v1.34.0](https://github.com/browserless/chrome/compare/v1.33.1...v1.34.0)
**Potentially Breaking**
- screencast API no longer supports `audio` or the `setPreferences` function in order to offer a better video experience. In order to set the width/height, simply set a page width height to what you'd like.
- `chrome-stable` will now use `puppeteer@3.1.0` for better compatibility.
---
- Dependency updates.
- Drops puppeteer version `1.20.0` and below.
- Move `browserless/base` to `v1.5.0`.
- Puppeteer support for `3.3.0` (3.2.x and 3.1.x have the same chromium revision).
- Fixes `trackingId` on pre-booted sessions.
- `about:blank` pages now are returned in the `/sessions` API for transparency of open sessions/browsers.

# [1.33.1](https://github.com/browserless/chrome/compare/v1.33.0...v1.33.1)
- Dependency updates.
- Fix socket errors from accidentally firing error webhooks.

# [1.33.0](https://github.com/browserless/chrome/compare/v1.32.0...v1.33.0)
- Drops support for puppeteer 1.17.x and 1.18.x
- Support for puppeteer 3.0.x
- Dependency updates
- Fix reject stat firing on debugger pages not being found
- Consolidates more types.

# [1.32.0](https://github.com/browserless/chrome/compare/v1.31.1...v1.32.0)
- Dependency Updates.
- Adds roboto fonts.
- Updates `pressure` API to take account of running browsers in the `running` count.
- Adds `maxConcurrent`, `maxQueued`, `cpu` and `memory` to pressure.

# [1.31.1](https://github.com/browserless/chrome/compare/v1.31.0...v1.31.1)
- Dependency Updates.
- Fixes a small issue where XVFB doesn't start properly during an automated restart.

# [1.31.0](https://github.com/browserless/chrome/compare/v1.30.0...v1.31.0)
- Dependency Updates.
- Allows `trackingId` on uploaded files to save in the appropriate tracking-ID folder.
- New `userAgent` param for setting user-agent in API requests.
- Fixes an issue where chrome wasn't being closed in rare cases.

# [1.30.0](https://github.com/browserless/chrome/compare/v1.29.1...v1.30.0)
- Dependency Updates.
- Updates to Node 13 for speed and memory improvements.
- browserless/base@1.4.0

# [1.29.1](https://github.com/browserless/chrome/compare/v1.29.0...v1.29.1)
- Dependency Updates.
- Fixes how deploy script determines errors when running child commands.
- Fixes issues when many selenium sessions can potentially fill up disk space.

# [1.29.0](https://github.com/browserless/chrome/compare/v1.28.0...v1.29.0)
- Dependency updates.
- Uses `pipe`'s for most API calls and other internal endpoints for faster/better throughput. Works only for `headless` API/puppeteer calls.
- Allows custom lighthouse configs via POST `config` property.
- Patches vm2.
- Before hooks no longer end requests forcefully -- external hooks must manually end the request/sockets themselves.
- Properly passes socket errors to the error handler/webhook

# [1.28.0](https://github.com/browserless/chrome/compare/v1.27.0...v1.28.0)
- Dependency updates.
- Sets a system-default font of Ubuntu for most sites that use `system-ui` in their font declarations.
- Fixes health-check failure webhooks.
- New `PROXY_HOST`, `PROXY_PORT` and `PROXY_SSL` for external load-balancers. [See docsite for more info](https://docs.browserless.io/docs/docker.html#using-a-proxy).
- Moves over to GH actions over Travis for CI.

# [1.27.0](https://github.com/browserless/chrome/compare/v1.26.1...v1.27.0)
- Dependency updates.
- New `manipulate` params for screenshots, allowing for resizing, flipping and more.
- Better tracking of chrome-process for cleanup of zombied sessions.

# [1.26.1](https://github.com/browserless/chrome/compare/v1.26.0...v1.26.1)
- Dependency updates.
- Added `git` as a dependency in dockerfile for git-based npm dependencies to work.
- Fixed an issue in `start.sh` so that errors bubble up properly and close the process.
- Bumps `browserless/base` to `1.2.0`.

# [1.26.0](https://github.com/browserless/chrome/compare/v1.25.0...v1.26.0)
- Dependency updates.
- Dropping pre-push hooks for speed.
- Consolidate all interfaces/types to a types.d.ts file.
- Fixes an issue where numerous chrome instances launch when prebooting.
- Fixes an issue where incoming requests don't use the pre-booted chrome instance.
- Uses `page.setViewport` when `--window-size` is set in params to help with screenshots not appearing properly (chromedriver only).
-

# [1.25.0](https://github.com/browserless/chrome/compare/v1.24.0...v1.25.0)
- Dependency updates.
- Stricter build-time arguments for chromium and chromedriver assets.
- Better XVFB functionality.
- New parameters for most API's, `addScriptTag` and `addStyleTag`, accepting an array of scripts/styles respectively.
- Drop support for `puppeteer@1.17.0`.
- Proper support for parsing `ignoreDefaultArgs` query-parameters.

# [1.24.0](https://github.com/browserless/chrome/compare/v1.23.1...v1.24.0)
- Dependency updates.
- Bugfix on our debugger's play button being off-center.
- Fixes driver.close() calls not cleaning the browser.
- New `/GET` option for most our APIs. Stringify your JSON and add a ?body=YOUR-JSON with a /GET call to most of our functions! Requires `ENABLE_API_GET=true` in you docker env variables.
- WebSocket (Socket) exception handling and logging.
- More integration and unit tests added.

# [1.23.1](https://github.com/browserless/chrome/compare/v1.23.0...v1.23.1)
- Fixes an issue in chromedriver where commands would hang.
- Fixes an issue in chromedriver sessions not being removed properly.
- Fixes and pins the base image so that headful sessions work again.

# [1.23.0](https://github.com/browserless/chrome/compare/v1.22.0...v1.23.0)
- Dependency updates.
- Use `apt-get` to install `dumb-init`.
- Add a LANG arg in docker.
- New `setJavaScriptEnabled` property for REST APIs.
- Fixes an issue with `waitFor` functions in REST API calls.
- Fixes issues when PREBOOT_CHROME and KEEPALIVE are true.
- Updates protocol and host information in ad-blocking.

# [1.22.0](https://github.com/browserless/chrome/compare/v1.21.0...v1.22.0)
- Dependency updates.
- Removal of unnecessary '--disable-dev-shm-usage'
- Squelching of chromedriver's verbose args unless `DEBUG=*` is set.
- New `/kill/${id}` route for remotely killing a certain browser.
- Allowing of sub-child routes in workspaces.

# [1.21.0](https://github.com/browserless/chrome/compare/v1.20.0...v1.21.0)
- Dependency updates.
- New `viewport` property option for PDF endpoint.
- The `/stats` endpoint now runs in a separate process meaning it can be parallelized.
- Fixed a bug where hardware monitoring can cause the container to restart/crash.
- Fixes an issue with the file-chooser API not working in puppeteer.

# [1.20.0](https://github.com/browserless/chrome/compare/v1.19.0...v1.20.0)
- Dependency updates.
- New `/scrape` API!

# [1.19.0](https://github.com/browserless/chrome/compare/v1.18.0...v1.19.0)
- Dependency updates.
- Fixes chrome-stable's binary chromedriver.
- Move over to Node 12.
- Bugfix on width/height in the screencast API.
- Support for puppeteer@2.0.0.
- Fixed issues with the devtools JS files missing.
- Adds support for blacklisting routes in Docker.
- Consolidates hooks into a hooks module.
- Allows Selenium to specify download-paths and pausing via preferences.
- Fixes an issue in certain JSON-based CDP libraries.
- Function API's can now run incognito mode with a new Docker param.
-

# [1.18.0](https://github.com/browserless/chrome/compare/v1.17.0...v1.18.0)
- Dependency updates
- Better `IS_DOCKER` check for kubernetes.
- Updates to README.md, spelling fixes and Slack link.
- Fixes to debugger and larger code bodies.
- Removal of analytics in debugger.
- Screencast improvements and adding ability to set new options.
- New `waitFor` property in our APIs (content, pdf and screenshot).
- Don't allow file requests on the debugger for security reasons.
- Better metrics monitoring.
- `singleRun` mode in docker.
- New prometheus support!
- Fixing issues with keeping chrome alive (only closing once TTL is met).

# [1.17.0](https://github.com/browserless/chrome/compare/v1.16.0...v1.17.0)
- Dependency updates
- Splitting docker images into two repositories for faster builds and pulls
- Adding in external routing capabilities
- New error hook
- More/better types
- Updating `deviceScaleFactor` in API's for more granular control.
- Better chromedriver failure messages.

# [1.16.0](https://github.com/browserless/chrome/compare/v1.15.0...v1.16.0)
- Adding `ffmpeg` to the docker dependency list.
- Add `timecut` as a dependency for recording.
- Better logs on chrome PID's and closing forcefully.
- Fixed `DEFAULT_CHROME` => `DEFAULT_HEADLESS`.
- Fixed a bug where `xvfb` doesn't start in time.
- Use `SIGKILL` for killing chromedriver.
- `/json/version` now returns a `webSocketDebuggerUrl`.

# [1.15.0](https://github.com/browserless/chrome/compare/v1.14.1...v1.15.0)
- New `page` and `browser` hooks for docker images that `FROM` browserless.
- `bluebird` added as a module for `function` and other endpoints.
- More dependency updates.

# [1.14.1](https://github.com/browserless/chrome/compare/v1.14.0...v1.14.1)
- Bugfix when running multiple "headfull" sessions.
- Dependency updates.

# [1.14.0](https://github.com/browserless/chrome/compare/v1.13.0...v1.14.0)
- New `WORKSPACE_DELETE_EXPIRED` and `WORKSPACE_EXPIRE_DAYS` to auto-cleanup workspace dirs.
- README.md cleanup now that HTTPS is no longer required.
- Support for `~` in docker env parameters.
- More alignment with how chromedriver and puppeteer sessions get cleaned up.
- `/session` API now returns `browserWSEndpoint` and `browserId` properties for having multiple debuggers connected.
- Support for reconnecting(!!). When a `?keepalive=KEEP-ALIVE-IN-MS` is seen in the `puppeteer.connect` call we keep the browser active for that many ms after the debugger disconnects.
- New `/kill/all` route which closes _all_ actively running sessions.
- New internal scheduler module, making future things like cron-based jobs a possibility.
- Better internal types.

# [1.13.0](https://github.com/browserless/chrome/compare/v1.12.0...v1.13.0)
- A minor refactor to consolidate calls to `url.parse` for performance gains.
- Introduces a per-session based timeout that overrides the global timeout.
- Consolidates authorization checks to remove duplication.
- Moves more types into their backing modules in order to better consolidate files.

# [1.12.0](https://github.com/browserless/chrome/compare/v1.11.0...v1.12.0)
- Set's a non-conflicting `WORKSPACE_DIR` and `DEFAULT_USER_DATA_DIR` in docker by default.
- Drops support for puppeteer `1.15.0` and adds `1.19.0`.
- Web-based debugger now sends cookies for docker deployments that are secure.

# [1.11.0](https://github.com/browserless/chrome/compare/v1.10.0...v1.11.0)
- Live debugger is now self-hosted, no more enforced https though it's still recommended.
- Consolidated build steps.
- Using the same chromedriver binary that matches the puppeteer's bundled chromium.
- Introducing `trackingId` workflows.
- Fixing unused export's, removing extraneous internal methods.
- `/workspace` API now returns sub-files and scopes sessions by `trackingId` when present.
- Support for `/json/new` protocol.
- Dependency updates.

# [1.10.0](https://github.com/browserless/chrome/compare/v1.9.0...v1.10.0)
- Dropped support for puppeteer `1.9.0 => 1.14.0`.
- Added support for puppeteer `1.16.0 => 1.18.0`.
- A version of chromedriver is now installed to perfectly match the version of puppeteer's chromium.
- In dev, chromedriver now uses the puppeteer version of chromium.
- Defaulted most ENV-variables in docker to sensible defaults.
- New `rotate` feature for PDF endpoint: `{ rotate: 90 }` => rotate left 90 degrees.
- Support for `browserless.token` in the docker image.
- puppeteer integration now returns semantic HTTP codes for certain errors (`400`, `403` and `429`).
- Support for chromedriver's move to the W3C spec 'goog:chromeOptions'.
- The debugger now filters out `about:blank` pages, and includes sessions by Selenium.
- Workspace support for selenium-based integrations.

# [1.9.0](https://github.com/browserless/chrome/compare/v1.8.0...v1.9.0)
- Better handling of browser/socket closing in puppeteer integrations.
- Numerous screencast fixes.
- Moved all GH links to new repo location.
- Dep updates.

# [1.8.0](https://github.com/browserless/chrome/compare/v1.7.0...v1.8.0)
- Better windows dev experience.
- Indian font support.
- Video capture now supports audio and browser width/height.
- Dependency updates.
- DEFAULT env variables for launching pre-booted Chrome.

# 1.7.0
- Dep updates
- New `?blockAds` query-parameter for disabling 3rd-party ad calls.

# 1.6.0
- New `authenticate` and `setExtraHTTPHeaders` params for the `content`, `pdf`, and `screenshot` APIs. Useful for using proxies in our REST APIs.
- Fixed a bunch of bugs inside of the webdriver integration, making it more REST-ful.
- Updated dependencies inside of Chromedriver.
- New `DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR` for mitigating errors in puppeteer < 1.15.0.
- Bumped Puppeteer to 1.15.0.

# 1.5.0
- New `/session` API (and accompanying routes) for display/viewing active sesions in a remote debugger(!).
- New `?pause` query-param for pausing sessions prior to running them (useful for the live debug viewer).
- The browserless debugger now exposes links to these debug pages via the sidebar.
- New Debugger page can be disabled via the `ENABLE_DEBUG_VIEWER=false` environment variable flag.
- Move to use `node@10`.
- No more `no-implicit-any`'s inside the codebase.

# 1.4.0
- During connection, we now set the download dir of REST and puppeteer sessions. Cloud users and docker users no longer have to manually set this field, and the `/workspace` API references it as well!

# 1.3.1

# Fixes
- New deploy.js file to do deployments "on-prem"
- Updated new builds for puppeteer 1.12.2 and 1.13.0
- Fixes an issues in CORS handling

# 1.3.0

# Minor changes
- The `screenshot`, `function`, `pdf`, and `content` API's now accept new content-types for easier POSTing of small payloads (see docsite).
- The `screencast` API can now start/stop recording programmatically via a `startScreencast` and `stopScreencast` params (see docsite).
- New `external` dir for injecting custom `before` and `after` hooks in external docker builds.
- A new `timeout` query-option for session-based timeouts vs using the global one.
- New `requestInterceptors` for injection custom request behavior.

# Fixes
- Numerous default fixes in the APIs.
- Stray consoles removed :)
- Consolidated download behavior in `screencast` and `download` APIs

# 1.2.0

# Minor Changes
- New `requestInterceptors` for the /screenshot API, [allowing you to mock data in response to a request](https://github.com/browserless/chrome/pull/119).
- Code debugger now transmits code over-the-wire via cookies to avoid URL max-length issues.
- Now supports cookie-based authentication via a `browserless_token=TOKEN;` cookie.

# Fixes
- [Comments in the debugger won't break it.](https://github.com/browserless/chrome/issues/118)
- Requests that are rejected due to auth reasons aren't logged in stats.

# 1.1.0

With 1.1.0 we offer a refined way of dealing with both downloads and uploads. Both use-cases are tightly coupled to the file-system, and can leave you scratching your head as to what's going one. For more information and detailed documentation, please refer to our doc-site at https://docs.browserless.io/

## Minor Changes
- New `WORKSPACE_DIR` variable for controlling where browserless stores files and uploads.
- New `/workspace` API for doing RESTful operations on the downloads/uploads file-system.
- New `/download` API for running a puppeteer-script, and responding with the resulting downloaded file.

## Internal Changes
- Moved routes out of the browserless module and into their own file/module.
- Renamed the `browserless-web-service` module to just `browserless` for simplicity.
- Moved the `DOWNLOAD_DIR` to `WORKSPACE_DIR` since it handles both uploads and downloads.

# 1.0.0

🥁 -- Stable version 1.0 is here! While this doesn't include major functionality changes, it _does_ change how the docker builds are generated going forward. The versioning will now contain two pieces of crucial information: the version of the _browserless_ service + the version of Chrome under-the-hood. For instance `1.2.3-puppeteer-1.10.0` is browserless at `1.2.3`, exposing puppeteer at `1.10.0`.

Similar to how NodeJS itself does docker releases, we'll now provide releases in 3 distinct ways:

- An _immutable_, pinned version release: `1.0.0-puppeteer-1.11.0`
- A mutable minor version release: `1.1-puppeteer-1.12.0`
- A mutable major version release: `1-puppeteer-1.9.0`

For production deployments, we recommend using _pinned_ version releases as they won't change once released. The mutable minor/major releases will receive on-going updates whenever we do changes that are bug-fixes or feature release. Even with the best intentions it's possible that instability can be introduced with these mutable images, hence why recommend the pinned version releases.

Finally, we'll continue to ship support for the last 5 minor versions of Puppeteer + the Google Chrome (stable). Old images will remain, but newer versions of browserless won't be included.

We'll continue to keep this changelog up-to-date anytime we do docker releases.
