#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';
import { Browserless } from '@browserless.io/browserless';
import buildOpenAPI from '../scripts/build-open-api.js';
import buildSchemas from '../scripts/build-schemas.js';

import debug from 'debug';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const log = debug('browserless:sdk:log');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2];
const cwd = process.cwd();
const allowedCMDs = ['build', 'dev', 'docker', 'start'];
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
  log(`Importing module override "${classModuleFullFilePath}"`);
  return (await import(classModuleFullFilePath)).default;
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

const getSourceFiles = async () => {
  const files = await fs.readdir(srcDir);
  const [httpRoutes, webSocketRoutes] = files.reduce(
    ([httpRoutes, webSocketRoutes], file) => {
      const parsed = path.parse(file);
      if (parsed.name.endsWith('http')) {
        httpRoutes.push(path.join(srcDir, file));
      }

      if (parsed.name.endsWith('ws')) {
        webSocketRoutes.push(path.join(srcDir, file));
      }

      return [httpRoutes, webSocketRoutes];
    },
    [[], []],
  );

  return {
    files,
    httpRoutes,
    webSocketRoutes,
  };
};

/**
 * Build
 * Responsible for compiling TypeScript, generating routes meta-data
 * and validation. Doesn't start the HTTP server.
 */
const build = async () => {
  log(`Compiling TypeScript`);
  await buildTypeScript();

  log(`Building custom routes`);
  const { files, httpRoutes, webSocketRoutes } = await getSourceFiles();

  log(`Building route runtime schema validation`);
  await buildSchemas(
    httpRoutes.map((f) => f.replace('.js', '.d.ts')),
    webSocketRoutes.map((f) => f.replace('.js', '.d.ts')),
  );

  log(`Generating OpenAPI JSON file`);
  await buildOpenAPI(httpRoutes, webSocketRoutes);

  log(`All built assets complete`);

  return {
    files,
    httpRoutes,
    webSocketRoutes,
  };
};

const start = async (dev = false) => {
  const { httpRoutes, webSocketRoutes, files } = dev
    ? await build()
    : await getSourceFiles();

  log(`Importing all class overrides if present`);
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

  log(`Starting Browserless`);
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

  log(`Starting Browserless HTTP Service`);
  browserless.start();

  log(`Binding signal interruption handlers and uncaught errors`);
  process
    .on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    })
    .once('uncaughtException', async (err, origin) => {
      console.error('Unhandled exception at:', origin, 'error:', err);
      await browserless.stop();
      process.exit(1);
    })
    .once('SIGTERM', async () => {
      debug(`SIGTERM received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('SIGINT', async () => {
      debug(`SIGINT received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('SIGHUP', async () => {
      debug(`SIGHUP received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('SIGUSR2', async () => {
      debug(`SIGUSR2 received, saving and closing down`);
      await browserless.stop();
      process.exit(0);
    })
    .once('exit', () => {
      debug(`Process is finished, exiting`);
      process.exit(0);
    });
};

const buildDocker = async () => {
  const from = process.argv[3] ?? 'ghcr.io/browserless/multi';
  const version = process.argv[4] ?? 'latest';
  const finalDockerPath = path.join(cwd, 'build', 'Dockerfile');

  const dockerContents = (
    await fs.readFile(path.join(__dirname, '..', 'docker', 'sdk', 'Dockerfile'))
  ).toString();

  log(`Creating Dockerfile in "${finalDockerPath}"`);
  await fs.writeFile(
    path.join(cwd, 'build', 'Dockerfile'),
    dockerContents,
  );

  log(`Building docker image from repo: "${from}:${version}"`);
};

switch (cmd) {
  case 'start':
    start(false);
    break;

  case 'dev':
    start(true);
    break;

  case 'build':
    build();
    break;

  case 'docker':
    buildDocker();
    break;
}
