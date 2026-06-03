#!/usr/bin/env node
'use strict';
import { deleteAsync } from 'del';

(async () => {
  // Note: static/devtools is intentionally not removed here. It's a pinned
  // snapshot that install-devtools.js downloads once and reuses, which keeps
  // rebuilds fast. Use FORCE_DEVTOOLS=true to force a fresh download.
  await deleteAsync([
    'build',
    'static/function/*js*',
    'static/debugger*',
  ]);
})();
