<!-- markdownlint-disable commands-show-output first-line-h1 no-emphasis-as-heading -->

![browserless.io logo](/assets/logo.png)

![Docker Pulls](https://img.shields.io/docker/pulls/browserless/chrome)
![GitHub package.json version (subfolder of monorepo)](https://img.shields.io/github/package-json/v/browserless/chrome)
![Chrome CI](https://github.com/browserless/chrome/actions/workflows/docker-chromium.yml/badge.svg)
![Firefox CI](https://github.com/browserless/chrome/actions/workflows/docker-firefox.yml/badge.svg)
![Webkit CI](https://github.com/browserless/chrome/actions/workflows/docker-webkit.yml/badge.svg)
![Multi CI](https://github.com/browserless/chrome/actions/workflows/docker-multi.yml/badge.svg)

> [!NOTE]  
> Looking to bypass bot detectors and solve captchas? [We would recommend using BrowserQL as our stealthiest option](https://www.browserless.io/feature/browserql).

Browserless allows remote clients to connect and execute headless work, all inside of docker. It supports the standard, unforked Puppeteer and Playwright libraries, as well offering REST-based APIs for common actions like data collection, PDF generation and more.

We take care of common issues such as missing system-fonts, missing external libraries, and performance improvements, along with edge-cases like downloading files and managing sessions. For details, check out the documentation site built into the project which includes Open API docs.

If you've been struggling to deploy headless browsers without running into issues or bloated resource requirements, then Browserless was built for you. Run the browsers in [our cloud](https://browserless.io/) or your own, [free for non-commercial uses](https://github.com/browserless/browserless#licensing).

## Table of Contents

- [External links](#external-links)
- [Features](#features)
- [How it works](#how-it-works)
  - [Docker](#docker)
  - [Hosting Providers](#hosting-providers)
  - [Puppeteer](#puppeteer)
  - [Playwright](#playwright)
- [Extending (NodeJS SDK)](#extending-nodejs-sdk)
- [Debugger](#debugger)
  - [Install debugger](#install-debugger)
- [Usage with other libraries](#usage-with-other-libraries)
- [Motivations](#motivations)
- [Licensing](#licensing)

## External links

1. [Full documentation site](https://docs.browserless.io/)
2. [Live Debugger (using browserless.io)](https://chrome.browserless.io/)
3. [Docker](https://github.com/browserless/browserless/pkgs/container/base)

## Features

### General

- Parallelism and request-queueing are built-in + configurable.
- Fonts and emoji's working out-of-the-box.
- Debug Viewer for actively viewing/debugging running sessions.
- An interactive puppeteer debugger, so you can see what the headless browser is doing and use its DevTools.
- Works with unforked Puppeteer and Playwright.
- Configurable session timers and health-checks to keep things running smoothly.
- Error tolerant: if Chrome dies it won't.
- Support for running and development on Apple's M1 machines

### Cloud-only

Our [cloud accounts](https://www.browserless.io/pricing/) include all the general features plus extras, such as:

- [BrowserQL](https://www.browserless.io/feature/browserql) for avoiding detectors and solving captchas
- [Hybrid automations](https://www.browserless.io/blog/hybrid-automations-for-puppeteer/) for streaming login windows during scripts
- [/reconnect API](https://www.browserless.io/blog/reconnect-api) for keeping browsers alive for reuse
- [REST APIs](https://www.browserless.io/feature/rest-apis) for tasks such as retrieving HTML, PDFs or Lighthouse metrics
- Inbuilt [residential proxy](https://www.browserless.io/blog/residential-proxying/)
- SSO, tokens and user roles

## How it works

Browserless listens for both incoming websocket requests, generally issued by most libraries, as well as pre-build REST APIs to do common functions (PDF generation, images and so on). When a websocket connects to Browserless it starts Chrome and proxies your request into it. Once the session is done then it closes and awaits for more connections. Some libraries use Chrome's HTTP endpoints, like `/json` to inspect debug-able targets, which Browserless also supports.

You still execute the script itself which gives you total control over what library you want to choose and when to do upgrades. This also comes with the benefit of keep your code proprietary and able to run on numerous platforms. We simply take care of all the browser-aspects and offer a management layer on top of the browser.

### Docker

> [!TIP]
> See more options on our [full documentation site](https://docs.browserless.io/docker/quickstart).

1. `docker run -p 3000:3000 ghcr.io/browserless/chromium`
2. Visit `http://localhost:3000/docs` to see the documentation site.
3. See more at our [docker package](https://github.com/browserless/browserless/pkgs/container/base).

### Hosting Providers

We offer a first-class hosted product located [here](https://browserless.io). Alternatively you can host this image on just about any major platform that offers hosting for docker. Our hosted service takes care of all the machine provisioning, notifications, dashboards and monitoring plus more:

- Easily upgrade and toggle between versions at the press of a button. No managing repositories and other code artifacts.
- Never need to update or pull anything from docker. There's literally zero software to install to get started.
- Scale your consumption up or down with different plans. We support up to thousands of concurrent sessions at a given time.

If you're interested in using this image for commercial aspects, then please read the below section on licensing.

### Puppeteer

Puppeteer allows you to specify a remote location for chrome via the `browserWSEndpoint` option. Setting this for Browserless is a single line of code change.

**Before**

```js
const browser = await puppeteer.launch();
```

**After**

```js
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost:3000',
});
```

### Playwright

We support running with playwright via their their browser's remote connection protocols interface out of the box. Just make sure that your Docker image, playwright browser type _and_ endpoint match:

**Before**

```js
import pw from 'playwright';
const browser = await pw.firefox.launch();
```

**After**

```sh
docker run -p 3000:3000 ghcr.io/browserless/firefox
# or ghcr.io/browserless/multi for all the browsers
```

```js
import pw from 'playwright-core';

const browser = await pw.firefox.connect(
  'ws://localhost:3000/firefox/playwright',
);
```

After that, the rest of your code remains the same with no other changes required.

## Extending (NodeJS SDK)

Browserless comes with built-in extension capabilities, and allows for extending nearly any aspect of the system (for Version 2+). For more details on how to write your own routes, build docker images, and more, [see our SDK README.md](/bin/scaffold/README.md) or simply run "npx @browserless.io/browserless create" in a terminal and follow the onscreen prompts.

## Debugger

You can install a first-party interactive debugger for Browserless, that makes writing scripts faster and interactive. You can take advantage of things like `debugger;` calls and the page's console output to see what's happening on the page while your script is running. All of the Chrome devtools are there at your disposal.

![browserless.io logo](/assets/debugger.png)

A small list of features includes:

- Running `debugger;` and `console.log` calls
- Errors in the script are caught and show up in the console tab
- DOM inspection, watch network requests, and even see how the page is rendering
- Exporting you debugging script as a Node project
- Everything included in Chrome DevTools

### Install debugger

Installing the debugger is as simple as running the `install:debugger` script _after_ the project has been built. This way:

```sh
$ npm run build
$ npm run install:debugger #or npm install:dev
```

You will then see the debugger url during the startup process.

```log
---------------------------------------------------------
| browserless.io
| To read documentation and more, load in your browser:
|
| OpenAPI: http://localhost:3000/docs
| Full Documentation: https://docs.browserless.io/
| Debbuger: http://localhost:3000/debugger/?token=6R0W53R135510
---------------------------------------------------------
```

## Usage with other libraries

Most libraries allow you to specify a remote instance of Chrome to interact with. They are either looking for a websocket endpoint, a host and port, or some address. Browserless supports these by default, however if you're having issues please make an issue in this project and we'll try and work with the library authors to get them integrated with browserless. Please note that in V2 we no longer support selenium or webdriver integrations.

You can find a much larger list of supported libraries [on our documentation site](https://docs.browserless.io/libraries/puppeteer).

## Motivations

Running Chrome on lambda or on your own is a fantastic idea but in practice is quite challenging in production. You're met with pretty tough cloud limits, possibly building Chrome yourself, and then dealing with odd invocation issues should everything else go ok. A lot of issues in various repositories are due to just challenges of getting Chrome running smoothly in AWS (see [here](https://github.com/GoogleChrome/puppeteer/issues?q=is%3Aissue+is%3Aopen+sort%3Acomments-desc)). You can see for yourself by going to nearly any library and sorting issues by most commented.

Getting Chrome running well in docker is also a challenge as there's quiet a few packages you need in order to get Chrome running. Once that's done then there's still missing fonts, getting libraries to work with it, and having limitations on service reliability. This is also ignoring CVEs, access-controls, and scaling strategies.

All of these issues prompted us to build a first-class image and workflow for interacting with Chrome in a more streamlined way. With Browserless you never have to worry about fonts, extra packages, library support, security, or anything else. It just works reliably like any other modern web service. On top of that it comes with a prescribed approach on how you interact with Chrome, which is through socket connections (similar to a database or any other external appliance). What this means is that you get the ability to drive Chrome remotely without having to do updates/releases to the thing that runs Chrome since it's divorced from your application.

## Licensing

SPDX-License-Identifier: SSPL-1.0 OR Browserless Commercial License.

If you want to use Browserless to build commercial sites, applications, or in a continuous-integration system that's closed-source then you'll need to purchase a commercial license. This allows you to keep your software proprietary whilst still using browserless. [You can purchase a commercial license here](https://www.browserless.io/contact). A commercial license grants you:

- Priority support on issues and features.
- On-premise running as well as running on public cloud providers for commercial/CI purposes for proprietary systems.
- Ability to modify the source (forking) for your own purposes.
- A new admin user-interface.

Not only does it grant you a license to run such a critical piece of infrastructure, but you are also supporting further innovation in this space and our ability to contribute to it.

If you are creating an open source application under a license compatible with the Server Side License 1.0, you may use Browserless under those terms.

asfd
