#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

const allowedCmds = ['build', 'dev'];
const cmd = process.argv[2];
const cwd = process.cwd();


if (!allowedCmds.includes(cmd)) {
  throw new Error(`Unknown command of "${cmd}". Is your @browserless.io/browserless package up to date?`);
}

const dev = async () => {
  const packageJSONPath = path.join(cwd, 'package.json');
  const packageJSON = await fs.readFile(packageJSONPath);
  const pJSON = JSON.parse(packageJSON.toString());
  const bless = pJSON['browserless.io'];

  if (!bless) {
    console.error(chalk.red(`No browserless.io metadata found in package.json, did you forget to add a "browserless.io" key in your package.json?`));
    process.exit(1);
  }
  console.log(`Starting project "${pJSON.name}"@${pJSON.version}`);

  if (bless.httpRoutes?.length) {
    console.log(`Found HTTP routes: ${bless?.httpRoutes.join(',' )}`);
  }

  if (bless.webSocketRoutes?.length) {
    console.log(`Found WS routes: ${bless?.webSocketRoutes.join(',' )}`);
  }

  // Copy routes over and other files
  // Run Typescript Build and generate openAPI docs
  // Start the server
};

switch (cmd) {
  case 'dev':
    dev();
    break;
}
