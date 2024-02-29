#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';
import { readFile, writeFile } from 'fs/promises';
import { Browserless } from '@browserless.io/browserless';
import buildOpenAPI from '../scripts/build-open-api.js';
import buildSchemas from '../scripts/build-schemas.js';

import { createInterface } from 'readline';
import debug from 'debug';
import { dedent } from '../build/utils.js';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

if (typeof process.env.DEBUG === 'undefined') {
  debug.enable('browserless*');
}

const log = debug('browserless.io:sdk:log');
const promptLog = debug('browserless.io:prompt');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2];
const subCMD = process.argv[3];
const allowedCMDs = [
  'build',
  'dev',
  'docker',
  'start',
  'create',
  'help',
  'clean',
];

if (!allowedCMDs.includes(cmd)) {
  throw new Error(
    `Unknown command of "${cmd}". Is your @browserless.io/browserless package up to date?`,
  );
}

const projectDir = process.cwd();
const buildDir = 'build';
const srcDir = 'src';
const compiledDir = path.join(projectDir, buildDir);

const projectPackageJSON = readFile(path.join(projectDir, 'package.json'))
  .then((r) => JSON.parse(r.toString()))
  .catch(() => null);

const browserlessPackageJSON = readFile(
  path.join(__dirname, '..', 'package.json'),
).then((r) => JSON.parse(r.toString()));

const camelCase = (str) => str.replace(/-([a-z])/g, (_, w) => w.toUpperCase());

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

const translateSrcToBuild = (directory) => {
  const srcToBuild = directory.replace(srcDir, '');
  const pathParsed = path.parse(srcToBuild);
  return path.format({ ...pathParsed, base: '', ext: '.js' });
};

const importDefault = async (files, fileName) => {
  const pJSON = await projectPackageJSON;
  // Check first if overrides are manually specified in the project's package.json
  if (pJSON && pJSON.browserless && typeof pJSON.browserless === 'object') {
    const camelCaseFileName = camelCase(fileName);
    const relativePath = pJSON.browserless[camelCaseFileName];
    if (relativePath) {
      const fullFilePath = path.join(
        compiledDir,
        translateSrcToBuild(relativePath),
      );
      log(`Importing module from package.json: "${fullFilePath}"`);
      return (await import(fullFilePath)).default;
    }
  }

  const classModuleFile = files.find((f) =>
    path.parse(f).name.endsWith(fileName),
  );

  if (!classModuleFile) {
    return;
  }

  const fullFilePath = path.join(compiledDir, classModuleFile);

  if (!classModuleFile) {
    return;
  }
  log(`Importing module from found files: "${fullFilePath}"`);
  return (await import(fullFilePath)).default;
};

const clean = async () =>
  fs.rm(path.join(compiledDir), {
    force: true,
    recursive: true,
  });

const installDependencies = async (workingDirectory) =>
  new Promise((resolve, reject) => {
    spawn('npm', ['i'], {
      cwd: workingDirectory,
      stdio: 'inherit',
    }).once('close', (code) => {
      if (code === 0) {
        log(`Successfully installed Dependencies.`);
        return resolve();
      }
      return reject(
        `Error when installing dependencies, see output for more details`,
      );
    });
  });

