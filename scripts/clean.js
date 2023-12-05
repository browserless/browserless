#!/usr/bin/env node
'use strict';
import { deleteAsync } from 'del';

(async () => {
  await deleteAsync(['build', 'static/functions/*js*']);
})();
