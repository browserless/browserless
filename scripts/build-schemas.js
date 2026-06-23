#!/usr/bin/env node
/* global console, process */
'use strict';

import fs from 'fs/promises';
import path from 'path';

import TJS from 'typescript-json-schema';
import ts from 'typescript';

const moduleMain = path.normalize(import.meta.url).endsWith(process.argv[1]);

/**
 * typescript-json-schema's `uniqueNames` mode appends a `.<8-hex>` hash to every
 * definition name so that identically-named types from different files can coexist
 * in a single program. We rely on that to disambiguate the per-route schema we want,
 * but the emitted files must use the canonical (unsuffixed) names. This strips the
 * hash from `definitions` keys and `$ref` targets so output is identical to building
 * one program per route.
 *
 * @param {*} value A parsed JSON schema (or fragment thereof)
 * @returns {*} The same shape with hash suffixes removed
 */
const HASH_SUFFIX = /\.[0-9a-f]{8}$/;
const stripHashSuffixes = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripHashSuffixes);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === '$ref' && typeof val === 'string') {
        out[key] = val.replace(HASH_SUFFIX, '');
      } else if (key === 'definitions' && val && typeof val === 'object') {
        out[key] = Object.fromEntries(
          Object.entries(val).map(([defName, defVal]) => [
            defName.replace(HASH_SUFFIX, ''),
            stripHashSuffixes(defVal),
          ]),
        );
      } else {
        out[key] = stripHashSuffixes(val);
      }
    }
    return out;
  }
  return value;
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
  const routesToParse = (
    moduleMain
      ? [...httpRoutes, ...wsRoutes]
      : [...externalHTTPRoutes, ...externalWebSocketRoutes]
  ).filter((r) => r.endsWith(tsExtension));

  if (routesToParse.length === 0) {
    return;
  }

  // Build a SINGLE TypeScript program for every route up front. Previously a
  // fresh program was created per route, which re-parsed the entire standard
  // lib and the large transitive `.d.ts` graph (puppeteer-core, playwright,
  // @types/node) once per file — the dominant cost of this script. One shared
  // program does that work a single time.
  //
  // Schema generation must be deterministic and independent of the consumer's
  // runtime module settings. Under moduleResolution "nodenext"/"node16", types
  // pulled from dual CJS/ESM packages (e.g. puppeteer-core) serialize as
  // absolute-path `import("...",{with:{"resolution-mode":"import"}}).Type`
  // $ref names that the ajv-backed validator cannot resolve at request time.
  // Forcing the canonical es2022/bundler resolution yields stable, named $refs
  // for every consumer regardless of how their own tsconfig is configured.
  const program = TJS.getProgramFromFiles(
    routesToParse,
    { ...compilerOptions, module: 'es2022', moduleResolution: 'bundler' },
    './',
  );

  // `uniqueNames` lets identically-named interfaces (e.g. every route's
  // `BodySchema`) coexist in one program by suffixing each definition with a
  // hash. We use it only to address the specific symbol a given route exports;
  // the suffixes are stripped from the emitted files (see stripHashSuffixes).
  const generator = TJS.buildGenerator(program, {
    ...settings,
    uniqueNames: true,
  });

  if (generator === null) {
    throw new Error('Unable to build the JSON schema generator');
  }

  const checker = program.getTypeChecker();

  // Map every interface/type symbol to its unique (hash-suffixed) name so we
  // can resolve a route's exported schema — including re-exports from shared
  // implementations — back to the exact definition to generate.
  const symbolToUniqueName = new Map();
  for (const ref of generator.getSymbols()) {
    symbolToUniqueName.set(ref.symbol, ref.name);
  }

  return Promise.all(
    routesToParse.map((route) => {
      const moduleSymbol = checker.getSymbolAtLocation(
        program.getSourceFile(route),
      );
      const moduleExports = moduleSymbol
        ? checker.getExportsOfModule(moduleSymbol)
        : [];

      return Promise.all(
        schemas.map(async (schemaName) => {
          // Resolve the exported name to its underlying declaration symbol,
          // following re-export aliases (`export { BodySchema } from '...'`).
          // This covers interfaces, type aliases (`export type ResponseSchema
          // = string`), and re-exports uniformly.
          let symbol = moduleExports.find((e) => e.name === schemaName);
          while (symbol && symbol.flags & ts.SymbolFlags.Alias) {
            symbol = checker.getAliasedSymbol(symbol);
          }
          const uniqueName = symbol && symbolToUniqueName.get(symbol);
          if (!uniqueName) {
            return;
          }

          const routePath = path.parse(route);
          const routeName = routePath.name.slice(0, -2); // drop the ending .d
          const schemaSuffix = schemaName
            .replace('Schema', '')
            .toLocaleLowerCase();
          routePath.base = `${routeName}.${schemaSuffix}.json`;
          const jsonPath = path.format(routePath);

          try {
            const schema = stripHashSuffixes(
              generator.getSchemaForSymbol(uniqueName),
            );
            // Await the write inside the try so a failed write is caught here
            // and logged, rather than rejecting the parent Promise.all and
            // aborting the whole build.
            await fs.writeFile(jsonPath, JSON.stringify(schema, null, '  '));
            return jsonPath;
          } catch (e) {
            console.error(
              `Error generating schema: (${routeName}) (${jsonPath}): ${e}`,
            );
            return null;
          }
        }),
      );
    }),
  );
};

export default buildSchemas;

if (moduleMain) {
  buildSchemas();
}
