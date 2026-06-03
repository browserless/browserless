#!/usr/bin/env node
/* global fetch, console, process */
'use strict';

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import path, { join } from 'path';
import { Readable } from 'stream';
import { deleteAsync } from 'del';
import { cp } from 'fs/promises';
import { extractZip } from './extract-zip-native.js';
import os from 'os';

(async () => {
  const extensionsDir = join(process.cwd(), 'extensions');
  const uBlockLiteDir = join(extensionsDir, 'ublocklite');

  // Skip the network round-trip when the extension is already installed.
  // Set FORCE_ADBLOCK=true to re-fetch the latest uBlock Origin Lite release.
  if (
    existsSync(join(uBlockLiteDir, 'manifest.json')) &&
    process.env.FORCE_ADBLOCK !== 'true'
  ) {
    return;
  }

  const tmpDir = path.join(os.tmpdir(), '_ublite' + Date.now());

  // Create temporary directory if it doesn't exist
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  const zipFile = tmpDir + '/ublock.zip';

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
  await extractZip(zipFile, tmpDir);

  const findExtensionDir = (dir) => {
    const items = readdirSync(dir);
    if (items.includes('manifest.json')) {
      return dir;
    }
    for (const item of items) {
      if (item === 'ublock.zip') continue;
      const itemPath = join(dir, item);
      if (existsSync(itemPath) && statSync(itemPath).isDirectory()) {
        const foundDir = findExtensionDir(itemPath);
        if (foundDir) return foundDir;
      }
    }
    return null;
  };

  const extensionSourceDir = findExtensionDir(tmpDir);
  if (!extensionSourceDir) {
    throw new Error(
      'Could not find uBlock Lite extension directory with manifest.json',
    );
  }

  await cp(extensionSourceDir, join(extensionsDir, 'ublocklite'), {
    recursive: true,
  });
  await deleteAsync(zipFile, { force: true }).catch((err) => {
    console.warn('Could not delete temporary download file: ' + err.message);
  });
})().catch((err) => {
  console.error(
    `Failed to install the uBlock Origin Lite extension: ${err.message}`,
  );
  process.exitCode = 1;
});
