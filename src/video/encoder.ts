import { spawn } from 'child_process';
import { readdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';

import {
  Logger,
  exists,
} from '@browserless.io/browserless';

import type { IRecordingStore } from '../interfaces/recording-store.interface.js';

export interface EncodingProgress {
  framesProcessed: number;
  totalFrames: number;
  fps: number;
  status: 'pending' | 'encoding' | 'completed' | 'failed';
}

/**
 * Background ffmpeg encoding queue.
 *
 * After a screencast capture finishes, frames are saved as PNGs on disk.
 * This encoder converts them to HLS segments + playlist for web playback.
 *
 * Design:
 * - Sequential queue (one encode at a time) to avoid CPU spikes with 20 concurrent sessions
 * - Non-blocking: stopCapture() queues encoding and returns immediately
 * - HLS output enables watching video ~2s after encoding starts
 * - In-memory progress tracking with real-time fps/frame count from ffmpeg stderr
 * - Updates SQLite encodingStatus: pending → encoding → completed | failed
 * - HLS segments + playlist are the final output (no MP4 remux)
 * - Orphaned frames from container restarts cleaned on startup
 */
export class VideoEncoder {
  private static readonly SEGMENT_DURATION = 10;
  private log = new Logger('video-encoder');
  private queue: Array<{ sessionId: string; recordingsDir: string; totalFrames: number }> = [];
  private processing = false;
  private progress = new Map<string, EncodingProgress>();

  constructor(private store: IRecordingStore | null) {}

  /**
   * Update the store reference (set after SessionReplay initializes).
   */
  setStore(store: IRecordingStore): void {
    this.store = store;
  }

  /**
   * Get real-time encoding progress for a session.
   */
  getProgress(sessionId: string): EncodingProgress | null {
    return this.progress.get(sessionId) ?? null;
  }

  /**
   * Queue a session for encoding.
   * Returns immediately — encoding happens in the background.
   */
  queueEncode(sessionId: string, recordingsDir: string, totalFrames: number = 0): void {
    // Prevent duplicate queue entries (two viewers racing)
    if (this.queue.some(j => j.sessionId === sessionId)) {
      this.log.debug(`Session ${sessionId} already queued, skipping`);
      return;
    }

    this.log.info(`Queuing video encode for session ${sessionId}`);

    if (this.store) {
      this.store.updateEncodingStatus(sessionId, 'pending');
    }

    this.progress.set(sessionId, {
      framesProcessed: 0,
      totalFrames,
      fps: 0,
      status: 'pending',
    });

    this.queue.push({ sessionId, recordingsDir, totalFrames });
    this.processQueue();
  }

  /**
   * Process the encoding queue sequentially.
   * Only one encode runs at a time to prevent CPU spikes.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        await this.encode(job.sessionId, job.recordingsDir, job.totalFrames);
      } catch (e) {
        this.log.error(`Encoding failed for ${job.sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this.processing = false;
  }

  /**
   * Encode PNG frames to HLS segments + playlist.
   *
   * 1. Read frame filenames (sorted by timestamp)
   * 2. Generate concat file with variable durations
   * 3. Run ffmpeg → HLS segments + playlist
   * 4. Update SQLite status with playlist path
   * 5. Clean up frames directory + concat file
   */
  private async encode(sessionId: string, recordingsDir: string, totalFrames: number): Promise<void> {
    const sessionDir = path.join(recordingsDir, sessionId);
    const framesDir = path.join(sessionDir, 'frames');
    const concatPath = path.join(sessionDir, 'frames.txt');
    const playlistPath = path.join(sessionDir, 'playlist.m3u8');

    if (!(await exists(framesDir))) {
      this.log.warn(`No frames directory for ${sessionId}, skipping`);
      if (this.store) {
        this.store.updateEncodingStatus(sessionId, 'failed');
      }
      this.updateProgress(sessionId, { status: 'failed' });
      return;
    }

    // Update status to encoding
    if (this.store) {
      this.store.updateEncodingStatus(sessionId, 'encoding');
    }
    this.updateProgress(sessionId, { status: 'encoding' });

    try {
      // Read and sort frame files by timestamp
      const files = (await readdir(framesDir))
        .filter(f => f.endsWith('.png'))
        .sort();

      if (files.length === 0) {
        this.log.warn(`No frames found for ${sessionId}`);
        if (this.store) {
          this.store.updateEncodingStatus(sessionId, 'failed');
        }
        this.updateProgress(sessionId, { status: 'failed' });
        return;
      }

      // Update totalFrames from actual file count if not provided
      if (totalFrames === 0) {
        totalFrames = files.length;
        this.updateProgress(sessionId, { totalFrames: files.length });
      }

      // Generate concat file with variable frame durations
      const concatLines: string[] = [];
      let totalDuration = 0;
      for (let i = 0; i < files.length; i++) {
        const currentTs = parseInt(files[i].replace('.png', ''), 10);
        let duration: number;

        if (i < files.length - 1) {
          const nextTs = parseInt(files[i + 1].replace('.png', ''), 10);
          duration = (nextTs - currentTs) / 1000; // ms to seconds
          // Clamp duration to reasonable range
          if (duration <= 0) duration = 0.033; // ~30fps minimum
          if (duration > 10) duration = 10; // 10s max gap
        } else {
          // Last frame: hold for 1 second
          duration = 1.0;
        }

        totalDuration += duration;
        concatLines.push(`file 'frames/${files[i]}'`);
        concatLines.push(`duration ${duration.toFixed(3)}`);
      }

      // ffmpeg concat demuxer requires repeating last file
      concatLines.push(`file 'frames/${files[files.length - 1]}'`);

      await writeFile(concatPath, concatLines.join('\n'), 'utf-8');

      // Pre-generate complete VOD playlist before encoding starts.
      // Player can load this immediately and see the full duration.
      // Segment durations are estimates; ffmpeg's exact playlist replaces this after encoding.
      const segDur = VideoEncoder.SEGMENT_DURATION;
      const segmentCount = Math.ceil(totalDuration / segDur);
      const playlistLines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        `#EXT-X-TARGETDURATION:${segDur + 1}`,
        '#EXT-X-PLAYLIST-TYPE:VOD',
      ];
      for (let i = 0; i < segmentCount; i++) {
        const isLast = i === segmentCount - 1;
        const segLength = isLast
          ? totalDuration - (i * segDur)
          : segDur;
        playlistLines.push(`#EXTINF:${segLength.toFixed(6)},`);
        playlistLines.push(`seg${String(i).padStart(3, '0')}.ts`);
      }
      playlistLines.push('#EXT-X-ENDLIST');
      playlistLines.push('');

      await writeFile(playlistPath, playlistLines.join('\n'), 'utf-8');

      // Encode to MPEG-TS HLS segments (ffmpeg writes to temp playlist, not our pre-generated one)
      const ffmpegPlaylistPath = path.join(sessionDir, '_encoding.m3u8');
      await this.runFfmpegHls(concatPath, sessionDir, ffmpegPlaylistPath, sessionId);

      // Replace our estimated playlist with ffmpeg's (has exact segment durations)
      if (await exists(ffmpegPlaylistPath)) {
        await rename(ffmpegPlaylistPath, playlistPath);
      }

      // Update status to completed with playlist path
      if (this.store) {
        this.store.updateEncodingStatus(sessionId, 'completed', playlistPath);
      }
      this.updateProgress(sessionId, { status: 'completed', framesProcessed: totalFrames });

      // Clean up frames directory and concat file (keep HLS segments + playlist)
      try {
        await rm(framesDir, { recursive: true });
        this.log.debug(`Cleaned up frames for ${sessionId}`);
      } catch {
        // Non-fatal
      }
      try {
        await rm(concatPath);
      } catch {
        // Non-fatal
      }
      try {
        await rm(path.join(sessionDir, '_encoding.m3u8'));
      } catch {
        // Non-fatal (already renamed or doesn't exist)
      }

      this.log.info(`Video encoded: ${sessionId} (${files.length} frames)`);

      // Schedule progress cleanup after 30s (gives status endpoint time to read final state)
      setTimeout(() => {
        this.progress.delete(sessionId);
      }, 30_000);
    } catch (e) {
      this.log.error(`Encoding failed for ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      if (this.store) {
        this.store.updateEncodingStatus(sessionId, 'failed');
      }
      this.updateProgress(sessionId, { status: 'failed' });
      // Keep frames on failure for debugging
    }
  }

  /**
   * Run ffmpeg to encode frames into HLS segments.
   * Parses stderr for real-time progress (frame count, fps).
   */
  private runFfmpegHls(concatPath: string, sessionDir: string, playlistPath: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const segDur = VideoEncoder.SEGMENT_DURATION;
      const segmentPattern = path.join(sessionDir, 'seg%03d.ts');

      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-force_key_frames', `expr:gte(t,n_forced*${segDur})`,
        '-f', 'hls',
        '-hls_time', String(segDur),
        '-hls_list_size', '0',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', segmentPattern,
        '-y',
        playlistPath,
      ];

      const proc = spawn('ffmpeg', args, {
        cwd: sessionDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderrTail = '';
      proc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderrTail = (stderrTail + chunk).slice(-2000);
        this.parseProgress(chunk, sessionId);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg HLS exited with code ${code}: ${stderrTail.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`ffmpeg HLS spawn failed: ${err.message}`));
      });

      // Kill ffmpeg if it takes too long (5 minutes per video)
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`ffmpeg HLS timed out for ${sessionId}`));
      }, 5 * 60 * 1000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Parse ffmpeg stderr output for progress updates.
   * ffmpeg outputs lines like: frame=  280 fps=45.2 ...
   * Lines are separated by \r (carriage return) for in-place updates.
   */
  private parseProgress(chunk: string, sessionId: string): void {
    const lines = chunk.split(/[\r\n]+/);
    for (const line of lines) {
      const frameMatch = line.match(/frame=\s*(\d+)/);
      const fpsMatch = line.match(/fps=\s*([\d.]+)/);

      if (frameMatch) {
        const framesProcessed = parseInt(frameMatch[1], 10);
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0;
        this.updateProgress(sessionId, { framesProcessed, fps });
      }
    }
  }

  /**
   * Update in-memory progress for a session.
   */
  private updateProgress(sessionId: string, update: Partial<EncodingProgress>): void {
    const current = this.progress.get(sessionId);
    if (current) {
      Object.assign(current, update);
    }
  }

  /**
   * Clean up orphaned frame directories on startup.
   * These occur when the container restarts during encoding.
   */
  async cleanupOrphans(recordingsDir: string): Promise<void> {
    try {
      if (!(await exists(recordingsDir))) return;

      const entries = await readdir(recordingsDir, { withFileTypes: true });
      let cleaned = 0;

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'frames') {
          const framesDir = path.join(recordingsDir, entry.name, 'frames');
          if (await exists(framesDir)) {
            this.log.info(`Cleaning up orphaned frames: ${entry.name}`);
            await rm(path.join(recordingsDir, entry.name), { recursive: true });
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        this.log.info(`Cleaned up ${cleaned} orphaned frame directories`);
      }
    } catch (e) {
      this.log.warn(`Orphan cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Get the number of pending/encoding jobs.
   */
  get pendingCount(): number {
    return this.queue.length + (this.processing ? 1 : 0);
  }
}
