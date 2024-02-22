#!/usr/bin/env node
/* global console, process */
'use strict';

import { getRouteFiles, tsExtension } from '../build/utils.js';
import { Config } from '../build/config.js';
import TJS from 'typescript-json-schema';
import fs from 'fs/promises';
import path from 'path';

const moduleMain = import.meta.url.endsWith(process.argv[1]);

const buildSchemas = async (
  externalHTTPRoutes = [],
  externalWebSocketRoutes = [],
) => {
  const schemas = ['BodySchema', 'QuerySchema', 'ResponseSchema'];
  const settings = {
    ignoreErrors: true,
    noExtraProps: true,
    required: true,
  };

  const { compilerOptions } = JSON.parse(
    await fs.readFile('tsconfig.json', 'utf-8'),
  );

  const [httpRoutes, wsRoutes] = await getRouteFiles(new Config());

  // Depending on if we're parsing an external projects routes,
  // skip the prebuilt ones. This makes it much faster to build
  const routesToParse = moduleMain
    ? [...httpRoutes, ...wsRoutes]
    : [...externalHTTPRoutes, ...externalWebSocketRoutes];

  await Promise.all(
    routesToParse
      .filter((r) => r.endsWith(tsExtension))
      .map(async (route) => {
        const routeFile = (await fs.readFile(route)).toString('utf-8');
        if (!schemas.some((schemaName) => routeFile.includes(schemaName))) {
          return;
        }

        const program = TJS.getProgramFromFiles([route], compilerOptions, './');

        return Promise.all(
          schemas.map((schemaName) => {
            if (routeFile.includes(schemaName)) {
              const routePath = path.parse(route);
              const routeName = routePath.name.replace('.d', '');
              const schemaSuffix = schemaName
                .replace('Schema', '')
                .toLocaleLowerCase();
              routePath.base = `${routeName}.${schemaSuffix}.json`;
              const jsonPath = path.format(routePath);
              try {
                const schema = TJS.generateSchema(
                  program,
                  schemaName,
                  settings,
                );
                return fs.writeFile(
                  jsonPath,
                  JSON.stringify(schema, null, '  '),
                );
              } catch (e) {
                console.error(
                  `Error generating schema: (${routeName}) (${jsonPath}): ${e}`,
                );
                return null;
              }
            }
            return;
          }),
        );
      }),
  );
};

export default buildSchemas;

if (moduleMain) {
  buildSchemas();
}
