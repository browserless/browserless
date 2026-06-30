/* global fetch, console, process */
import { Readable } from 'stream';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

import { deleteAsync } from 'del';
import gunzip from 'gunzip-maybe';
import { cp } from 'fs/promises';
import tar from 'tar-fs';

const registryURL = 'https://registry.npmjs.org/@browserless.io/debugger/';
const tmp = join(os.tmpdir(), 'browserless-debugger');
const untarDir = join(tmp, 'package', 'static');
const debuggerDir = join(process.cwd(), 'static', 'debugger');

const lastFromArr = (arr) => arr[arr.length - 1];
const dlAndExtract = (url) =>
  fetch(url).then(
    (response) =>
      new Promise((resolve, reject) => {
        // @ts-ignore
        Readable.fromWeb(response.body)
          .pipe(gunzip())
          .pipe(tar.extract(tmp))
          .on('error', reject)
          .on('finish', resolve);
      }),
  );

const getLatestVersion = async () => {
  const response = await fetch(registryURL);
  const json = await response.json();
  const latest = lastFromArr(Object.keys(json.versions));
  return json.versions[latest];
};

(async () => {
  if (existsSync(debuggerDir)) {
    await deleteAsync(debuggerDir);
  }

  const dist = await getLatestVersion()
    .then((version) => version.dist.tarball)
    .catch((error) => {
      console.error(`Couldn't fetch latest debugger version: ${error.message}`);
      process.exit(1);
    });

  await dlAndExtract(dist).catch((error) => {
    console.error(`Couldn't download debugger: ${error.message}`);
    process.exit(1);
  });

  await cp(untarDir, debuggerDir, { recursive: true });
  await deleteAsync(tmp, { force: true });
})().catch((error) => {
  console.error(`An error occurred: ${error.message}`);
  process.exit(1);
});
