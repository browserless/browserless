#!/usr/bin/env node
/* global console, process */
'use strict';

import fs from 'fs/promises';
import path from 'path';

import TJS from 'typescript-json-schema';
import ts from 'typescript';

const moduleMain = path.normalize(import.meta.url).endsWith(process.argv[1]);

/**
 * Find an exported interface in a TypeScript AST
 *
 * @param {ts.Node} node The node to search for the exported interface
 * @param {string} interfaceName The name of the interface to search for
 * @returns {ts.InterfaceDeclaration | ts.Identifier | null}
 */
const findExportedInterface = (node, interfaceName) => {
  if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
    // Check if the interface is exported
    const isExported = node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (isExported) {
      return node;
    }
  }

  // Check for re-exported interfaces
  if (
    ts.isExportDeclaration(node) &&
    node.exportClause &&
    ts.isNamedExports(node.exportClause)
  ) {
    const elements = node.exportClause.elements;
    for (const element of elements) {
      if (element.name.text === interfaceName) {
        return element.name;
      }
    }
  }

  let foundNode = null;
  node.forEachChild((child) => {
    if (foundNode === null) {
      foundNode = findExportedInterface(child, interfaceName);
    }
  });

  return foundNode;
};

/**
 * Creates an standard JSON schema file for each route (see https://json-schema.org/specification)
 *
 * @param {string[]} externalHTTPRoutes Additional HTTP routes to parse
 * @param {string[]} externalWebSocketRoutes Additional WS routes to parse
 */
const buildSchemas = async (
  externalHTTPRoutes = [],
  externalWebSocketRoutes = [],
) => {
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

  // Depending on if we're parsing an external projects routes,
  // skip the prebuilt ones. This makes it much faster to build
  const routesToParse = moduleMain
    ? [...httpRoutes, ...wsRoutes]
    : [...externalHTTPRoutes, ...externalWebSocketRoutes];

  await Promise.all(
    routesToParse
      .filter((r) => r.endsWith(tsExtension))
      .map(async (route) => {
        const routeContents = (await fs.readFile(route)).toString('utf-8');
        const program = TJS.getProgramFromFiles([route], compilerOptions, './');

        // prettier-ignore
        const sourceFile = ts.createSourceFile(route, routeContents, ts.ScriptTarget.Latest, true);

        return Promise.all(
          schemas.map((schemaName) => {
            if (findExportedInterface(sourceFile, schemaName)) {
              const routePath = path.parse(route);
              const routeName = routePath.name.slice(0, -2); // drop the ending .d
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
