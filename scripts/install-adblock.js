#!/usr/bin/env node
/* global fetch, console, process */
'use strict';

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { extractZip } from './extract-zip-native.js';

const releaseUrl =
  'https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest';

async function download(url, api = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    let bytes;
    let oversized = false;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        // Credentials are only sent to the fixed API endpoint, never an asset.
        headers: api
          ? {
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              ...(process.env.GITHUB_TOKEN
                ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
                : {}),
            }
          : undefined,
        redirect: api ? 'error' : 'follow',
      });
      if (response.ok) {
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) {
            oversized = true;
            break;
          }
          chunks.push(chunk);
        }
        if (!oversized) bytes = Buffer.concat(chunks);
      } else await response.body?.cancel();
    } catch {
      if (oversized) throw new Error('uBlock download exceeds 20 MiB');
      if (attempt === 2)
        throw Object.assign(
          new Error(
            'uBlock download: network or timeout failure after 3 attempts',
          ),
          { transient: true },
        );
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (oversized) throw new Error('uBlock download exceeds 20 MiB');
    if (!response.ok) {
      // Never log response bodies, credentials, or signed redirect URLs.
      const numericHeader = (name) => {
        const value = response.headers.get(name);
        return value && /^\d{1,12}$/.test(value) ? value : 'unknown';
      };
      const detail = `HTTP ${response.status}; retry-after=${numericHeader('retry-after')}; remaining=${numericHeader('x-ratelimit-remaining')}; reset=${numericHeader('x-ratelimit-reset')}`;
      // Rate limits and explicit Retry-After require an operator/later build,
      // not a tight retry loop. Only transient 5xx responses get short retries.
      if (
        response.status < 500 ||
        response.headers.has('retry-after') ||
        attempt === 2
      ) {
        throw Object.assign(new Error(`uBlock download: ${detail}`), {
          transient:
            response.status === 403 ||
            response.status === 429 ||
            response.status >= 500,
        });
      }
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    return bytes;
  }
}

function chromiumAsset(release) {
  const version = release?.tag_name;
  if (
    typeof version !== 'string' ||
    !/^\d+(?:\.\d+){2,3}$/.test(version) ||
    !Array.isArray(release.assets)
  ) {
    throw new Error(
      'Invalid release metadata: missing Chromium asset or version',
    );
  }
  const name = `uBOLite_${version}.chromium.zip`;
  const matches = release.assets.filter((asset) => asset?.name === name);
  const asset = matches[0];
  // Validate cached metadata too: it must not redirect downloads to another host.
  if (
    matches.length !== 1 ||
    asset.browser_download_url !==
      `https://github.com/uBlockOrigin/uBOL-home/releases/download/${version}/${name}` ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  ) {
    throw new Error('Invalid Chromium asset URL or SHA-256 digest');
  }
  return {
    version,
    url: asset.browser_download_url,
    sha256: asset.digest.slice(7),
  };
}

async function latestRelease(cacheFile) {
  let bytes;
  try {
    bytes = await download(releaseUrl, true);
  } catch (error) {
    if (!error.transient || !existsSync(cacheFile)) throw error;
    console.warn(`${error.message}; using cached release metadata`);
    bytes = await readFile(cacheFile);
  }
  let release;
  try {
    release = JSON.parse(bytes.toString());
  } catch {
    throw new Error('Invalid release JSON');
  }
  return { release, asset: chromiumAsset(release) };
}

(async () => {
  const extensionsDir = join(process.cwd(), 'extensions');
  const target = join(extensionsDir, 'ublocklite');
  // Preserve the offline rebuild fast path. FORCE_ADBLOCK refreshes from latest.
  if (
    existsSync(join(target, 'manifest.json')) &&
    process.env.FORCE_ADBLOCK !== 'true'
  )
    return;

  await mkdir(extensionsDir, { recursive: true });
  const staging = await mkdtemp(join(extensionsDir, '.ublock-'));
  const backup = join(staging, 'previous');
  const cacheDir = join(process.cwd(), 'scripts', '.adblock-cache');
  const cacheFile = join(cacheDir, 'release.json');
  let movedPrevious = false;
  try {
    const zip = join(staging, 'ublock.zip');
    const extracted = join(staging, 'extension');
    const { release, asset } = await latestRelease(cacheFile);
    const bytes = await download(asset.url);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('uBlock download: SHA-256 mismatch; refusing to extract');
    }
    await writeFile(zip, bytes);
    await extractZip(zip, extracted);
    const manifest = JSON.parse(
      await readFile(join(extracted, 'manifest.json'), 'utf8'),
    );
    if (manifest.version !== asset.version || manifest.manifest_version !== 3) {
      throw new Error('Unexpected uBlock Chromium manifest');
    }
    // Keep the last installation until download, verification and extraction
    // succeed. Same-filesystem renames avoid exposing a partially copied tree.
    if (existsSync(target)) {
      await rename(target, backup);
      movedPrevious = true;
    }
    try {
      await rename(extracted, target);
    } catch (error) {
      if (movedPrevious) {
        await rename(backup, target);
        movedPrevious = false;
      }
      throw error;
    }
    movedPrevious = false;
    // Cache only a release whose archive and manifest were validated. Fresh
    // metadata always wins; there is no bundled version fallback or pin.
    await mkdir(cacheDir, { recursive: true });
    const cacheStaging = join(staging, 'release.json');
    await writeFile(cacheStaging, JSON.stringify(release));
    await rename(cacheStaging, cacheFile);
  } finally {
    // If rollback failed, retain the backup for recovery instead of deleting it.
    if (!movedPrevious) await rm(staging, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(
    `Failed to install the uBlock Origin Lite extension: ${err.message}`,
  );
  process.exitCode = 1;
});
