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
