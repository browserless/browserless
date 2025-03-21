#!/usr/bin/env node
/* global fetch, console, process */
'use strict';

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import path, { join } from 'path';
import { Readable } from 'stream';
import { deleteAsync } from 'del';
import { moveFile } from 'move-file';
import os from 'os';
import unzip from 'extract-zip';

(async () => {
  const tmpDir = path.join(os.tmpdir(), '_ublite' + Date.now());
  
  // Create temporary directory if it doesn't exist
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  
  const zipFile = tmpDir + '/ublock.zip';
  const tmpUblockLitePath = path.join(tmpDir);
  const extensionsDir = join(process.cwd(), 'extensions');
  const uBlockLiteDir = join(extensionsDir, 'ublocklite');

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

  if (existsSync(uBlockLiteDir)) {
    await deleteAsync(uBlockLiteDir);
  }
  const data = await fetch(
    'https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest',
  );
  const json = await data.json();

  await downloadUrlToDirectory(json.assets[0].browser_download_url, zipFile);
  await unzip(zipFile, { dir: tmpDir });
  await moveFile(join(tmpUblockLitePath), join(extensionsDir, 'ublocklite'));
  await deleteAsync(zipFile, { force: true }).catch((err) => {
    console.warn('Could not delete temporary download file: ' + err.message);
  });
})();
