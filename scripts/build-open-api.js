#!/usr/bin/env node
/* global process */
'use strict';

import { join, parse } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleMain = import.meta.url.endsWith(process.argv[1]);
const swaggerJSONPath = join(__dirname, '..', 'static', 'docs', 'swagger.json');
const swaggerJSONMinimal = join(
  __dirname,
  '..',
  'static',
  'docs',
  'swagger.min.json',
);
const packageJSONPath = join(__dirname, '..', 'package.json');

const openAPITags = [
  {
    name: 'Screenshots & PDFs',
    description:
      'Capture full-page or element screenshots and generate PDFs from web pages. The root `/screenshot` and `/pdf` routes work for most cases. Use browser-specific variants like `/edge/screenshot` when you need a particular engine.',
    'x-displayName': 'Screenshots & PDFs',
  },
  {
    name: 'Scraping & Content',
    description:
      'Load pages and extract HTML, text, or structured data. `/chromium/content` returns raw HTML. `/chromium/scrape` runs `querySelectorAll` against the rendered DOM and returns matched elements. `/smart-scrape` cascades through multiple extraction strategies automatically.',
    'x-displayName': 'Scraping & Content',
  },
  {
    name: 'Functions & Downloads',
    description:
      'Run custom JavaScript in a browser context and retrieve the resulting files. Use `/function` to execute a Puppeteer or Playwright script server-side, and `/download` to capture binary assets triggered by in-page actions.',
    'x-displayName': 'Functions & Downloads',
  },
  {
    name: 'Sessions & Connections',
    description:
      'Create persistent browser sessions, reconnect to running browsers, and query CDP metadata. `/session` spins up a session that outlives a single WebSocket connection. `/reconnect/:id` reattaches to it later.',
    'x-displayName': 'Sessions & Connections',
  },
  {
    name: 'Crawling',
    description:
      'Launch, monitor, and cancel multi-page crawl jobs. `POST /crawl` starts a crawl, `GET /crawl/:id` polls for progress, and `DELETE /crawl/:id` cancels it.',
    'x-displayName': 'Crawling',
  },
  {
    name: 'Unblock & Stealth',
    description:
      'Bypass bot detection and anti-scraping measures. `/unblock` handles aggressive anti-bot challenges end-to-end. The BQL stealth variants (`/chromium/bql`, `/chrome/bql`) randomize browser fingerprints for longer-running automation.',
    'x-displayName': 'Unblock & Stealth',
  },
  {
    name: 'Browser Management',
    description:
      'Inspect running sessions, terminate browsers, and retrieve server metadata. `/active` lists current sessions, `/kill/:id` terminates one, and `/meta` returns server configuration.',
    'x-displayName': 'Browser Management',
  },
  {
    name: 'Profiles',
    description:
      'Create and manage persistent browser profiles that preserve cookies, localStorage, and IndexedDB across sessions. Capture a logged-in state once with `Browserless.saveProfile`, then rehydrate it on any future session with `?profile=<name>`.',
    'x-displayName': 'Profiles',
  },
  {
    name: 'Proxy',
    description:
      'Discover available proxy locations and configure residential or datacenter routing for your sessions.\n\n> Residential proxies are only available on Enterprise and Cloud plans.\n\nAdd these parameters to your library or API calls:\n\n- `?proxy=residential` — residential proxy (6 units/MB).\n- `?proxy=datacenter` — datacenter proxy pool (2 units/MB). Cheaper but more easily detected.\n- `?proxyCountry=us` — two-digit ISO country code.\n- `?proxySticky=true` — keep the same IP for the entire session. Recommended for most cases.\n- `?proxyPreset=px_gov01` — website-specific proxy configuration.',
    'x-displayName': 'Proxy',
  },
  {
    name: 'Integrations',
    description:
      'Connect external services to browser sessions. Currently supports 1Password for injecting stored credentials into a session without exposing secrets in your code.',
    'x-displayName': 'Integrations',
  },
  {
    name: 'Legacy (chrome prefix)',
    description:
      'Deprecated `/chrome/*` endpoints that mirror the newer `/chromium/*` equivalents. Still documented for backward compatibility, but new integrations should use `/chromium/*` routes.',
    'x-displayName': 'Legacy (chrome prefix)',
  },
  {
    name: 'WebSocket APIs',
    description:
      'Connect Puppeteer, Playwright, or raw DevTools Protocol clients over WebSocket. Launch a browser with `wss://` and get back a CDP session for full programmatic control.',
    'x-displayName': 'WebSocket APIs',
  },
  {
    name: 'CDP Extensions',
    description:
      'Browserless-specific Chrome DevTools Protocol methods you call via `cdp.send()`. These add live URLs (`Browserless.liveURL`), captcha solving (`Browserless.solveCaptcha`), session reconnect, and page identification to any Puppeteer or Playwright session.',
    'x-displayName': 'CDP Extensions',
  },
];

