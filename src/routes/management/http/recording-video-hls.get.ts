import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  NotFound,
  Request,
  SystemQueryParameters,
  contentTypes,
  exists,
  writeResponse,
} from '@browserless.io/browserless';
import { createReadStream, watch } from 'fs';
import { stat } from 'fs/promises';
import { ServerResponse } from 'http';
import path from 'path';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

/**
 * Serve HLS playlist and segment files during live encoding.
 *
 * Path: /recordings/{id}/video/hls/{filename}
 * - playlist.m3u8 → application/vnd.apple.mpegurl (no-cache, hls.js polls this)
 * - seg*.ts → video/mp2t (immutable once written, cacheable)
 */
export default class RecordingVideoHlsGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.RecordingVideoHlsGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.any];
  description = `Serve HLS playlist and segment files for a recording.`;
  method = Methods.get;
  path = HTTPManagementRoutes.recordingVideoHls;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return writeResponse(res, 503, 'Session replay is not enabled');
    }

    // Parse path: /recordings/{id}/video/hls/{filename}
    const pathParts = req.parsed.pathname.split('/');
    const hlsIndex = pathParts.indexOf('hls');
    if (hlsIndex < 0 || hlsIndex + 1 >= pathParts.length) {
      throw new NotFound('HLS filename is required');
    }

    const id = pathParts[hlsIndex - 2]; // two levels up from "hls": .../video/hls/...
    const filename = pathParts[hlsIndex + 1];

    if (!id || !filename) {
      throw new NotFound('Recording ID and filename are required');
    }

    // Validate filename (allow .m3u8, .m4s, .mp4 (init segment), and legacy .ts)
    if (!/^[\w-]+\.(m3u8|m4s|mp4|ts)$/.test(filename)) {
      throw new NotFound('Invalid HLS filename');
    }

    const recordingsDir = replay.getRecordingsDir();
    const filePath = path.join(recordingsDir, id, filename);

    // If file doesn't exist yet, check if encoding is in progress and wait for it
    if (!(await exists(filePath))) {
      const store = replay.getStore();
      let shouldWait = false;
      if (store) {
        const recording = store.findById(id);
        if (recording.ok && recording.value) {
          const status = recording.value.encodingStatus;
          shouldWait = status === 'encoding' || status === 'pending';
        }
      }

      if (shouldWait) {
        const appeared = await this.waitForFile(filePath, 30_000);
        if (!appeared) {
          throw new NotFound(`HLS file not available: ${filename}`);
        }
      } else {
        throw new NotFound(`HLS file not found: ${filename}`);
      }
    }

    const fileStat = await stat(filePath);
    const isPlaylist = filename.endsWith('.m3u8');

    const contentType = isPlaylist
      ? 'application/vnd.apple.mpegurl'
      : filename.endsWith('.m4s') || filename.endsWith('.mp4')
        ? 'video/mp4'
        : 'video/mp2t';

    // Playlist: no-cache (player should always get latest version)
    // Segments + init: immutable once written, cache for 1 hour
    const cacheControl = isPlaylist
      ? 'no-cache, no-store'
      : 'public, max-age=3600, immutable';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': fileStat.size,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
    });

    const stream = createReadStream(filePath);
    stream.pipe(res);

    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  }

  /**
   * Block until a file appears on disk (LL-HLS blocking response pattern).
   * Uses fs.watch (inotify on Linux) — zero CPU while waiting.
   * Combined with ffmpeg's temp_file flag, the file appearing via atomic
   * rename guarantees it is fully written and ready to serve.
   */
  private waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      // File may have appeared between the exists() check and setting up the watcher
      exists(filePath).then((alreadyExists) => {
        if (alreadyExists) {
          resolve(true);
          return;
        }

        const dir = path.dirname(filePath);
        const target = path.basename(filePath);
        let settled = false;

        const cleanup = () => {
          if (!settled) {
            settled = true;
            watcher.close();
            clearTimeout(timer);
          }
        };

        // inotify watches the directory for new files / renames
        const watcher = watch(dir, (_eventType, filename) => {
          if (filename === target) {
            cleanup();
            resolve(true);
          }
        });

        watcher.on('error', () => {
          cleanup();
          resolve(false);
        });

        const timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs);
      });
    });
  }
}
