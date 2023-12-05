#!/usr/bin/env node
/* global process */
'use strict';

import fs from 'fs/promises';
import { marked } from 'marked';
import path from 'path';

const cwd = process.cwd();
const swaggerJSONPath = path.join(cwd, 'static', 'docs', 'swagger.json');
const packageJSONPath = path.join(cwd, 'package.json');

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

(async () => {
  const [{ getRouteFiles }, { Config }, { errorCodes }, packageJSON] =
    await Promise.all([
      import('../build/utils.js'),
      import('../build/config.js'),
      import('../build/http.js'),
      fs.readFile(packageJSONPath),
    ]);

  const isWin = process.platform === 'win32';
  const readme = (await fs.readFile('README.md')).toString();
  const changelog = marked.parse(
    (await fs.readFile('CHANGELOG.md')).toString(),
  );
  const [httpRoutes, wsRoutes] = await getRouteFiles(new Config());
  const swaggerJSON = {
    customSiteTitle: 'Browserless Documentation',
    definitions: {},
    info: {
      description: readme + changelog,
      title: 'Browserless',
      version: JSON.parse(packageJSON.toString()).version,
      'x-logo': {
        altText: 'browserless logo',
        url: './docs/browserless-logo.png',
      },
    },
    openapi: '3.0.0',
    paths: {},
    servers: [],
    // Inject routes here...
  };

  const routeMetaData = await Promise.all(
    [...httpRoutes, ...wsRoutes]
      .filter((r) => r.endsWith('.js'))
      .sort()
      .map(async (routeModule) => {
        const routeImport = `${isWin ? 'file:///' : ''}${routeModule}`;
        const { default: route } = await import(routeImport);
        if (!route) {
          throw new Error(`Invalid route file to import docs ${routeModule}`);
        }
        const body = routeModule.replace('.js', '.body.json');
        const query = routeModule.replace('.js', '.query.json');
        const response = routeModule.replace('.js', '.response.json');
        const isWebSocket = routeModule.includes('/ws/');

        const {
          tags,
          description,
          auth,
          path,
          method,
          accepts,
          contentTypes,
          title,
        } = route;

        return {
          accepts,
          auth,
          body: isWebSocket ? null : JSON.parse(await readFileOrNull(body)),
          contentTypes,
          description,
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

  const paths = routeMetaData.reduce((accum, r) => {
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

  fs.writeFile(swaggerJSONPath, JSON.stringify(swaggerJSON, null, '  '));
})();
