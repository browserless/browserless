<div align="center">
  <img src="https://raw.githubusercontent.com/browserless/chrome/master/assets/browserless_logo_screen_gradient.png">
</div>

> [Looking for v1.x.x of browserless? Check it out here](https://github.com/browserless/chrome/tree/v1).
> NOTE: Version 1 is the version we currently still have running on browserless' hosted services.

browserless is a web-based service that allows for remote clients to connect and execute headless work; all inside of docker. It supports new libraries like Puppeteer and Playwright, aiming to replace antiquated or in-house systems. We also bundle numerous handy REST-based APIs for doing more common actions like data collection, PDF generation and more.

We also take care of other common issues such as missing system-fonts, missing external libraries, and performance improvements. We even handle edge-cases like downloading files, managing sessions, and have a full documentation site built into the project which includes Open API docs.

If you've been struggling to get a browser up and running docker, or scaling out your headless workloads, then browserless was built for you.
# Table of Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Docker](#docker)
4. [Hosting](#hosting-providers)
5. [Puppeteer](#puppeteer)
6. [Playwright](#playwright)
7. [Licensing](#licensing)
8. [Changelog](https://github.com/browserless/chrome/blob/master/CHANGELOG.md)

## External links

1. [Full documentation site](https://www.browserless.io/docs/start)
2. [Live Debugger (using browserless.io)](https://chrome.browserless.io/)
3. [Docker](https://github.com/browserless/chrome/pkgs/container/basic)
4. [Slack](https://join.slack.com/t/browserless/shared_invite/enQtMzA3OTMwNjA3MzY1LTRmMWU5NjQ0MTQ2YTE2YmU3MzdjNmVlMmU4MThjM2UxODNmNzNlZjVkY2U2NjdkMzYyNTgyZTBiMmE3Nzg0MzY)

# Features

- Parallelism and request-queueing are built-in + configurable.
- Fonts and emoji's working out-of-the-box.
- Debug Viewer for actively viewing/debugging running sessions.
- An interactive puppeteer debugger, so you can see what the headless browser is doing and use its DevTools.
- Works with most headless libraries.
- Configurable session timers and health-checks to keep things running smoothly.
- Error tolerant: if Chrome dies it won't.
- [Support for running and development on Apple's M1 machines](#building-for-arm64-apple-m1-machines)

# How it works

browserless listens for both incoming websocket requests, generally issued by most libraries, as well as pre-build REST APIs to do common functions (PDF generation, images and so on). When a websocket connects to browserless it starts Chrome and proxies your request into it. Once the session is done then it closes and awaits for more connections. Some libraries use Chrome's HTTP endpoints, like `/json` to inspect debug-able targets, which browserless also supports.

You still execute the script itself which gives you total control over what library you want to choose and when to do upgrades. This also comes with the benefit of keep your code proprietary and able to run on numerous platforms. We simply take care of all the browser-aspects and offer a management layer on top of the browser.

# Docker

> See more options on our [full documentation site](https://www.browserless.io/docs/docker-quickstart).

1. `docker run -p 3000:3000 ghcr.io/browserless/basic`
2. Visit `http://localhost:3000/docs` to see the documentation site.
3. See more at our [docker package](https://github.com/browserless/chrome/pkgs/container/basic).

# Hosting Providers

We offer a first-class hosted product located [here](https://browserless.io). Alternatively you can host this image on just about any major platform that offers hosting for docker. Our hosted service takes care of all the machine provisioning, notifications, dashboards and monitoring plus more:

- Easily upgrade and toggle between versions at the press of a button. No managing repositories and other code artifacts.
- Never need to update or pull anything from docker. There's literally zero software to install to get started.
- Scale your consumption up or down with different plans. We support up to thousands of concurrent sessions at a given time.

If you're interested in using this image for commercial aspects, then please read the below section on licensing.

# Puppeteer

Puppeteer allows you to specify a remote location for chrome via the `browserWSEndpoint` option. Setting this for browserless is a single line of code change.

**Before**
```js
const browser = await puppeteer.launch();
```

**After**
```js
const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://localhost:3000' });
```

# Playwright

We support running with playwright via their remote connection method on the `chromium` interface. Since playwright is very similar to puppeteer, even launch arguments and other things "just work":

**Before**
```js
const browser = await pw.chromium.launch();
```

**After**
```js
const browser = await pw.chromium.connect('ws://localhost:3000/playwright/chromium');

// OR
const browser = await pw.chromium.connectOverCDP('ws://localhost:3000');
```

After that, the rest of your code remains the same with no other changes required.

# Usage with other libraries

Most libraries allow you to specify a remote instance of Chrome to interact with. They are either looking for a websocket endpoint, a host and port, or some address. Browserless supports these by default, however if you're having issues please make an issue in this project and we'll try and work with the library authors to get them integrated with browserless. Please note that in V2 we no longer support selenium or webdriver integrations.

You can find a much larger list of supported libraries [on our documentation site](https://www.browserless.io/docs/puppeteer-library).

# Motivations

Running Chrome on lambda or on your own is a fantastic idea but in practice is quite challenging in production. You're met with pretty tough cloud limits, possibly building Chrome yourself, and then dealing with odd invocation issues should everything else go ok. A lot of issues in various repositories are due to just challenges of getting Chrome running smoothly in AWS (see [here](https://github.com/GoogleChrome/puppeteer/issues?q=is%3Aissue+is%3Aopen+sort%3Acomments-desc)). You can see for yourself by going to nearly any library and sorting issues by most commented.

Getting Chrome running well in docker is also a challenge as there's quiet a few packages you need in order to get Chrome running. Once that's done then there's still missing fonts, getting libraries to work with it, and having limitations on service reliability. This is also ignoring CVEs, access-controls, and scaling strategies.

All of these issues prompted us to build a first-class image and workflow for interacting with Chrome in a more streamlined way. With browserless you never have to worry about fonts, extra packages, library support, security, or anything else. It just works reliably like any other modern web service. On top of that it comes with a prescribed approach on how you interact with Chrome, which is through socket connections (similar to a database or any other external appliance). What this means is that you get the ability to drive Chrome remotely without having to do updates/releases to the thing that runs Chrome since it's divorced from your application.

# Licensing

SPDX-License-Identifier: SSPL-1.0 OR Browserless Commercial License.

If you want to use browserless to build commercial sites, applications, or in a continuous-integration system that's closed-source then you'll need to purchase a commercial license. This allows you to keep your software proprietary whilst still using browserless. [You can purchase a commercial license here](https://www.browserless.io/contact). A commercial license grants you:

- Priority support on issues and features.
- On-premise running as well as running on public cloud providers for commercial/CI purposes for proprietary systems.
- Ability to modify the source (forking) for your own purposes.
- A new admin user-interface.

Not only does it grant you a license to run such a critical piece of infrastructure, but you are also supporting further innovation in this space and our ability to contribute to it.

If you are creating an open source application under a license compatible with the Server Side License 1.0, you may use browserless under those terms.
