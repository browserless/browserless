#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';
import { Browserless } from '@browserless.io/browserless';
import buildOpenAPI from '../scripts/build-open-api.js';
import buildSchemas from '../scripts/build-schemas.js';

import debug from 'debug';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const log = debug('browserless:sdk:log');

const cmd = process.argv[2];
const cwd = process.cwd();
const allowedCMDs = ['build', 'dev'];
const srcDir = path.join(cwd, 'build');

if (!allowedCMDs.includes(cmd)) {
  throw new Error(
    `Unknown command of "${cmd}". Is your @browserless.io/browserless package up to date?`,
  );
}

const importClassOverride = async (files, className) => {
  const classModuleFile = files.find((f) =>
    path.parse(f).name.endsWith(className),
  );

  if (!classModuleFile) {
    return;
  }

  const classModuleFullFilePath = path.join(srcDir, classModuleFile);

  if (!classModuleFile) {
    return;
  }
  log(`Loading module override "${classModuleFile}"`);
  return import(classModuleFullFilePath);
};

const buildTypeScript = async () =>
  new Promise((resolve, reject) => {
    spawn('npx', ['tsc', '--outDir', 'build'], {
      cwd,
      stdio: 'inherit',
    }).once('close', (code) => {
      if (code === 0) {
        return resolve();
      }
      return reject(
        `Error in building TypeScript, see output for more details`,
      );
    });
  });

const dev = async () => {
  log(`Compiling TypeScript`);
  await buildTypeScript();

  log(`Scanning src folder for routes`);
  const files = await fs.readdir(srcDir);

  const [httpRoutes, webSocketRoutes] = files.reduce(
    ([httpRoutes, websocketRoutes], file) => {
      const parsed = path.parse(file);
      if (parsed.name.endsWith('http')) {
        httpRoutes.push(path.join(srcDir, file));
      }

      if (parsed.name.endsWith('ws')) {
        websocketRoutes.push(path.join(srcDir, file));
      }

      return [httpRoutes, websocketRoutes];
    },
    [[], []],
  );

  log(`Loading class overrides if present`);
  const [
    browserManager,
    config,
    fileSystem,
    limiter,
    metrics,
    monitoring,
    webhooks,
  ] = await Promise.all([
    importClassOverride(files, 'browser-manager'),
    importClassOverride(files, 'config'),
    importClassOverride(files, 'file-system'),
    importClassOverride(files, 'limiter'),
    importClassOverride(files, 'metrics'),
    importClassOverride(files, 'monitoring'),
    importClassOverride(files, 'webhooks'),
  ]);

  log(`Generating Runtime Schema Validation`);
  await buildSchemas(
    httpRoutes.map((f) => f.replace('.js', '.d.ts')),
    webSocketRoutes.map((f) => f.replace('.js', '.d.ts')),
  );

  log(`Generating OpenAPI JSON`);
  await buildOpenAPI(httpRoutes, webSocketRoutes);

  log(`Starting http service`);

  const browserless = new Browserless({
    browserManager,
    config,
    fileSystem,
    limiter,
    metrics,
    monitoring,
    webhooks,
  });

  httpRoutes.forEach((r) => browserless.addHTTPRoute(r));
  webSocketRoutes.forEach((r) => browserless.addWebSocketRoute(r));

  log(`Starting server`);
  browserless.start();
};

switch (cmd) {
  case 'dev':
    dev();
    break;

  case 'docker':
    console.error(`Not yet implemented...`);
    break;
}
