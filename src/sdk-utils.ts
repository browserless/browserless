import { createInterface } from 'readline';
import debug from 'debug';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { exec } from 'child_process';

export const execAsync = promisify(exec);

export const getArgSwitches = () => {
  return process.argv.reduce(
    (accum, arg, idx) => {
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
    },
    {} as { [key: string]: string | true },
  );
};

export const getSourceFiles = async (cwd: string) => {
  const buildDir = path.join(cwd, 'build');
  const files = await fs.readdir(buildDir, { recursive: true });
  const [httpRoutes, webSocketRoutes] = files.reduce(
    ([httpRoutes, webSocketRoutes], file) => {
      const isInRootDir = !file.includes(path.sep);
      const parsed = path.parse(file);

      if (isInRootDir) {
        return [httpRoutes, webSocketRoutes];
      }

      if (parsed.name.endsWith('http')) {
        httpRoutes.push(path.join(buildDir, file));
      }

      if (parsed.name.endsWith('ws')) {
        webSocketRoutes.push(path.join(buildDir, file));
      }

      return [httpRoutes, webSocketRoutes];
    },
    [[] as string[], [] as string[]],
  );

  return {
    files,
    httpRoutes,
    webSocketRoutes,
  };
};

export const camelCase = (str: string) =>
  str.replace(/-([a-z])/g, (_, w) => w.toUpperCase());

export const prompt = async (question: string) => {
  const promptLog = debug('browserless.io:prompt');
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

export const installDependencies = async (
  workingDirectory: string,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    execAsync('npm i', { cwd: workingDirectory }).then(({ stderr }) => {
      if (stderr) {
        return reject(
          `Error when installing dependencies: ${stderr}, see output for more details`,
        );
      }

      return resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    execAsync(
      'npx playwright-core install --with-deps chromium firefox webkit',
      { cwd: workingDirectory },
    ).then(({ stderr }) => {
      if (stderr) {
        return reject(
          `Error when installing dependencies: ${stderr}, see output for more details`,
        );
      }

      return resolve();
    });
  });
};

export const buildDockerImage = async (
  cmd: string,
  projectDir: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    execAsync(cmd, { cwd: projectDir }).then(({ stderr }) => {
      if (stderr) {
        return reject(
          `Error when building Docker image: ${stderr}, see output for more details`,
        );
      }

      return resolve();
    });
  });

export const buildTypeScript = async (
  buildDir: string,
  projectDir: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    execAsync(`npx tsc --outDir ${buildDir}`, { cwd: projectDir }).then(
      ({ stderr }) => {
        if (stderr) {
          return reject(
            `Error when building Docker image: ${stderr}, see output for more details`,
          );
        }

        return resolve();
      },
    );
  });
