# Your Browserless.io SDK Project

Welcome to your browserless.io SDK project! This readme will help you get started and running as quickly as possible. Below is a handy Table of Contents in order to find what you're looking for fastest.

Please note that, as of right now, breaking changes aren't yet reflected in our semantic versioning. You can think of this SDK as still in beta for the time being, and we'll carefully document any major or breaking changes in future releases of Browserless.

Finally, this SDK and Browserless.io are built to support businesses and enterprise clients. If you're looking to use our code and modules in a production environment, [please contact us to get appropriately licensed](https://www.browserless.io/contact).

## Table of Contents

- [Quick Start](#quick-start)
- [About](#about)
- [The CLI](#the-cli)
- [Routing](#routing)
- [Utilities](#utilities)
- [Extending Modules](#extending-modules)
- [Disabling Routes](#disabling-routes)
- [Serving Static Files](#serving-static-files)
- [Implementing Hooks](#implementing-hooks)
- [Running in Development](#running-in-development)
- [Building for Production](#building-for-production)
- [Running without Building](#running-without-building)
- [Docker](#docker)
- [Licensing](#licensing)

## Quick Start

To start a new project, simply run this command in a folder of your choosing and follow the prompts:

```sh
npx @browserless.io/browserless create
```

browserless will install a scaffolded project, install dependencies, and establish a simple "hello-world" REST API route. There's a lot you can do within this framework, so be sure to dive into all the details below!

## About

The Browserless.io SDK and accompanying CLI were written with intention that developers can add and enhance functionality into Browserless for your needs. This way you can get results into a database, third-party uploads, work within your enterprises requirements, all while using your favorite modern libraries. The Browserless platform simply ensure system stability, authorization, and the best developer experience.

When creating a new project, the scaffold will ask a series of questions and generate the project for you. Once complete, a list of files it created for you. Here's the list so far:

```
├── node_modules
├── build
├── src
│    └── hello-world.http.ts
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
└── tsconfig.json
```

These are the files included and what they do:

- `node_modules` The projects underlying dependencies. Feel free to add whatever you'd want.
- `build` The built project after TypeScript has run and produced a NodeJS compatible project.
- `src` Routes, modules, and other files need to go here in order for them to be included.
- `src/hello-world.http.ts` An example "Hello World" HTTP-based route.
- `.gitignore` Files to ignore from git (node_modules and build for example).
- `package.json` Your project's package.json file.
- `package-lock.json` Your projects locked dependency manifest file.
- `README.md` This README file.
- `tsconfig.json` The TypeScript configuration JSON file. Extends browserless' own.

Aside form scaffolding the project, Browserless also looks for the following:

- `*.http.ts` Files with this name convention are treated as HTTP routes.
- `*.websocket.ts` Files with this naming convention are treated as WebSocket routes.
- `config.ts` Loads the default export here as a config override.
- `file-system.ts` Loads the default export here as a file-system override.
- `hooks.ts` Loads the default export as a Hooks override.
- `limiter.ts` Loads the default export here as a limiter override (concurrency).
- `metrics.ts` Loads the default export as a metrics override.
- `monitoring.ts` Loads the default export as a monitoring override.
- `router.ts` Loads the default export as a routing override.
- `token.ts` Loads the default export as a token override.
- `webhooks.ts` Loads the default export as a WebHook override.

When enhancing overrides it's highly recommended to extend the existing implementation versus re-implementing the entire module. You can either default export a Class or an instance of a class and Browserless will handle it appropriately for you. This is useful if your enhancements require new constructor arguments or other features. See below for more details.

Once you're satisfied with your work, you can run `npm start` and Browserless will compile your TypeScript, generate runtime validation, generate the embedded documentation site, and start the development server.

Finally, once you're ready to build the docker image, simply execute `npm run docker` and follow the steps to build your docker image.

With these components and enhancements you can extend practically any part of Browserless: add new browsers, support multiple token authentication, save things to a file-system or external platform, push things to S3 buckets, and way more!

## The CLI

Alongside the SDK that Browserless ships with, you'll also get a handy CLI that can help with all aspects of extending Browserless. Most of the CLI commands are ran as `npm run *` commands as is common in NodeJS projects. These are listed in the package.json "scripts" property for your reference.

Similarly, you can simply run these commands by doing:

```sh
$ npx @browserless.io/browserless $COMMAND
```

For instance, to print the help text, simply execute:

```sh
$ npx @browserless.io/browserless help
```

For help with a specific command, you can also run:

```sh
$ npx npx @browserless.io/browserless help start
```

By default most commands are non-interactive, such as the `build` and `dev` commands. Others, like the `docker` commands, can operate in a interactive or non-interactive mode when the correct switches are applied.

## Routing

Routing is based upon the JavaScript `class` fundamentals, and extends core classes inside of Browserless. Many of the features of Browserless are exposed as options on routes so you can define many types of functionality with just a simple route definition.

Browserless has 4 different types of primitive routes:

- HTTP Routes.
- HTTP Routes that require a browser.
- WebSockets Routes.
- WebSocket Routes require a browser.

Internally, we use this same class-based system, so feel free to see how those work in our open-source repositories. All routes are TypeScript-based and all our modules are documented, so you should be able to effectively write routes and modules with your code editor and not necessarily need these examples open. Below are a few examples:

### Basic HTTP Route

```ts
import {
  APITags,
  HTTPRoute,
  Logger,
  Methods,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';

// Response schemas must be typed "ResponseSchema" and are documented for you and
// shown in the built-in documentation site.
export type ResponseSchema = string;

// Similar to React and other ecosystems, extend our basic HTTPRoute
export default class HelloWorldRoute extends HTTPRoute {
  // Must have a unique name for things like disabling to work if desired
  name = 'PDFToS3Route';

  // Detail any content-types that this route should except. "contentTypes.any" here means any content-type.
  // If the content-type does not match then a 404 will be sent back
  accepts = [contentTypes.any];

  // A boolean to indicate if authorization (token auth) is required to access this route. Can also be a function
  // that returns a boolean with the request object being the only argument.
  auth = true;

  // If this route requires a browser. `null` indicates no browser needed.
  browser = null;

  // Does this route need to be limited by the global concurrency limit? Set to "true" if so
  concurrency = false;

  // The returned content-type of this route. Shown in the documentation site.
  contentTypes = [contentTypes.text];

  // A description for this route and what it does. Gets displayed inside the documentation site.
  description = `Returns a simple "Hello World!" response.`;

  // Define what method that this route will listen for. Other methods will 404.
  method = Methods.get;

  // The path that this route will listen on requests for.
  path = ['/hello'];

  // A list of arbitrary tags to group similar APIs with in the documentation site.
  tags = [APITags.management];

  // Handler is a function, getting the request and response objects, and is where you'll write the
  // core logic behind this route. Use utilities like writeResponse or writeJSONResponse to help
  // return the appropriate response.
  async handler(_req, res, _logger: Logger): Promise<void> {
    const response: ResponseSchema = 'Hello World!';
    return writeResponse(res, 200, ResponseSchema, contentTypes.text);
  }
}
```

### Chromium WebSocket Route

```ts
import {
  APITags,
  BrowserWebsocketRoute,
  ChromiumCDP,
  CDPLaunchOptions,
  Logger,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

// Use "QuerySchema" here to define what query-parameters are allowed
// which get parsed into the documentation site.
export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class ChromiumWebSocketRoute extends BrowserWebsocketRoute {
  // Must have a unique name for things like disabling to work if desired
  name = 'ChromiumWebSocketRoute';

  // This route requires a valid authorization token.
  auth = true;

  // This route uses the built-in ChromiumCDP class (Chromium)
  browser = ChromiumCDP;

  // This route is limited by the global concurrency limiter
  concurrency = true;

  // Short description of the route and what it does shown on the documentation site
  description = `Launch and connect to Chromium with a library like puppeteer or others that work over chrome-devtools-protocol.`;

  // This route is available on the '/' route
  path = [WebsocketRoutes['/']];

  // This is a browser-based WebSocket route so we tag it as such
  tags = [APITags.browserWS];

  // Routes with a browser type get a browser argument of the Browser instance, otherwise
  // request, socket, and head are the other 3 arguments. Here we pass them through
  // and proxy the request into Chromium to handle.
  async handler(req, socket, head, logger, chromium): Promise<void> {
    return chromium.proxyWebSocket(req, socket, head);
  }
}
```

Many more examples can be seen in `src/routes` as we use this same routing semantic internally.

## Utilities

Browserless comes out-of-the-box with many utilities and functions to help with extending. Below are a few that we think are helpful and you may wish to use. All exports, including types, in browserless happen in the `@browserless.io/browserless` dependency, so simply require them from that path.

- `id()` Function that generates a random UUID string.
- `createLogger(domain: string)` Creates a debug instance with `browserless:` prepended to the name of the message.
- `dedent(message)` Useful for backtick strings, which this function cleans up white space
- `isConnected(res)` Checks if the underlying connection is still there. Useful for exiting early if a request disconnects.
- `writeResponse(res, code, message, contentType)` Function that writes a basic response, excepting the Response object, the HTTP Code, the message and the content type.
- `jsonResponse(res, code, object)` Function that writes JSON responses back with the appropriate headers.
- `getTokenFromRequest(req)` Gets the token from the request, whether it be a token parameter Basic/Bearer Authorization header. Token query-parameter is checked first.
- `readBody(req)` Parses the request's body and returns the result as a string or object for JSON content-types.
- `safeParse(JSON)` Attempts to parse the input from JSON to object, returning null if it fails.
- `sleep(milliseconds)` Sleeps or waits for the number of milliseconds passed. Async.
- `exists(filePath)` Checks if the file-path exists, returning a boolean. Async.
- `fileExists(filePath)` Checks if a file-path exists and is a file (not a directory). Async.
- `availableBrowsers` Returns an array of installed browsers on the image or system. Async and cached after the first call.
- `noop` A function that does... nothing. Do you do something?
- `once(func)` Wraps a function so it is only called one time.
- `encrypt(plainText, secret)` Encrypts the text with a secret, using Node's `createCipheriv` and `randomBytes(16)`.
- `decrypt(encryptedText, secret)` Attempts to decrypt the encrypted-text using the provided secret.
- `untildify(path)` Remove `~` characters from a path and returns the full filepath.

### Error helpers:

- `BadRequest` An error that will cause browserless to return a `400` response with the error text being the message.
- `TooManyRequests` When thrown causes browserless to return a `429` with the error as the message.
- `ServerError` Returns a `500` code and shows the corresponding message.
- `Unauthorized` Returns a `401` error code and shows the corresponding message.
- `NotFound` When thrown causes a `404` to show with the error message.
- `Timeout` When thrown causes a `408` to be returned with the error message.

## Extending Modules

Browserless comes with a batteries-loaded approach, and includes core modules for you to use or extend. Extending is generally recommended as it allows you to add features you care about without re-implementing the entirety of the module.

Module extension is only recommended for core cases where things like routing don't already work. Keep in mind: the more you extend the more you "opt-in" to ongoing maintenance and changes! With that in mind, you can freely look at the modules in our open-source project to get an idea for how they work and run. Otherwise, feel to keep reading!

**Extending Config**

The easiest module to extend is the Configuration module, as it's usage is pretty simple and straightforward. Here, we're going to add another property that we'll use later in a route. Doing this makes properties available in all routes, and makes a more pleasant route authoring experience. Routes can load modules, look at process variables and more, so it's up to you to decide where you'd like to place things like configuration.

```ts
// src/config.ts
import { Config } from '@browserless.io/browserless';

// Your config class must be the default export
// and you can export the Class or an instance of it.
export default class MyConfig extends Config {
  public getS3Bucket(): string {
    // Load from environment variables or default to some other named bucket.
    return process.env.S3_BUCKET ?? 'my-fun-s3-bucket';
  }
}
```

Then, later, in your route you can define some functionality and load the config object. Let's make a PDF route that generates a PDF from a URL and then saves the result to this S3 bucket.

```ts
// src/pdf.http.ts
import { BrowserHTTPRoute, Logger } from '@browserless.io/browserless';
import MyConfig from './config';

// Export the BodySchema for documentation site to parse, plus
// browserless creates runtime validation with this as well!
export interface BodySchema {
  /**
   * The URL of the PDF you want to generate. Comments of this style get
   * converted into descriptions in the documentation site.
   */
  url: string;
}

export default class PDFToS3Route extends BrowserHTTPRoute {
  // Must have a unique name for things like disabling to work if desired
  name = 'PDFToS3Route';

  // Our route only accepts JSON content-types, and the rest 404
  accepts = [contentTypes.json];

  // Since we're launching a browser and saving something to S3
  // we should have this route under authentication
  auth = true;

  // This route uses Chromium to process the PDF.
  browser = ChromiumCDP;

  // Generally, we recommend limiting concurrency when using
  // browser routing
  concurrency = true;

  // This defines our content-type response when processed properly.
  // We'll return a simple "ok" response if everything goes well.
  contentTypes = [contentTypes.text];

  // This description gets generated into the built-in documentation site.
  description = `Produces a PDF from a supplied "url" parameter and loads it to the configured S3 Bucket`;

  // We only accept POST'd payloads, else we 404
  method = Methods.post;

  // This route exists on the '/pdf-to-s3' route
  // routes can have several paths, or just one.
  path = ['/pdf-to-s3'];

  // This a browser-based API so we tag it as such for documentation handling
  tags = [APITags.browserAPI];

  // Handler's are where we embed the logic that facilitates this route.
  async handler(req, res, logger, browser): Promise<void> {
    // Modules like Config are injected via this internal methods.
    // Use them to load core modules within the platform.
    const config = this.config() as MyConfig;
    const s3Bucket = config.getS3Bucket();
    const page = await browser.newPage();

    // ...Handle the rest!
  }
}
```

On shutdown (SIGTERM, SIGINT, SIGHUP, SIGUSR2, process.on('exit'), `uncaughtException`) browserless will call a `stop` method on all modules. This method is intentionally left blank for SDK extensions to implement. This allows for you to implement any teardown, cleanup, timer clearing, or event unbinding. You don't need to copy over any browserless-core specific teardown as these are handled elsewhere.

With this approach you can effectively write, extend and author your own workflows within browserless!

## Disabling Routes

You can disable access to core routes by specifying the route names you want to disable in a file named `disabled-routes.ts`. Browserless will scan all directories for a file named as such, and disable the named classes exported by this file. The alternative is to create a `browserless` property in your package.json file that contains a `disabledRoutes` string pointing to the relative path of your disabled routes file.

For example, if you want to disable all metrics, config, and session information your `src/disabled-routes.ts` file would look like this:

```ts
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default [
  BrowserlessRoutes.ConfigGetRoute,
  BrowserlessRoutes.SessionsGetGetRoute,
  BrowserlessRoutes.MetricsGetRoute,
  BrowserlessRoutes.MetricsTotalGetRoute,
];
```

And in the package.json file, it'd look like this:

```json
{
  // ... lots of package.json stuff
  "browserless": {
    "disabledRoutes": "./src/disabled-routes.ts"
  }
}
```

In order for route-disabling to work, you must have a `default` export that's an array of names. Browserless exports every route name it builds and runs internally, meaning you simply need to pass them through this `disabled-routes.ts` file after importing them.

Disabling a route will do several things:

- Return a `404` HTTP response when trying to call any of these routes.
- Remove them from the embedded documentation site that is auto-generated.
- Removes them from the OpenAPI JSON Schematic.
- Prevents their type information from being converted from TypeScript to runtime validation.
- It doesn't, however, remove them from Node's Module cache.

All of Browserless' internal routes are side-effect free, meaning their largely state-less and don't do exhibit kind of behavior aside from route handling and metrics reporting. Having them in Node's module cache is fine since they're never mounted in the router and set up as a potential route.

## Serving Static Files

Aside from the static files Browserless serves for documentation, and a few other APIs, SDK projects can also provide static files to be served. To do so, simply create a "static" directory in the root of your project with the files you wish to serve. These will then be served based upon their location in the directory and the file name. Unless that is, of course, you've disabled the static route. Don't be silly.

Care should be taken _not_ to create the same filenames that Browserless serves and uses as internal static files takes precedence over SDK files. In short, the list is:

- `assets/*`
- `devtools/*`
- `docs/*`
- `function/*`
- `favicon-32x32.png`

Anything else is fair game and will be served properly. An easy way to "scope" files into a path is to simply create a subpath, for instance:

`static/enterprise/docs`

Will be available to be served under:

`http://YOUR-HOST:YOUR-PORT/enterprise/docs`

Which prevents this route from colliding with our internal `/docs` route.

## Implementing Hooks

Browserless support writing a custom hooks module, where you can run or do custom checks during lifecycle events in Browserless. There are 4 events you can write custom functions for, which are detailed below. By default these hooks are benign and do nothing, so implementing them will alter how Browserless functions. Here's the default class written out with types:

```ts
// src/hooks.ts file
import {
  Request,
  Response,
  ChromiumCDP,
  FirefoxPlaywright,
  ChromiumPlaywright,
  WebkitPlaywright,
} from '@browserless.io/browserless';
import * as stream from 'stream';
import puppeteer from 'puppeteer-core';

export class Hooks extends EventEmitter {
  constructor() {
    super();
  }

  // Called in src/server.ts for incoming HTTP and WebSocket requests, which
  // is why certain arguments might not be present -- only the Request is
  // guaranteed to be present as it is shared in both WS and HTTP requests.
  // MUST return a true/false indicating if Browserless should continue
  // handling the request or not.
  before({
    req,
    res,
    socket,
    head,
  }: {
    req: Request;
    res?: Response;
    socket?: stream.Duplex;
    head?: Buffer;
  }): Promise<boolean> {
    return Promise.resolve(true);
  }

  // Called in src/limiter.ts and provides details regarding the result of the
  // session and a "start" time (Date.now()) of when the session started to run.
  // No return value or type required.
  after(args: {
    status: 'successful' | 'error' | 'timedout';
    start: number;
    req: Request;
  }): Promise<void> {
    return Promise.resolve(undefined);
  }

  // Called in src/browsers/index.ts
  // Called for every new CDP or Puppeteer-like "Page" creation in a browser.
  // Can be used to inject behaviors or add events to a page's lifecycle.
  // "meta" property is a parsed URL of the original incoming request.
  // No return value or type required.
  page(args: { meta: URL; page: puppeteer.Page }): Promise<void> {
    return Promise.resolve(undefined);
  }

  // Called in src/browsers/index.ts
  // Called for every new Browser creation in browserless, regardless of type.
  // Can be used to inject behaviors or add events to a browser's lifecycle.
  // "meta" property is a parsed URL of the original incoming request.
  // No return value or type required.
  browser(args: {
    browser:
      | ChromiumCDP
      | FirefoxPlaywright
      | ChromiumPlaywright
      | WebkitPlaywright;
    meta: URL;
  }): Promise<unknown> {
    return Promise.resolve(undefined);
  }
}
```

Of these hooks only `before` needs to return a true/false condition on whether or not to allow the request to proceed. If `false` Browserless does NOT write a response and simply closes the connection. Your `before` function should take care of any writing, closing, or streaming responses back before returning a `boolean`.

Otherwise all other hooks are there for injecting side-effect like behaviors and don't necessarily need to return any kind of value. If a certain value is returned, Browserless simply ignores it.

## Running in Development

After the project has been set up, you can use npm commands to build and run your code. The most important of these is the `npm run dev` command, which will do the following:

- Compile your TypeScript files into a NodeJS compatible `build` directory.
- Load your authored routes and generate runtime validations for them.
- Generate an OpenAPI JSON manifest for the documentation site.
- Finally, it will start the service, binding to port `3000` and `localhost`.

This process may take up to a few seconds depending on the number of routes you've created. Browserless prioritizes, in order: deterministic behavior, completion and then speed.

Once these are done you'll notice some friendly logs in your terminal, as well as a link to the documentation site that comes for free with your route definitions!

## Building for Production

While the end-goal is a docker image being built, you can simply do a complete build for CI or other purposes by simply running:

```sh
$ npm run build
```

Similar to development builds, this will compile all assets, generate OpenAPI JSON, and build out the runtime validation files, but _won't start the http server_.

If you wish to simply run the server without having to rebuild assets, then read more below.

## Running without Building

If you wish to simply run the project without building, then simply run:

```sh
$ npm start
```

This will skip all the building phases required to normally start the server. Useful if you're simply restarting due to an error or want to just re-use the last made build.

## Docker

Browserless comes with a CLI utility to help with building your docker image. It takes care of things like platforms, correctly setting up the production bundle, logging, and more. To get started with the docker build simply run:

```sh
$ npm run docker
```

Without any argument switches (those fun `--some-argument` bits), Browserless will prompt for input in a interactive way. To see a list of all options to input at once, run:

```sh
$ npm run docker help
```

This will print out all the available options so you can run a build in a continuous integration environment.

Based upon answers to either these switches or prompts, this utility will pull a respective GitHub container from the Browserless organization, insert your code, then build and execute it.

## Licensing

SPDX-License-Identifier: SSPL-1.0 OR Browserless Commercial License.

If you want to use Browserless to build commercial sites, applications, or in a continuous-integration system that's closed-source then you'll need to purchase a commercial license. This allows you to keep your software proprietary whilst still using Browserless. [You can purchase a commercial license here](https://www.browserless.io/contact). A commercial license grants you:

- Priority support on issues and features.
- On-premise running as well as running on public cloud providers for commercial/CI purposes for proprietary systems.
- Ability to modify the source (forking) for your own purposes.
- This SDK and accompanying software it produces.

Not only does it grant you a license to run such a critical piece of infrastructure, but you are also supporting further innovation in this space and our ability to contribute to it.

If you are creating an open source application under a license compatible with the Server Side License 1.0, you may use Browserless under those terms.
