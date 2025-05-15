#!/usr/bin/env node
/* global process */
'use strict';

import { join, parse } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { marked } from 'marked';

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
  const readme = (await fs.readFile('README.md').catch(() => '')).toString();
  const changelog = marked.parse(
    (await fs.readFile('CHANGELOG.md').catch(() => '')).toString(),
  );

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
    // Inject routes here...
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
        const paths = (Array.isArray(route.path) ? route.path : [route.path])
          .sort((a, b) => b.length - a.length)
          .map((p) => p.replace(/\?\(\/\)/g, ''));
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
        console.log(alternativePaths.length, routeDocs);
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
        const { properties, type, anyOf } = r.body;
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
          swaggerRoute.requestBody.content['application/json'] = {
            schema: {
              properties,
              type: 'object',
            },
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
  swaggerJSON.info.description = readme + `\n# Changelog\n` + changelog;
  await fs.writeFile(swaggerJSONPath, JSON.stringify(swaggerJSON, null, '  '));
};

export default buildOpenAPI;

if (moduleMain) {
  buildOpenAPI();
}
