<!-- markdownlint-disable commands-show-output first-line-h1 no-emphasis-as-heading no-inline-html -->

<div align="center">
  <a href="https://browserless.io" align="center">
    <center align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./assets/logo-white.svg" width="600">
        <source media="(prefers-color-scheme: light)" srcset="./assets/logo.svg" width="600">
        <img src="./assets/logo.svg" alt="Browserless logo" width="600">
      </picture>
    </center>
  </a>

  <h3>Deploy headless browsers in Docker. Run on our cloud or bring your own.</h3>

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

  <p>
    <a href="https://trendshift.io/repositories/4378" target="_blank"><img src="https://trendshift.io/api/badge/repositories/4378" alt="browserless%2Fbrowserless | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
  </p>

  <p>
    <a href="https://hub.docker.com/r/browserless/chrome">
      <img src="https://img.shields.io/docker/pulls/browserless/chrome?style=flat-square" alt="Docker pulls" />
    </a>
    <a href="https://github.com/browserless/browserless">
      <img src="https://img.shields.io/github/stars/browserless/browserless?style=flat-square" alt="GitHub stars" />
    </a>
    <a href="https://github.com/browserless/browserless/tags">
      <img src="https://img.shields.io/github/package-json/v/browserless/chrome?style=flat-square" alt="Version" />
    </a>
    <a href="https://status.browserless.io/">
      <img src="https://img.shields.io/badge/Status-Operational-success?style=flat-square" alt="Status" />
    </a>
  </p>
</div>

<br>

## 📋 Table of Contents

