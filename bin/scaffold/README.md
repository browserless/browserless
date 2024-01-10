# browserless.io SDK Project

Welcome to your browserless.io SDK project! This readme will help you get started and running as quickly as possible. Below is a handy Table of Contents in order to find what you're looking for fastest.

Please note that, as of right now, breaking changes aren't yet reflected in our semantic versioning. You can think of this SDK as still in beta for the time being, and we'll carefully document any major or breaking changes in future releases of Browserless.

## Table of Contents
- [Quick Start](#quick-start)
- [About](#about)
- [Routing](#routing)
- [Utilities](#utilities)
- [Extending Modules]()
- [Building]()
- [Docker]()
- [Licensing]()

## Quick Start

To start a new project, simply run this command in a folder of your choosing and follow the prompts:

```sh
npx @browserless.io/browserless create
```

browserless will install a scaffolded project, install dependencies, and establish a simple "hello-world" REST API route. For more information see below!

## About

The Browserless.io SDK and accompanying CLI were written with the hope that *you* can add and enhance functionality into browserless for your needs.
When creating a new project, the scaffold will ask a series of questions and generate the project for you. Below is a list of files it creates and what they're used for:

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

## Routing

Routing is, simply, a plain-old JavaScript object with certain expected properties. Many of the features of Browserless are exposed as options on routes so you can define many types of functionality with just a route definition.

Browserless has 4 different types of routes:

- HTTP Routes that don't need a browser to run.
- HTTP Routes that do need a browser to run.
- WebSocket routes that don't a browser.
- WebSockets that need a browser.

We use this same semantic in our own codebase, so feel free to see how those work in our open-source projects. All routes are TypeScript and all our modules are documented, so you should be able to effectively write routes and modules with your code editor and not necessarily need these examples open. Below are a few examples:

### Basic HTTP Route
```ts
import {
  APITags,
  HTTPRoute,
  Methods,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';

// Response schemas must be typed "ResponseSchema" and are documented for you and
// shown in the built-in documentation site.
export type ResponseSchema = string;

// Must be the default export
export default {
  // Detail any content-types that this route should except. "contentTypes.any" here means any content-type.
  // If the content-type does not match then a 404 will be sent back
  accepts: [contentTypes.any],

  // A boolean to indicate if authorization (token auth) is required to access this route. Can also be a function
  // that returns a boolean with the request object being the only argument.
  auth: true,

  // If this route requires a browser. `null` indicates no browser needed.
  browser: null,

  // Does this route need to be limited by the global concurrency limit? Set to "true" if so
  concurrency: false,

  // The returned content-type of this route. Shown in the documentation site.
  contentTypes: [contentTypes.text],

  // A description for this route and what it does. Gets displayed inside the documentation site.
  description: `Returns a simple "Hello World!" response.`,

  // Handler is a function, getting the request and response objects, and is where you'll write the
  // core logic behind this route. Use utilities like writeResponse or writeJSONResponse to help
  // return the appropriate response.
  handler: async (_req, res): Promise<void> => {
    const response: ResponseSchema = 'Hello World!';
    return writeResponse(res, 200, ResponseSchema, contentTypes.text);
  },

  // Define what method that this route will listen for. Other methods will 404.
  method: Methods.get,

  // The path that this route will listen on requests for.
  path: '/hello',

  // A list of arbitrary tags to group similar APIs with in the documentation site.
  tags: [APITags.management],
} as HTTPRoute
```

### Chromium WebSocket Route
```ts
import {
  APITags,
  BrowserWebsocketRoute,
  CDPChromium,
  CDPLaunchOptions,
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

export default {
  // This route requires a valid authorization token.
  auth: true,

  // This route uses the CDPChromium class (Chromium)
  browser: CDPChromium,

  // This route is limited by the global concurrency limiter
  concurrency: true,

  // Short description of the route and what it does shown on the documentation site
  description: `Launch and connect to Chromium with a library like puppeteer or others that work over chrome-devtools-protocol.`,

  // Routes with a browser type get a browser argument of the Browser instance, otherwise
  // request, socket, and head are the other 3 arguments. Here we pass them through
  // and proxy the request into Chrome to handle.
  handler: async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    chrome: CDPChromium,
  ): Promise<void> => chrome.proxyWebSocket(req, socket, head),

  // This route is available on the '/' route
  path: WebsocketRoutes['/'],

  // This is a browser-based WebSocket route so we tag it as such
  tags: [APITags.browserWS],
} as BrowserWebsocketRoute;
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

The easiest module to extend is the Configuration module, as it's usage is pretty simple and straightforward. Here, we're going to add another property that we'll use later in a route.

```ts
// Config must be  and the default export
import { Config } from '@browserless.io/browserless';

export default class MyConfig extends Config {
  public getS3Bucket = (): string => {
    // Load from environment variables or default to some other named bucket.
    return process.env.S3_BUCKET ?? 'my-fun-s3-bucket';
  };
};
```

Then, later, in your route you can define some functionality to load this configuration. Let's make a PDF route that generates a PDF from a URL and then saves the result to this S3 bucket.

```ts
import MyConfig from './config';

// Export the BodySchema for documentation site to parse, plus
// browserless creates runtime validation with this body
export interface BodySchema {
  /**
   * The URL of the PDF you want to generate. Comments of this style get
   * converted into descriptions in the documentation site.
   */
  url: string;
}

const pdfRoute: BrowserHTTPRoute = {
  // Route accepts only JSON types
  accepts: [contentTypes.json],

  // Route requires authorization
  auth: true,

  // This route uses the Chromium to process.
  browser: CDPChromium,
  concurrency: true,
  contentTypes: [contentTypes.pdf],
  description: `Produces a PDF from a supplied "url" parameter and loads it to the configured S3 Bucket`,

  handler: async (
    req: Request,
    res: ServerResponse,
    browser: BrowserInstance,
  ): Promise<void> => {
    // getConfig() is injected at start-up and available inside of handlers.
    const { getConfig: getConfig } = route;
    const config = getConfig() as MyConfig;
    const s3Bucket = config.getS3Bucket();

  },

  method: Methods.post,
  path: HTTPRoutes.pdf,
  tags: [APITags.browserAPI],
};

// Don't forget to default export it!
export default pdfRoute;
```
