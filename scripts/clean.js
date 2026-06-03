#!/usr/bin/env node
'use strict';
import { deleteAsync } from 'del';

(async () => {
  // Note: the cached static/devtools snapshot is intentionally preserved here.
  // install-devtools.js downloads it once and reuses it, which keeps rebuilds
  // fast (use FORCE_DEVTOOLS=true to force a fresh download). We do still sweep
  // the transient download artifacts (the zip and the extraction temp dir) so a
  // previously-interrupted install can't leave them orphaned.
  await deleteAsync([
    'build',
    'static/function/*js*',
    'static/devtools.zip',
    'static/devtools-temp',
    'static/debugger*',
  ]);
})();
