![browserless splash logo](https://raw.githubusercontent.com/browserless/chrome/master/assets/splash.png)

[![Build Status](https://travis-ci.org/browserless/chrome.svg?branch=master)](https://travis-ci.org/browserless/chrome)
![Dependabot](https://flat.badgen.net/badge/-/dependabot?icon=dependabot&label&color=green)

browserless is a web-service that allows for remote clients to connect, drive, and execute headless work; all inside of docker. It offers first-class integrations for puppeteer, playwright, selenium's webdriver, and a slew of handy REST APIs for doing more common work. On top of all that it takes care of other common issues such as missing system-fonts, missing external libraries, and performance improvements. We even handle edge-cases like downloading files, managing sessions, and have a fully-fledged documentation site.

If you've been struggling to get Chrome up and running docker, or scaling out your headless workloads, then browserless was built for you.
# Table of Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Docker](#docker)
4. [Using the debuggers](#live-debugger)
5. [Recommended NGINX Config](#Recommended-NGINX-Config)
6. [Hosting](#hosting-providers)
7. [Using with puppeteer](#puppeteer)
8. [Using with selenium](#webdriver)
9. [Using with playwright](#playwright)
10. [Licensing](#licensing)
12. [Changelog](https://github.com/browserless/chrome/blob/master/CHANGELOG.md)

## External links

1. [Full documentation site](https://docs.browserless.io/)
2. [Live Debugger (using browserless.io)](https://chrome.browserless.io/)
3. [Docker](https://hub.docker.com/r/browserless/chrome/)
4. [Slack](https://join.slack.com/t/browserless/shared_invite/enQtMzA3OTMwNjA3MzY1LTRmMWU5NjQ0MTQ2YTE2YmU3MzdjNmVlMmU4MThjM2UxODNmNzNlZjVkY2U2NjdkMzYyNTgyZTBiMmE3Nzg0MzY)

# Features

- Parallelism and queueing are built-in and configurable.
- Fonts and emoji's working out-of-the-box.
- Debug Viewer for actively viewing/debugging running sessions.
- Docker releases that are built for specific puppeteer versions.
- Docker image's are labelled with information on the version of Chrome, V8, webkit and more.
- An interactive puppeteer debugger, so you can see what the headless browser is doing and use its DevTools.
- Works with most headless libraries.
- Configurable session timers and health-checks to keep things running smoothly.
- Error tolerant: if Chrome dies it won't.

# How it works

browserless listens for both incoming websocket requests, generally issued by most libraries, as well as pre-build REST APIs to do common functions (PDF generation, images and so on). When a websocket connects to browserless it invokes Chrome and proxies your request into it. Once the session is done then it closes and awaits for more connections. Some libraries use Chrome's HTTP endpoints, like `/json` to inspect debug-able targets, which browserless also supports.

Your application still runs the script itself (much like a database interaction), which gives you total control over what library you want to choose and when to do upgrades. This is preferable over other solutions as Chrome is still breaking their debugging protocol quite frequently.

# Docker

> See more options on our [full documentation site](https://docs.browserless.io/docs/docker.html).

1. `docker run -p 3000:3000 browserless/chrome`
2. Visit `http://localhost:3000/` to use the interactive debugger.
3. See more at our [docker repository](https://hub.docker.com/r/browserless/chrome/).

# Live Debugger

![Browserless Debugger](https://raw.githubusercontent.com/browserless/chrome/master/assets/demo.gif)

browserless comes with _two_ methods of debugging. The first is a web-based debugger for trying out small chunks of code without setting up a new project. You can see our public-facing [debugger here](https://chrome.browserless.io/).

The second method is an active-session debugger. When browserless runs http requests, and puppeteer sessions, it keeps track of some browser state, and makes those sessions available for debugging. You can simply load the web-based debugger in the browser, and click the menu icon in the top-left. It'll reveal all currently running sessions and a link to "view" them in Chrome's remote devtools. You can also query the `/session` API to get a JSON representation of sessions as well.

If you're using the active-session debugger, and it's executing too fast, you can apply a `?pause` query parameter to your `puppeteer.connect` call (or HTTP REST calls) and browserless will pause your script until the debugger connects. This way you don't any critical actions!

browserless ships with an interactive debugger that makes writing scripts faster and interactive. You can use things like `debugger;` and `console.log` to capture what's happening on the page while your script is running. All of the Chrome devtools are there at your disposal. A small list of features includes:

- Using debugging concepts like `debugger;` and `console.log`
- Errors in the script are caught and show up in the `console` tab
- You can inspect the DOM, watch network requests, and even see how the page is rendering
- Coming soon you'll be able to export the script which will produce a `index.js` and a `package.json` to get things going

# Recommended NGINX Config

If you're using nginx in front of the docker image (or Node) then you'll need to proxy through Upgrade headers. Below is an example of a location block that does such:

```
location / {
    proxy_pass YOUR_DOCKER_IMAGE_LOCATION;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
```

# Hosting Providers

We offer a first-class hosted product located [here](https://browserless.io). Alternatively you can host this image on just about any major platform that offers hosting for docker. The hosted service takes care of all the machine provisioning, notifications, dashboards and monitoring plus more:

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
await puppeteer.connect({ browserWSEndpoint: 'ws://localhost:3000' });
```

# Webdriver (selenium)

Getting started with Selenium and webdriver couldn't be easier. Once browserless is up and running simply update your application or test to use it as a remote connection:

**Before**
```js
const webdriver = require('selenium-webdriver');
const fs = require('fs');

const chromeCapabilities = webdriver.Capabilities.chrome();
chromeCapabilities.set(
  'chromeOptions', {
    args: [
      '--headless',
      '--no-sandbox',
    ],
  }
);

const driver = new webdriver.Builder()
  .forBrowser('chrome')
  .withCapabilities(chromeCapabilities)
  .build();
```

**After**
```js
const webdriver = require('selenium-webdriver');
const fs = require('fs');

const chromeCapabilities = webdriver.Capabilities.chrome();
chromeCapabilities.set(
  'chromeOptions', {
    args: [
      '--headless',
      '--no-sandbox',
    ],
  }
);

const driver = new webdriver.Builder()
  .forBrowser('chrome')
  .withCapabilities(chromeCapabilities)
  .usingServer('http://localhost:3000/webdriver') // <-- Apply usingServer and that's it
  .build();
```

# Playwright

We support running with playwright via their remote connection method on the `chromium` interface. Since playwright is very similar to puppeteer, even launch arguments and other things "just work":

**Before**
```js
const browser = await pw.chromium.launch();
```

**After**
```js
const browser = await pw.chromium.connect({
  browserWSEndpoint: 'wss://chrome.browserless.io?token=YOUR-API-TOKEN',
});
```

After that, the rest of your code remains the same with no other changes required.

# Usage with other libraries

Most libraries allow you to specify a remote instance of Chrome to interact with. They are either looking for a websocket endpoint, a host and port, or some address. Browserless supports these by default, however if you're having issues please make an issue in this project and we'll try and work with the library authors to get them integrated with browserless.

You can find a much larger list of supported libraries [on our documentation site](https://docs.browserless.io/docs/puppeteer-library.html).

# Motivations

Running Chrome on lambda is a fantastic idea but in practice is quite challenging. You're met with pretty tough upload limits, building Chrome yourself, and then dealing with odd invocation issues should everything else go ok. A lot of issues in various repositories are due to just challenges of getting Chrome running smoothly in AWS (see [here](https://github.com/GoogleChrome/puppeteer/issues?q=is%3Aissue+is%3Aopen+sort%3Acomments-desc)). You can see for yourself by going to nearly any library and sorting issues by most commented.

Getting Chrome running well in docker is also a challenge as there's quiet a few packages you need in order to get Chrome running. Once that's done then there's still missing fonts, getting libraries to work with it, and having limitations on service reliability.

All of these issues prompted me to build a first-class image and workflow for interacting with Chrome in a more streamlined way. With browserless you never have to worry about fonts, extra packages, library support, or anything else. It should just work. On top of that it comes with a prescribed approach on how you interact with Chrome, which is through socket connections (similar to a database or any other external appliance). What this means is that you get the ability to drive Chrome remotely without having to do updates/releases to the thing that runs Chrome since it's divorced from your application.

# Licensing

If you want to use browserless to build commercial sites, applications, or in a continuous-integration system that's closed-source then you'll need to purchase a commercial license. This allows you to keep your software proprietary whilst still using browserless. [You can purchase a commercial license here](https://www.browserless.io/sign-up?type=commercial). A commercial license grants you:

- Priority support on issues and features.
- On-premise running as well as running on public cloud providers for commercial/CI purposes for proprietary systems.
- Ability to modify the source (forking) for your own purposes.

Not only does it grant you a license to run such a critical piece of infrastructure, but you are also supporting further innovation in this space and our ability to contribute to it!

If you are creating an open source application under a license compatible with the GNU GPL license v3, you may use browserless under the terms of the GPLv3. You can read more about this license [here](https://www.gnu.org/licenses/quick-guide-gplv3.en.html).