const openAPITagGroups = [
  {
    name: 'Core APIs',
    tags: ['Screenshots & PDFs', 'Scraping & Content', 'Functions & Downloads'],
  },
  {
    name: 'Browser Control',
    tags: ['Sessions & Connections', 'Browser Management', 'Crawling'],
  },
  {
    name: 'Anti-Bot & Stealth',
    tags: ['Unblock & Stealth', 'Proxy'],
  },
  {
    name: 'Auth & Profiles',
    tags: ['Profiles', 'Integrations'],
  },
  {
    name: 'WebSocket / CDP',
    tags: ['WebSocket APIs', 'CDP Extensions'],
  },
  {
    name: 'Legacy',
    tags: ['Legacy (chrome prefix)'],
  },
];

const openAPIDescription = [
  'This is the API reference for **Browserless Enterprise and Cloud** deployments. You\'ll find endpoints for capturing screenshots and PDFs, scraping content, running custom browser functions, solving CAPTCHAs, bypassing bot detection with stealth browsing, managing authenticated browser profiles, and orchestrating crawls.',
  '',
  'The API includes REST endpoints (JSON in, JSON or binary out), WebSocket connections for direct CDP/Playwright/Puppeteer access, and [CDP extensions](https://docs.browserless.io/open-api#tag/CDP-Extensions) that expose Browserless-specific commands like `liveURL`, `solveCaptcha`, and `saveProfile`. For the open-source container API, see the [GitHub repository](https://github.com/browserless/browserless).',
  '',
  '## Just Getting Started?',
  '',
  'Check out the [Quick Start guide](https://docs.browserless.io/baas/start) to launch your first session, or explore the [BrowserQL IDE](https://docs.browserless.io/browserql/overview) for a GraphQL-based automation workflow.',
  '',
  '## Base URL',
  '',
  'All API requests go to your deployment\'s base URL. For Browserless Cloud:',
  '',
  '```plaintext',
  'https://production-sfo.browserless.io',
  '```',
  '',
  'Self-hosted Enterprise deployments use the host and port where the container is running (default `http://localhost:3000`).',
  '',
  '## Authentication',
  '',
  'Include your API token as a query parameter on every request:',
  '',
  '```plaintext',
  'https://production-sfo.browserless.io/chromium/content?token=YOUR_API_TOKEN',
  '```',
  '',
  'Tokens are managed from the [Account dashboard](https://www.browserless.io/account). Self-hosted deployments set the token via the `TOKEN` environment variable. See [connection details](https://docs.browserless.io/baas/connection) for all authentication options.',
  '',
  '## Changelog',
  '',
  'For release notes and version history, see the [Enterprise Changelog](https://docs.browserless.io/enterprise/changelog).',
  '',
  '## Software keys',
  '',
  'Self-hosted Enterprise deployments use time-limited software keys for offline licensing. No external connections or callbacks are required. Keys are cryptographically secure and can\'t be reverse engineered. When a key expires, the container exits with a semantic error code.',
  '',
  'To use a software key, set the `KEY` environment variable when running the container:',
  '',
  '```bash',
  'docker run -e KEY=your-generated-key browserless/enterprise',
  '```',
].join('\n');

