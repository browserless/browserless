import { rename, rm, unlink } from 'fs/promises';
import { extractZip } from './extract-zip-native.js';
import { fileURLToPath } from 'url';
import fs from 'fs';
import https from 'https';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// @TODO get this link dynamically
const devtoolsUrl = `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F848005%2Fdevtools-frontend.zip?alt=media`;

const staticDir = path.join(__dirname, '..', 'static');
const zipPath = path.join(staticDir, 'devtools.zip');
const extractPath = path.join(staticDir, 'devtools-temp');
const finalPath = path.join(staticDir, 'devtools');
const deepPath = path.join(
  extractPath,
  'devtools-frontend',
  'resources',
  'inspector',
);
const cleanup = async () => {
  return await Promise.all([
    unlink(zipPath).catch(() => {}),
    rm(extractPath, { recursive: true }).catch(() => {}),
  ]);
};

(async () => {
  // The devtools snapshot is pinned to a fixed URL, so once it's been
  // downloaded there's no need to re-fetch it on every build. Set
  // FORCE_DEVTOOLS=true to bypass the cache.
  if (fs.existsSync(finalPath) && process.env.FORCE_DEVTOOLS !== 'true') {
    return;
  }

  const zipStream = fs.createWriteStream(zipPath);

  await rm(finalPath, { recursive: true }).catch(() => {});
  await new Promise((resolve, reject) =>
    https.get(devtoolsUrl, (response) => {
      response.pipe(zipStream).on('close', resolve).on('error', reject);
    }),
  );
  await extractZip(zipPath, extractPath);
  await rename(deepPath, finalPath);
})()
  .catch((err) => {
    console.error(`Failed to install devtools from ${devtoolsUrl}:`, err);
    process.exitCode = 1;
  })
  // Always remove the transient zip/temp dir, on success and failure alike.
  // Each op in cleanup() swallows its own error, so this never masks the
  // failure reported above.
  .finally(cleanup);
