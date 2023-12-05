#!/usr/bin/env node
/* global console, fetch */
'use strict';

import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

(async () => {
  const { buildDir } = await import('../build/utils.js');
  const dataDir = path.join(buildDir, 'data');
  const selectorsURL =
    'https://raw.githubusercontent.com/wanhose/cookie-dialog-monster/main/data/elements.txt';
  const classesURL =
    'https://raw.githubusercontent.com/wanhose/cookie-dialog-monster/main/data/classes.txt';

  const get = async (url, type) => {
    try {
      const res = await fetch(url);
      const json = (await res.text()).split('\n');
      const filename = path.join(dataDir, `${type}.json`);
      await fs.writeFile(filename, JSON.stringify(json));
    } catch (e) {
      console.error(e);
    }
  };

  if (!existsSync(dataDir)) {
    await fs.mkdir(dataDir);
  }

  await Promise.all([
    get(selectorsURL, 'selectors'),
    get(classesURL, 'classes'),
  ]);
})();
