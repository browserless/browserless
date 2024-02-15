import { rename, rm, unlink } from 'fs/promises';
import extract from 'extract-zip';
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
const zipStream = fs.createWriteStream(zipPath);

const cleanup = async () => {
  return await Promise.all([
    unlink(zipPath),
    rm(extractPath, { recursive: true }),
  ]);
};

(async () => {
  await rm(finalPath, { recursive: true }).catch(() => {});
  await new Promise((resolve, reject) =>
    https.get(devtoolsUrl, (response) => {
      response.pipe(zipStream).on('close', resolve).on('error', reject);
    }),
  );
  await extract(zipPath, { dir: extractPath });
  await rename(deepPath, finalPath);
})().finally(cleanup);
