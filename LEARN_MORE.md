# Learn More

## How it works

Browserless listens for both incoming websocket requests, generally issued by most libraries, as well as pre-build REST APIs to do common functions (PDF generation, images and so on). When a websocket connects to Browserless it starts Chrome and proxies your request into it. Once the session is done then it closes and awaits for more connections. Some libraries use Chrome's HTTP endpoints, like `/json` to inspect debug-able targets, which Browserless also supports.

You still execute the script itself which gives you total control over what library you want to choose and when to do upgrades. This also comes with the benefit of keep your code proprietary and able to run on numerous platforms. We simply take care of all the browser-aspects and offer a management layer on top of the browser.

### Docker

> [!TIP]
> See more options on our [full documentation site](https://docs.browserless.io/baas/docker/quickstart).

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

We support running with playwright via their browser's remote connection protocols interface out of the box. Just make sure that your Docker image, playwright browser type _and_ endpoint match:

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

<p>
  <a href="https://browserless.io/">
    <img src="https://img.shields.io/badge/🧪_Try_on_Cloud-4A90E2?style=for-the-badge" alt="Try on Cloud" />
  </a>
  &nbsp;&nbsp;
  <a href="#-1-minute-quickstart">
    <img src="https://img.shields.io/badge/📦_Run_Locally-34A853?style=for-the-badge" alt="Run Locally" />
  </a>
  &nbsp;&nbsp;
  <a href="https://docs.browserless.io/">
    <img src="https://img.shields.io/badge/📘_Dev_Docs-5C6AC4?style=for-the-badge" alt="Developer Docs" />
  </a>
</p>
