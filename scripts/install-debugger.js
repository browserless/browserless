import { cp } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const from = path.join(
  __dirname,
  '..',
  'node_modules',
  'browserless-debugger',
  'static',
);
const to = path.join(__dirname, '..', 'static', 'debugger');

(async () => {
  await cp(from, to, {
    recursive: true,
  });
})();
