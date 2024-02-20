#!/usr/bin/env node
'use strict';
import { deleteAsync } from 'del';

(async () => {
  await deleteAsync([
    'build',
    'static/function/*js*',
    'static/devtools*',
    'static/debugger*',
  ]);
})();
