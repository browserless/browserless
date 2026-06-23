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
      'Endpoints for capturing full-page or element screenshots and generating PDF documents from web pages. Use the root `/screenshot` and `/pdf` routes for quick captures, or browser-specific variants for fine-grained control.',
    'x-displayName': 'Screenshots & PDFs',
  },
  {
    name: 'Scraping & Content',
    description:
      'Endpoints for loading pages and extracting HTML, text, and structured data. Use `/chromium/content` for raw HTML and `/chromium/scrape` for selector-based extraction.',
    'x-displayName': 'Scraping & Content',
  },
  {
    name: 'Functions & Downloads',
    description:
      'Endpoints for running custom JavaScript functions in a browser context and downloading the resulting files. Useful for generating exports, running headless scripts, and retrieving binary assets.',
    'x-displayName': 'Functions & Downloads',
  },
  {
    name: 'Sessions & Connections',
    description:
      'Endpoints for creating, managing, and reconnecting to browser sessions. Includes the JSON/CDP discovery endpoints and BQL session management.',
    'x-displayName': 'Sessions & Connections',
  },
  {
    name: 'Crawling',
    description:
      'Endpoints for launching, monitoring, and managing multi-page crawl jobs. Submit a crawl, poll for status, or cancel an in-progress crawl.',
    'x-displayName': 'Crawling',
  },
  {
    name: 'Unblock & Stealth',
    description:
      'Endpoints for bypassing bot detection and anti-scraping measures. Use `/unblock` for aggressive anti-bot challenges and the BQL stealth variants for fingerprint-randomized automation.',
    'x-displayName': 'Unblock & Stealth',
  },
  {
    name: 'Browser Management',
    description:
      'Endpoints for inspecting active sessions, terminating browsers, and retrieving server metadata. Use `/active` to list running sessions and `/kill` to terminate them.',
    'x-displayName': 'Browser Management',
  },
  {
    name: 'Profiles',
    description:
      'Endpoints for creating, updating, and managing persistent browser profiles that preserve cookies, localStorage, and IndexedDB state across sessions.',
    'x-displayName': 'Profiles',
  },
  {
    name: 'Proxy',
    description:
      'Endpoints for discovering available proxy locations and configuring residential or datacenter proxying.\n\n> The Residential proxy is only available for Enterprise and Cloud plans.\n\nAdd these parameters to your library or API calls:\n\n- `?proxy=residential` — Use the residential proxy (6 units/MB).\n- `?proxy=datacenter` — Use the datacenter proxy pool (2 units/MB). Cheaper but more easily detected.\n- `?proxyCountry=us` — Two-digit ISO country code.\n- `?proxySticky=true` — Keep the same IP for the entire session. Recommended for most cases.\n- `?proxyPreset=px_gov01` — Website-specific proxy configuration.',
    'x-displayName': 'Proxy',
  },
  {
    name: 'Integrations',
    description:
      'Endpoints for connecting external services to Browserless. Currently supports 1Password integration for secure credential injection into browser sessions.',
    'x-displayName': 'Integrations',
  },
  {
    name: 'Legacy (chrome prefix)',
    description:
      'Deprecated `/chrome/*` endpoints that mirror the newer `/chromium/*` equivalents. These remain documented for backward compatibility but new integrations should use the `/chromium/*` routes instead.',
    'x-displayName': 'Legacy (chrome prefix)',
    'x-traitTag': true,
  },
  {
    name: 'WebSocket APIs',
    description:
      'WebSocket and CDP connection endpoints for Puppeteer, Playwright, and raw DevTools Protocol clients. Connect via `wss://` to launch or attach to browser instances.',
    'x-displayName': 'WebSocket APIs',
  },
  {
    name: 'CDP Extensions',
    description:
      'Browserless-specific Chrome DevTools Protocol extensions invoked via `cdp.send()`. These commands enhance open-source libraries with features like live URLs, captcha solving, session reconnect, and page identification.',
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
];

const openAPIDescription = [
  'The Browserless API provides REST, WebSocket, and [CDP extension](https://docs.browserless.io/open-api#tag/CDP-Extensions) endpoints for headless browser automation at scale.',
  'It accepts JSON request bodies, returns JSON or binary responses, and uses standard HTTP status codes.',
  '',
  '## Just getting started?',
  '',
  'Check out the [Quick Start guide](https://docs.browserless.io/baas/start) to launch your first session, or explore the [BrowserQL IDE](https://docs.browserless.io/browserql/overview) for a GraphQL-based automation workflow.',
  '',
  '## Base URL',
  '',
  'All API requests are made to your deployment\'s base URL. For Browserless Cloud:',
  '',
  '```plaintext',
  'https://production-sfo.browserless.io',
  '```',
  '',
  '## Authentication',
  '',
  'Authenticate every request by including your API token as a query parameter:',
  '',
  '```plaintext',
  'https://production-sfo.browserless.io/chromium/content?token=YOUR_API_TOKEN',
  '```',
  '',
  'Tokens are managed from the [Account dashboard](https://www.browserless.io/account). See [connection details](https://docs.browserless.io/baas/connection) for full authentication options.',
  '',
  '## Changelog',
  '',
  'For release notes and version history, see the [Enterprise Changelog](https://docs.browserless.io/enterprise/changelog).',
  '',
  '# Software Keys',
  '',
  'The Enterprise image supports time-limited software keys that allow usage for a specific period without requiring any external connections or callbacks.',
  'These keys are cryptographically secure and cannot be reverse engineered. When a key expires, the container will exit with a semantic error code.',
  '',
  '## Using a Software Key',
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
