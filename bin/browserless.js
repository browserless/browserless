#!/usr/bin/env node
/* eslint-disable no-undef */
'use strict';

const allowedCmds = ['build', 'dev', 'docker'];
const cmd = process.argv[2];
const cwd = process.cwd();

console.log(cmd, cwd);

if (!allowedCmds.includes(cmd)) {
  throw new Error(`Unknown command of "${cmd}". Is your @browserless.io/browserless package up to date?`);
}

const build = () => {
  console.log('HIT');
};

switch (cmd) {
  case 'build':
    build();
    break;
}
