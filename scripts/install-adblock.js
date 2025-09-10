#!/usr/bin/env node
/* global fetch, console, process */
'use strict';

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import path, { join } from 'path';
import { Readable } from 'stream';
import { deleteAsync } from 'del';
import os from 'os';
import unzip from 'extract-zip';
import fsExtra from 'fs-extra';

(async () => {
  const tmpDir = path.join(os.tmpdir(), '_ublite' + Date.now());

  // Create temporary directory if it doesn't exist
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  const zipFile = join(tmpDir, 'ublock.zip');
  const extensionsDir = join(process.cwd(), 'extensions');
  const uBlockLiteDir = join(extensionsDir, 'ublocklite');

  const downloadUrlToDirectory = (url, filePath) =>
    fetch(url).then(
      (response) =>
        new Promise((resolve, reject) => {
          // @ts-ignore
          Readable.fromWeb(response.body)
            .pipe(createWriteStream(filePath))
            .on('error', reject)
            .on('finish', resolve);
        }),
    );
  
  if (existsSync(uBlockLiteDir)) {
    await deleteAsync(uBlockLiteDir);
  }

  const data = await fetch(
    'https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest'
  );
  const json = await data.json();

  await downloadUrlToDirectory(json.assets[0].browser_download_url, zipFile);
  await unzip(zipFile, { dir: tmpDir });
  await fsExtra.move(tmpDir, uBlockLiteDir, { overwrite: true });
  await deleteAsync(zipFile, { force: true }).catch((err) => {
    console.warn('Could not delete temporary download file: ' + err.message);
  });

  console.log('✅ uBlock Lite installed successfully!');
})();
