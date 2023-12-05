#!/usr/bin/env node
/* global console */
'use strict';

import TJS from 'typescript-json-schema';
import fs from 'fs/promises';
import path from 'path';

(async () => {
  const { getRouteFiles, tsExtension } = await import('../build/utils.js');

  const schemas = ['BodySchema', 'QuerySchema', 'ResponseSchema'];
  const settings = {
    ignoreErrors: true,
    noExtraProps: true,
    required: true,
  };

  const { compilerOptions } = JSON.parse(
    await fs.readFile('tsconfig.json', 'utf-8'),
  );

  const { Config } = await import('../build/config.js');
  const [httpRoutes, wsRoutes] = await getRouteFiles(new Config());
  await Promise.all(
    [...httpRoutes, ...wsRoutes]
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
})();
