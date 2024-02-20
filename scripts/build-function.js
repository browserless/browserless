#!/usr/bin/env node
'use strict';

import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

build({
  bundle: true,
  entryPoints: ['src/shared/utils/function/client.ts'],
  outfile: 'static/function/client.js',
  plugins: [
    polyfillNode({
      globals: {
        process: false,
      },
    }),
  ],
});