- [Get Started in Seconds](#-get-started-in-seconds)
- [Features](#-features)
- [Customisable Deployment Options](#-customisable-deployment-options)
- [Why Browserless?](#-why-browserless)
- [Licensing](#-licensing)


## 🚀 Get Started in Seconds!

Get up and running in three simple steps:

### Step 1: Run the Docker image
```bash
docker run -p 3000:3000 ghcr.io/browserless/chromium
```
### Step 2: Open the docs in your browser
Visit http://localhost:3000/docs

**✅ Success!** Your browser service is live at `ws://localhost:3000`

### Step 3: Connect your script with Puppeteer or Playwright

<details open>
<summary><b>📘 Puppeteer Example</b></summary>

```js
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://localhost:3000',
});

const page = await browser.newPage();
await page.goto('https://example.com');
console.log(await page.title());
await browser.close();
```

</details>

<details>
<summary><b>🎭 Playwright Example</b></summary>

```js
import pw from 'playwright-core';

const browser = await pw.firefox.connect(
  'ws://localhost:3000/firefox/playwright'
);

const page = await browser.newPage();
await page.goto('https://example.com');
console.log(await page.title());
await browser.close();
```

 **Note:** Use `ghcr.io/browserless/firefox` or `ghcr.io/browserless/multi` for Firefox/Webkit support.

</details>

</br>

### Output:
```
Example Domain
```


## ✨ Features

### General Features

- **Parallelism and queueing** — Handle multiple sessions with configurable concurrency limits
- **Debug Viewer** — Actively view and debug running browser sessions in real-time
- **Unforked libraries** — Works seamlessly with standard Puppeteer and Playwright
- **Fonts & emoji** — All system fonts and emoji support out-of-the-box
- **Configurable timeouts** — Set session timers and health-checks to keep things running smoothly
- **Error tolerant** — If Chrome crashes, Browserless won't
- **ARM64 architecture support** — Full support for ARM64 platforms including Apple Silicon; some browsers (Edge, Chrome) have limited ARM64 compatibility

### Premium Features

Our [Self-serve cloud and Enterprise offerings](https://www.browserless.io/pricing/) include all the general features plus extras, such as:

- **[BrowserQL](https://www.browserless.io/feature/browserql)** for avoiding detectors and solving captchas
- **[Hybrid automations](https://docs.browserless.io/baas/interactive-browser-sessions/hybrid-automation)** for streaming live browser sessions during scripts
- **[Persistent Sessions](https://docs.browserless.io/baas/session-management/persisting-state)** for persisting browser state (cookies, cache, localStorage) across multiple sessions with configurable data retention up to 90 days
- **[Session Replay](https://docs.browserless.io/baas/interactive-browser-sessions/session-replay)** for recording and debugging browser sessions with event capture and video playback
- **[Chrome Extensions Support](https://docs.browserless.io/baas/features/browser-extensions)** for loading custom extensions including ad blockers, captcha solvers, etc.
- **[Advanced Captcha/Stealth Routes](https://docs.browserless.io/browserql/bot-detection/overview)** for enhanced anti-detection with Captcha solving, fingerprint randomization, and residential proxy rotation
- **[REST APIs](https://www.browserless.io/feature/rest-apis)** for tasks such as retrieving HTML, PDFs or Screenshot etc.
- **[Inbuilt residential proxy](https://www.browserless.io/blog/residential-proxying/)** for automatic IP rotation and geo-targeting with residential proxy networks
- **[Webhook Integrations](https://docs.browserless.io/enterprise/docker/webhooks)** for queue alerts, rejections, timeouts, errors, and health failures

## 🚢 Customisable Deployment Options

Select the deployment model that best fits your needs:

<table>
<tr>
<td width="50%" valign="top">

### 🔓 Open Source (Self-Hosted)

Free, self-hosted solution with core browser automation capabilities.

**Best for:** Testing, development, and small projects

[↓ Quickstart above](#-get-started-in-seconds)

</td>
<td width="50%" valign="top">

### 🏢 Enterprise Docker (Self-Hosted)

Full Enterprise features in a self-hosted container.

**Best for:** Production workloads requiring data sovereignty

[→ Learn More](https://www.browserless.io/pricing/)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ☁️ Cloud (Self-Serve)

Fully managed, pay-as-you-go service with automatic scaling.

**Best for:** Quick starts and rapid prototyping

[→ Start Free](https://browserless.io/)

</td>
<td width="50%" valign="top">

### 🔒 Private Deployment

Custom Enterprise infrastructure across major cloud providers.

**Best for:** Large-scale enterprise deployments

[→ Contact Sales](https://www.browserless.io/contact)

</td>
</tr>
</table>


> **Want to dive deeper?** Check out this [detailed guide](./LEARN_MORE.md) for advanced stuff including Docker configuration, hosting providers, SDK extensions, and more.


## 💡 Why Browserless?

**Running Chrome in the cloud or CI sucks.**

Missing fonts. Random crashes. Dependency hell. Lambda limits. You know the drill.

**Browserless solves this** by handling browsers as a managed service — locally or in our cloud — so you can focus on automation, not infrastructure. We've taken care of the hard parts: system packages, font libraries, security patches, scaling strategies, and CVEs.

You still own your script. You still control your code. We just make sure the Browser runs smoothly, every time.

## 📜 Licensing

SPDX-License-Identifier: SSPL-1.0 OR Browserless Commercial License.

If you want to use Browserless to build commercial sites, applications, or in a continuous-integration system that's closed-source then you'll need to purchase a commercial license. This allows you to keep your software proprietary whilst still using browserless. [You can purchase a commercial license here](https://www.browserless.io/contact). A commercial license grants you:

- Priority support on issues and features.
- On-premise running as well as running on public cloud providers for commercial/CI purposes for proprietary systems.
- Ability to modify the source (forking) for your own purposes.
- A new admin user-interface.

Not only does it grant you a license to run such a critical piece of infrastructure, but you are also supporting further innovation in this space and our ability to contribute to it.

If you are creating an open source application under a license compatible with the Server Side License 1.0, you may use Browserless under those terms.

<div align="center">

**Happy hacking!**

Need help? Reach out to us at **support@browserless.io**

</div>
