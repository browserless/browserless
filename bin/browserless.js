#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';
import { Browserless } from '@browserless.io/browserless';
import buildOpenAPI from '../scripts/build-open-api.js';
import buildSchemas from '../scripts/build-schemas.js';

import { createInterface } from 'readline';
import debug from 'debug';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const log = debug('browserless:sdk:log');
const promptLog = debug('browserless:prompt');

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

const prompt = async (question) => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    promptLog(question);
    rl.question('  > ', (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
};

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

const buildDockerImage = async (cmd) => {
  new Promise((resolve, reject) => {
    const [docker, ...args] = cmd.split(' ');
    spawn(docker, args, {
      cwd,
      stdio: 'inherit',
    }).once('close', (code) => {
      if (code === 0) {
        log(`Successfully built the docker image.`);
        return resolve();
      }
      return reject(
        `Error when building Docker image, see output for more details`,
      );
    });
  });
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

const getArgSwitches = () => {
  return process.argv.reduce((accum, arg, idx) => {
    if (!arg.startsWith('--')) {
      return accum;
    }

    if (arg.includes('=')) {
      const [parameter, value] = arg.split('=');
      accum[parameter.replace(/-/gi, '')] = value || true;
      return accum;
    }

    const nextSwitchOrParameter = process.argv[idx + 1];
    const param = arg.replace(/-/gi, '');

    if (
      typeof nextSwitchOrParameter === 'undefined' ||
      nextSwitchOrParameter?.startsWith('--')
    ) {
      accum[param] = true;
      return accum;
    }

    accum[param] = nextSwitchOrParameter;

    return accum;
  }, {});
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

const isConstructor = (reference) => typeof reference === 'function';

const start = async (dev = false) => {
  const { httpRoutes, webSocketRoutes, files } = dev
    ? await build()
    : await getSourceFiles();

  log(`Importing all class overrides if present`);

  const [
    BrowserManager,
    Config,
    FileSystem,
    Limiter,
    Metrics,
    Monitoring,
    Router,
    Token,
    Webhooks,
  ] = await Promise.all([
    importClassOverride(files, 'browser-manager'),
    importClassOverride(files, 'config'),
    importClassOverride(files, 'file-system'),
    importClassOverride(files, 'limiter'),
    importClassOverride(files, 'metrics'),
    importClassOverride(files, 'monitoring'),
    importClassOverride(files, 'router'),
    importClassOverride(files, 'token'),
    importClassOverride(files, 'webhooks'),
  ]);

  log(`Starting Browserless`);

  const config = isConstructor(Config) ? new Config() : Config;
  const metrics = isConstructor(Metrics) ? new Metrics() : Metrics;
  const token = isConstructor(Token) ? new Token(config) : Token;
  const webhooks = isConstructor(Webhooks) ? new Webhooks(config) : Webhooks;
  const browserManager = isConstructor(BrowserManager)
    ? new BrowserManager(config)
    : BrowserManager;
  const monitoring = isConstructor(Monitoring)
    ? new Monitoring(config)
    : Monitoring;
  const fileSystem = isConstructor(FileSystem)
    ? new FileSystem(config)
    : FileSystem;
  const limiter = isConstructor(Limiter)
    ? new Limiter(config, metrics, monitoring, webhooks)
    : Limiter;
  const router = isConstructor(Router)
    ? new Router(config, browserManager, limiter)
    : Router;

  const browserless = new Browserless({
    browserManager,
    config,
    fileSystem,
    limiter,
    metrics,
    monitoring,
    router,
    token,
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
  const finalDockerPath = path.join(cwd, 'build', 'Dockerfile');
  const argSwitches = getArgSwitches();

  await build();

  const dockerContents = (
    await fs.readFile(path.join(__dirname, '..', 'docker', 'sdk', 'Dockerfile'))
  ).toString();

  log(`Generating Dockerfile at "${finalDockerPath}"`);

  await fs.writeFile(path.join(cwd, 'build', 'Dockerfile'), dockerContents);

  const from =
    argSwitches.from ||
    (await prompt(
      'Which docker image do you want to use (defaults to: ghcr.io/browserless/multi)?',
    )) ||
    'ghcr.io/browserless/multi';

  const action =
    argSwitches.action ||
    (await prompt(
      'Do you want to push the image or load it locally (defaults to load)?',
    )) ||
    'load';

  const tag =
    argSwitches.tag ||
    (await prompt(
      'What do you want to name the resulting image (eg, my-browserless:latest)?',
    ));

  if (!tag || !tag.includes(':')) {
    throw new Error(`A name for the image is required with a ":" and version.`);
  }

  const platformsPrompt =
    action === 'load'
      ? `Which platform do you want to build for (defaults to linux/amd64)?`
      : `Which platforms do you want to build? (defaults to "linux/amd64", must be comma-separated)?`;

  const platforms =
    argSwitches.platform || (await prompt(platformsPrompt)) || 'linux/amd64';

  if (action === 'load' && platforms.includes(',')) {
    throw new Error(
      `When "load" is specified, only one platform can be built due to limitations in buildx.`,
    );
  }

  const cmd = `docker buildx build --build-arg FROM=${from} --platform ${platforms} --${action} -f ./build/Dockerfile -t ${tag} .`;

  const proceed =
    argSwitches.proceed ||
    (await prompt(`Will execute "${cmd}" Proceed (y/n)?`)) ||
    'n';

  if (proceed || !proceed.includes('n')) {
    log(`Starting docker build`);
    await buildDockerImage(cmd);
    process.exit(0);
  }
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
