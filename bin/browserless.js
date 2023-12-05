#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';
import debug from 'debug';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const log = debug('browserless:sdk:log');

const allowedCMDs = ['build', 'dev'];
const cmd = process.argv[2];
const cwd = process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const externalRoutesDir = path.join(rootDir, 'src', 'routes', 'external');
const externalHTTPDir = path.join(externalRoutesDir, 'http');
const externalWSDir = path.join(externalRoutesDir, 'ws');

const exists = async (path) => {
  return !!(await fs.stat(path).catch(() => false));
};

if (!allowedCMDs.includes(cmd)) {
  throw new Error(
    `Unknown command of "${cmd}". Is your @browserless.io/browserless package up to date?`,
  );
}

const setupDirs = async () => {
  for (const dir of [externalRoutesDir, externalHTTPDir, externalWSDir]) {
    if (!(await exists(dir))) {
      console.log(`Creating route directory: ${dir}`);
      await fs.mkdir(dir);
    }
  }
};

const dev = async () => {
  await setupDirs();
  const packageJSONPath = path.join(cwd, 'package.json');
  const packageJSON = await fs.readFile(packageJSONPath);
  const pJSON = JSON.parse(packageJSON.toString());
  const bless = pJSON['browserless.io'];

  if (!bless) {
    log(
      `No browserless.io metadata found in package.json, did you forget to add a "browserless.io" key in your package.json?`,
    );
    process.exit(1);
  }
  log(`Starting project "${pJSON.name}"@${pJSON.version}`);

  if (bless.httpRoutes?.length) {
    log(`Found HTTP routes: ${bless?.httpRoutes.join(',')}`);
  }

  if (bless.webSocketRoutes?.length) {
    log(`Found WS routes: ${bless?.webSocketRoutes.join(',')}`);
  }

  // Copy routes over and other files
  await Promise.all(
    bless?.httpRoutes.map(async (route) => {
      const parsed = path.parse(route);
      const fullPath = path.join(cwd, route);

      await fs
        .symlink(fullPath, path.join(externalHTTPDir, parsed.base))
        .catch((e) => {
          if (!e.message.toLowerCase().includes('exists')) {
            throw e;
          }
        });
    }),
  );

  spawn('npm', ['run', 'dev'], { cwd: rootDir, stdio: 'inherit' });
};

switch (cmd) {
  case 'dev':
    dev();
    break;
}