const buildDockerImage = async (cmd) => {
  new Promise((resolve, reject) => {
    const [docker, ...args] = cmd.split(' ');
    spawn(docker, args, {
      cwd: projectDir,
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
    spawn('npx', ['tsc', '--outDir', buildDir], {
      cwd: projectDir,
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
  const files = await fs.readdir(compiledDir, { recursive: true });
  const [httpRoutes, webSocketRoutes] = files.reduce(
    ([httpRoutes, webSocketRoutes], file) => {
      const parsed = path.parse(file);
      if (parsed.name.endsWith('http')) {
        httpRoutes.push(path.join(compiledDir, file));
      }

      if (parsed.name.endsWith('ws')) {
        webSocketRoutes.push(path.join(compiledDir, file));
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
  log(`Cleaning build directory`);
  await clean();

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
  const disabledRoutes = await importDefault(files, 'disabled-routes');
  await buildOpenAPI(httpRoutes, webSocketRoutes, disabledRoutes);

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
    disabledRoutes,
  ] = await Promise.all([
    importDefault(files, 'browser-manager'),
    importDefault(files, 'config'),
    importDefault(files, 'file-system'),
    importDefault(files, 'limiter'),
    importDefault(files, 'metrics'),
    importDefault(files, 'monitoring'),
    importDefault(files, 'router'),
    importDefault(files, 'token'),
    importDefault(files, 'webhooks'),
    importDefault(files, 'disabled-routes'),
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

  if (disabledRoutes !== undefined) {
    if (!Array.isArray(disabledRoutes)) {
      throw new Error(
        `The "disabled-routes.ts" default export should be an array of Route classes.`,
      );
    }
    browserless.disableRoutes(...disabledRoutes);
  }

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
  const finalDockerPath = path.join(compiledDir, 'Dockerfile');
  const argSwitches = getArgSwitches();

  await build();

  const dockerContents = (
    await fs.readFile(path.join(__dirname, '..', 'docker', 'sdk', 'Dockerfile'))
  ).toString();

  log(`Generating Dockerfile at "${finalDockerPath}"`);

  await fs.writeFile(compiledDir, dockerContents);

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

const create = async () => {
  const validNameRegex = /^[a-zA-Z0-9-_]+$/gi;
  const directory = (
    await prompt('What should we name this project (hyphens are ok)?')
  ).trim();
  const scaffoldLocation = path.join(__dirname, 'scaffold');

  if (!directory) {
    throw new Error(`A valid name is required.`);
  }

  const isValidDirectory = validNameRegex.test(directory);

  if (!isValidDirectory) {
    throw new Error(`Name must not include special characters.`);
  }

  const installPath = path.join(projectDir, directory);
  log(`Creating folder "${installPath}"...`);
  await fs.mkdir(installPath);

  log(`Copying Project Dependencies...`);
  const sdkFiles = await fs.readdir(scaffoldLocation, { recursive: true });
  for (const sdkFile of sdkFiles) {
    const from = path.join(scaffoldLocation, sdkFile);
    const to = path.join(installPath, sdkFile);
    if (sdkFile === 'package.json') {
      const sdkPackageJSONTemplate = (await readFile(from)).toString();
      const { version } = await browserlessPackageJSON;
      const sdkPackageJSON = sdkPackageJSONTemplate.replace(
        '${BROWSERLESS_VERSION}',
        version,
      );
      await writeFile(to, sdkPackageJSON);
    } else if ((await fs.lstat(from)).isDirectory()) {
      await fs.mkdir(to);
    } else {
      await fs.copyFile(from, to);
    }
  }

  log(`Installing npm modules...`);
  await installDependencies(installPath);

  log(
    `Done! You can now open "${installPath}" in an editor of your choice. Make sure to check out the README and update the package.json file!`,
  );
};

const help = () => {
  if (subCMD) {
    if (!allowedCMDs.includes(subCMD)) {
      throw new Error(`Unknown command of "${subCMD}" passed.`);
    }

    switch (subCMD) {
      case 'start':
        console.log(dedent`
        Usage: npx @browserless.io/browserless start

        Description: Starts the HTTP server without building source.
          Useful for restarting a prior build, testing quickly, or
          running without packaging into a docker image.
      `);
        break;

      case 'clean':
        console.log(dedent`
        Usage: npx @browserless.io/browserless clean

        Description: Cleans the TypeScript generated JavaScript found
          in the "build" directory and any other temporary assets.
      `);
        break;

      case 'dev':
        console.log(dedent`
        Usage: npx @browserless.io/browserless dev

        Description: Builds the TypeScript files, compiles runtime
          route validation, generates the OpenAPI JSON document,
          and starts the development server at localhost:3000.
      `);
        break;

      case 'build':
        console.log(dedent`
        Usage: npx @browserless.io/browserless build

        Description: Builds the TypeScript files, compiles runtime
          route validation, generates the OpenAPI JSON document,
          and exits. Useful for testing full compilation.
      `);
        break;

      case 'docker':
        console.log(dedent`
        Usage: npx @browserless.io/browserless docker

        Description: Builds a docker image from source. This command is hybrid
          in that it can be either interactive or use the switches listed below.

        Options:
          --from        The Browserless docker image to extend from (ghcr.io/browserless/multi:latest).
          --action      One of "push" or "load" to load or push to a registry.
          --tag         The full tag, including version, to name the image (IE: my-bless/chromium:latest).
          --platform    A comma-separated list of platforms to build for.
          --proceed     Proceed with building the image without prompting.
      `);
        break;

      case 'create':
        console.log(dedent`
        Usage: npx @browserless.io/browserless create

        Description: Creates a new project with interactive prompts.
      `);
        break;
    }

    return;
  }

  console.log(dedent`
    Usage: npx @browserless.io/browserless [command] [arguments]

    Options:
      clean     Removes build artifacts and other temporary directories.
      create    Creates a new scaffold project, installs dependencies, and exits.
      dev       Compiles TypeScript, generates build assets and starts the server.
      build     Compiles TypeScript, generates build assets and exits.
      docker    Generates a docker image.
      start     Starts the http server with already-built assets.
  `);
};

switch (cmd) {
  case 'clean':
    clean();
    break;

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

  case 'create':
    create();
    break;

  default:
    help();
    break;
}