const readFileOrNull = async (path) => {
  if (!path) {
    return 'null';
  }

  try {
    const content = await fs.readFile(path);
    return content.toString();
  } catch (e) {
    return 'null';
  }
};

const sortSwaggerRequiredAlpha = (prop, otherProp) => {
  if (prop.required === otherProp.required) {
    if (prop.name < otherProp.name) {
      return -1;
    }
    if (prop.name > otherProp.name) {
      return 1;
    }
    return 0;
  }
  return Number(otherProp.required) - Number(prop.required);
};

const cleanupAbsolutePaths = (swaggerJSON) => {
  const jsonString = JSON.stringify(swaggerJSON);

  const cleanedString = jsonString.replace(
    /"\$ref":\s*"#\/definitions\/import\([^)]+\)\.([^"]+)"/g,
    '"$ref": "#/definitions/$1"',
  );

  return JSON.parse(cleanedString);
};

const buildOpenAPI = async (
  externalHTTPRoutes = [],
  externalWebSocketRoutes = [],
  disabledRoutes = [],
) => {
  const [{ getRouteFiles }, { Config }, { errorCodes }, packageJSON] =
    await Promise.all([
      import('../build/utils.js'),
      import('../build/config.js'),
      import('../build/http.js'),
      fs.readFile(packageJSONPath),
    ]);

  const isWin = process.platform === 'win32';

  const [httpRoutes, wsRoutes] = await getRouteFiles(new Config());
  const swaggerJSON = {
    customSiteTitle: 'Browserless Documentation',
    definitions: {},
    info: {
      title: 'Browserless',
      version: JSON.parse(packageJSON.toString()).version,
      'x-logo': {
        altText: 'browserless logo',
        url: './docs/browserless-logo-inline.svg',
      },
    },
    openapi: '3.0.0',
    paths: {},
    servers: [],
    tags: openAPITags,
    'x-tagGroups': openAPITagGroups,
  };

  const routeMetaData = await Promise.all(
    [
      ...httpRoutes,
      ...wsRoutes,
      ...externalHTTPRoutes,
      ...externalWebSocketRoutes,
    ]
      .filter((r) => r.endsWith('.js'))
      .map(async (routeModule) => {
        const routeImport = `${isWin ? 'file:///' : ''}${routeModule}`;
        const { default: Route } = await import(routeImport);
        if (!Route) {
          throw new Error(`Invalid route file to import docs ${routeModule}`);
        }
        const route = new Route();

        if (disabledRoutes.includes(route.name)) {
          return null;
        }

        const { name } = parse(routeModule);
        const body = routeModule.replace('.js', '.body.json');
        const query = routeModule.replace('.js', '.query.json');
        const response = routeModule.replace('.js', '.response.json');
        const isWebSocket = routeModule.includes('/ws/') || name.endsWith('ws');
        const paths = (
          Array.isArray(route.path) ? route.path : [route.path]
        ).map((p) => (p === '?(/)' ? '/' : p.replace(/\?\(\/\)/g, '')));
        const [path, ...alternativePaths] = paths;

        const {
          tags,
          description,
          auth,
          method,
          accepts,
          contentTypes,
          title,
        } = route;

        const routeDocs = [description];

        if (alternativePaths.length > 0) {
          const altPathsText = alternativePaths
            .map((p) => `\`${p}\``)
            .join(', ');

          const compatNote = `**Note:** This endpoint is also available at: ${altPathsText} for backwards compatibility.`;
          routeDocs.push(compatNote);
        }

        return {
          accepts,
          auth,
          body: isWebSocket ? null : JSON.parse(await readFileOrNull(body)),
          contentTypes,
          description: routeDocs.join('\n\n'),
          isWebSocket,
          method,
          path,
          query: JSON.parse(await readFileOrNull(query)),
          response: isWebSocket
            ? null
            : JSON.parse(await readFileOrNull(response)),
          tags,
          title,
        };
      }),
  );

  const paths = routeMetaData
    .filter((_) => !!_)
    .reduce((accum, r) => {
      const swaggerRoute = {
        definitions: {},
        description: r.description,
        parameters: [],
        requestBody: {
          content: {},
        },
        responses: {
          ...errorCodes,
        },
        summary: r.path,
        tags: r.tags,
      };

      r.method = r.isWebSocket ? 'get' : r.method;

      // Find all the swagger definitions and merge them into the
      // definitions object
      const allDefs = {
        ...(r?.body?.definitions || {}),
        ...(r?.query?.definitions || {}),
        ...(r?.response?.definitions || {}),
      };

      Object.entries(allDefs).forEach(([defName, definition]) => {
        // @ts-ignore
        swaggerJSON.definitions[defName] =
          // @ts-ignore
          swaggerJSON.definitions[defName] ?? definition;
      });

      if (r.isWebSocket) {
        swaggerRoute.responses['101'] = {
          description: 'Indicates successful WebSocket upgrade.',
        };
      }

      // Does a best-attempt at configuring multiple response types
      // Won't figure out APIs that return mixed response types like
      // JSON and binary blobs
      if (r.response) {
        if (r.contentTypes.length === 1) {
          const [type] = r.contentTypes;
          swaggerRoute.responses['200'] = {
            content: {
              [type]: {
                schema: r.response,
              },
            },
            description: r.response.description,
          };
        } else {
          const okResponses = r.contentTypes.reduce(
            (accum, c) => {
              // @ts-ignore
              accum.content[c] = {
                schema: {
                  type: 'text',
                },
              };
              return accum;
            },
            {
              content: {},
              description: r.response.description,
            },
          );
          swaggerRoute.responses['200'] = okResponses;
        }
      }

      // Does a best-attempt at configuring multiple body types and
      // ignores the "accepts" properties on routes since we can't
      // yet correlate the accepted types to the proper body
      if (r.body) {
        const { properties, type, required, anyOf } = r.body;
        if (anyOf) {
          // @ts-ignore
          anyOf.forEach((anyType) => {
            if (anyType.type === 'string') {
              const type = r.accepts.filter(
                // @ts-ignore
                (accept) => accept !== 'application/json',
              );
              swaggerRoute.requestBody.content[type] = {
                schema: {
                  type: 'string',
                },
              };
            }

            if (anyType['$ref']) {
              swaggerRoute.requestBody.content['application/json'] = {
                schema: {
                  $ref: anyType['$ref'],
                },
              };
            }
          });
        }

        // Handle JSON
        if (type === 'object') {
          const schema = {
            properties,
            type: 'object',
          };
          if (required?.length) {
            schema.required = required;
          }
          swaggerRoute.requestBody.content['application/json'] = {
            schema,
          };
        }
      }

      // Queries are easy in comparison, but still have to be iterated
      // over and made open-api-able
      if (r.query) {
        const { properties, required } = r.query;
        const props = Object.keys(properties || {});
        if (props.length) {
          swaggerRoute.parameters = props
            .map((prop) => ({
              in: 'query',
              name: prop,
              required: required?.includes(prop),
              schema: properties[prop],
            }))
            .sort(sortSwaggerRequiredAlpha);
        }
      }

      // @ts-ignore
      accum[r.path] = accum[r.path] || {};
      // @ts-ignore
      accum[r.path][r.method] = swaggerRoute;

      return accum;
    }, {});
  swaggerJSON.paths = paths;
  await fs.writeFile(
    swaggerJSONMinimal,
    JSON.stringify(swaggerJSON, null, '  '),
  );
  swaggerJSON.info.description = openAPIDescription;

  const cleanedSwaggerJSON = cleanupAbsolutePaths(swaggerJSON);

  await fs.writeFile(
    swaggerJSONPath,
    JSON.stringify(cleanedSwaggerJSON, null, '  '),
  );
};

export default buildOpenAPI;

if (moduleMain) {
  buildOpenAPI();
}
