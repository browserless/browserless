#!/usr/bin/env node
/* global fetch, console, process */
'use strict';

import { createWriteStream, existsSync } from 'fs';
import path, { join } from 'path';
import { Readable } from 'stream';
import { deleteAsync } from 'del';
import { moveFile } from 'move-file';
import os from 'os';
import unzip from 'extract-zip';

(async () => {
  const zipFile = os.tmpdir() + '/ublock.zip';
  const tmpUblockPath = path.join(os.tmpdir(), 'uBlock0.chromium'); // uBlock0.chromium is always the prod name
  const extensionsDir = join(process.cwd(), 'extensions');
  const uBlockDir = join(extensionsDir, 'ublock');

  const downloadUrlToDirectory = (url, dir) =>
    fetch(url).then(
      (response) =>
        new Promise((resolve, reject) => {
          // @ts-ignore
          Readable.fromWeb(response.body)
            .pipe(createWriteStream(dir))
            .on('error', reject)
            .on('finish', resolve);
        }),
    );

  if (existsSync(uBlockDir)) {
    await deleteAsync(uBlockDir);
  }
  const data = await fetch(
    'https://api.github.com/repos/gorhill/uBlock/releases/latest',
  );
  const json = await data.json();

  await downloadUrlToDirectory(json.assets[0].browser_download_url, zipFile);
  await unzip(zipFile, { dir: os.tmpdir() });
  await moveFile(join(tmpUblockPath), join(extensionsDir, 'ublock'));
  await deleteAsync(zipFile, { force: true }).catch((err) => {
    console.warn('Could not delete temporary download file: ' + err.message);
  });
})();
