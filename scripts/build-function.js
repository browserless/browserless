#!/usr/bin/env node
/* eslint-disable no-undef */

'use strict';

import { build } from 'esbuild';
import fs from 'fs/promises';
import { join } from 'path';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

const html = (contents) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>browserless.io function runner</title>
    <script type="module">
    ${contents}
    </script>
  </head>
  <body>
  </body>
</html>
`;

const entryPoints = ['src/shared/utils/function/client.ts'];
const outfile = join(process.cwd(), 'static/function/client.js');
const htmlLocation = join(process.cwd(), 'static/function/index.html');

(async () => {
  await build({
    bundle: true,
    entryPoints,
    outfile,
    plugins: [
      polyfillNode({
        globals: {
          process: false,
        },
      }),
    ],
  });
  const contents = await fs.readFile(outfile, 'utf-8');
  const final = html(contents);

  await fs.writeFile(htmlLocation, final);
})();
