import {
  Config,
  Logger,
  exists,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import path from 'path';

// Bundled @rrweb/record script - no require.resolve() needed
import { RRWEB_RECORD_SCRIPT, RRWEB_CONSOLE_PLUGIN_SCRIPT } from './generated/rrweb-script.js';

export interface ReplayEvent {
  data: unknown;
  timestamp: number;
  type: number;
}

export interface RecordingMetadata {
  browserType: string;
  duration: number;
  endedAt: number;
  eventCount: number;
  id: string;
  routePath: string;
  startedAt: number;
  trackingId?: string;
  userAgent?: string;
}

export interface Recording {
  events: ReplayEvent[];
  metadata: RecordingMetadata;
}

export interface SessionRecordingState {
  events: ReplayEvent[];
  isRecording: boolean;
  sessionId: string;
  startedAt: number;
  trackingId?: string;
  /** Functions to call for final event collection before stopping */
  finalCollectors: Array<() => Promise<void>>;
  /** Cleanup functions to call after recording stops (e.g., disconnect puppeteer) */
  cleanupFns: Array<() => Promise<void>>;
}

/**
 * Get the full recording script (rrweb + init) for injection via evaluateOnNewDocument.
 * Uses pre-bundled script from build time - no runtime file reading.
 */
export function getRecordingScript(sessionId: string): string {
  return `${RRWEB_RECORD_SCRIPT}
${RRWEB_CONSOLE_PLUGIN_SCRIPT}
(function() {
  if (window.__browserlessRecording) return;
  window.__browserlessRecording = { events: [], sessionId: '${sessionId}' };
  var recordFn = window.rrweb?.record;
  if (typeof recordFn !== 'function') {
    console.warn('[browserless] rrweb.record not found');
    return;
  }
  // Initialize console plugin
  var consolePlugin = window.rrwebConsolePlugin?.getRecordConsolePlugin?.({
    level: ['error', 'warn', 'info', 'log', 'debug'],
    lengthThreshold: 500
  });
  window.__browserlessStopRecording = recordFn({
    emit: function(event) { window.__browserlessRecording.events.push(event); },
    sampling: { mousemove: true, mouseInteraction: true, scroll: 150, media: 800, input: 'last', canvas: 2 },
    recordCanvas: true,
    collectFonts: true,
    recordCrossOriginIframes: true,
    inlineImages: true,
    dataURLOptions: { type: 'image/webp', quality: 0.6, maxBase64ImageLength: 2097152 },
    plugins: consolePlugin ? [consolePlugin] : []
  });
  console.log('[browserless] rrweb recording started with console plugin, sessionId:', '${sessionId}');
})();`;
}

/**
 * Get a simpler init script for injecting into already-loaded pages.
 * The rrweb library should already be loaded via evaluateOnNewDocument.
 */
export function getRecordingInitScript(sessionId: string): string {
  return `${RRWEB_RECORD_SCRIPT}
${RRWEB_CONSOLE_PLUGIN_SCRIPT}
(function() {
  if (window.__browserlessRecording) return 'already_recording';
  window.__browserlessRecording = { events: [], sessionId: '${sessionId}' };
  var recordFn = window.rrweb?.record;
  if (typeof recordFn !== 'function') return 'no_rrweb';
  // Initialize console plugin
  var consolePlugin = window.rrwebConsolePlugin?.getRecordConsolePlugin?.({
    level: ['error', 'warn', 'info', 'log', 'debug'],
    lengthThreshold: 500
  });
  window.__browserlessStopRecording = recordFn({
    emit: function(event) { window.__browserlessRecording.events.push(event); },
    sampling: { mousemove: true, mouseInteraction: true, scroll: 150, media: 800, input: 'last', canvas: 2 },
    recordCanvas: true,
    collectFonts: true,
    recordCrossOriginIframes: true,
    inlineImages: true,
    dataURLOptions: { type: 'image/webp', quality: 0.6, maxBase64ImageLength: 2097152 },
    plugins: consolePlugin ? [consolePlugin] : []
  });
  return 'started';
})();`;
}

export class SessionReplay extends EventEmitter {
  protected recordings: Map<string, SessionRecordingState> = new Map();
  protected log = new Logger('session-replay');
  protected recordingsDir: string;
  protected enabled: boolean;
  protected maxRecordingSize: number;

  constructor(protected config: Config) {
    super();
    this.enabled = process.env.ENABLE_REPLAY !== 'false';
    this.recordingsDir = process.env.REPLAY_DIR || '/tmp/browserless-recordings';
    this.maxRecordingSize = +(process.env.REPLAY_MAX_SIZE || '52428800');
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getRecordingsDir(): string {
    return this.recordingsDir;
  }

  public async initialize(): Promise<void> {
    if (!this.enabled) {
      this.log.info('Session replay is disabled');
      return;
    }

    // Verify bundled script is available (build-time bundled, no runtime loading)
    if (!RRWEB_RECORD_SCRIPT) {
      this.log.error('rrweb script not bundled - run npm run bundle:rrweb');
      this.enabled = false;
      return;
    }

    if (!(await exists(this.recordingsDir))) {
      await mkdir(this.recordingsDir, { recursive: true });
      this.log.info(`Created recordings directory: ${this.recordingsDir}`);
    }

    this.log.info(`Session replay enabled (bundled rrweb), storing in: ${this.recordingsDir}`);
  }

  public startRecording(sessionId: string, trackingId?: string): void {
    if (!this.enabled || this.recordings.has(sessionId)) return;

    this.recordings.set(sessionId, {
      cleanupFns: [],
      events: [],
      finalCollectors: [],
      isRecording: true,
      sessionId,
      startedAt: Date.now(),
      trackingId,
    });
    this.log.debug(`Started recording for session ${sessionId}`);
  }

  public addEvent(sessionId: string, event: ReplayEvent): void {
    const state = this.recordings.get(sessionId);
    if (!state?.isRecording) return;

    const currentSize = JSON.stringify(state.events).length;
    if (currentSize > this.maxRecordingSize) {
      this.log.warn(`Recording ${sessionId} exceeded max size, stopping`);
      this.stopRecording(sessionId);
      return;
    }

    state.events.push(event);
  }

  public addEvents(sessionId: string, events: ReplayEvent[]): void {
    for (const event of events) {
      this.addEvent(sessionId, event);
    }
  }

  /**
   * Register a function to be called for final event collection before stopping.
   * This ensures we don't lose events between the last poll and session close.
   */
  public registerFinalCollector(sessionId: string, collector: () => Promise<void>): void {
    const state = this.recordings.get(sessionId);
    if (state) {
      state.finalCollectors.push(collector);
    }
  }

  /**
   * Register a cleanup function to be called after recording stops.
   * Use this for resources that need cleanup (e.g., disconnect puppeteer connections).
   */
  public registerCleanupFn(sessionId: string, cleanupFn: () => Promise<void>): void {
    const state = this.recordings.get(sessionId);
    if (state) {
      state.cleanupFns.push(cleanupFn);
    }
  }

  public async stopRecording(
    sessionId: string,
    metadata?: Partial<RecordingMetadata>
  ): Promise<string | null> {
    const state = this.recordings.get(sessionId);
    if (!state) return null;

    // Run all final collectors to gather any pending events before saving
    // This prevents losing events between the last poll and session close
    for (const collector of state.finalCollectors) {
      try {
        await collector();
      } catch (e) {
        this.log.warn(`Final collector failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    state.isRecording = false;
    const endedAt = Date.now();

    const recording: Recording = {
      events: state.events,
      metadata: {
        browserType: metadata?.browserType || 'unknown',
        duration: endedAt - state.startedAt,
        endedAt,
        eventCount: state.events.length,
        id: sessionId,
        routePath: metadata?.routePath || 'unknown',
        startedAt: state.startedAt,
        trackingId: state.trackingId,
        userAgent: metadata?.userAgent,
      },
    };

    const filepath = path.join(this.recordingsDir, `${sessionId}.json`);

    try {
      await writeFile(filepath, JSON.stringify(recording), 'utf-8');
      this.log.info(`Saved recording ${sessionId} with ${state.events.length} events`);
    } catch (err) {
      this.log.error(`Failed to save recording ${sessionId}: ${err}`);
    }

    this.recordings.delete(sessionId);

    // Run cleanup functions after saving (e.g., disconnect puppeteer)
    for (const cleanupFn of state.cleanupFns) {
      try {
        await cleanupFn();
      } catch (e) {
        this.log.warn(`Cleanup function failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return filepath;
  }

  public isRecording(sessionId: string): boolean {
    return this.recordings.get(sessionId)?.isRecording || false;
  }

  public getRecordingState(sessionId: string): SessionRecordingState | undefined {
    return this.recordings.get(sessionId);
  }

  public async listRecordings(): Promise<RecordingMetadata[]> {
    if (!(await exists(this.recordingsDir))) return [];

    const files = await readdir(this.recordingsDir);
    const recordings: RecordingMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(path.join(this.recordingsDir, file), 'utf-8');
        recordings.push(JSON.parse(content).metadata);
      } catch {
        // Skip invalid files
      }
    }

    return recordings.sort((a, b) => b.startedAt - a.startedAt);
  }

  public async getRecording(id: string): Promise<Recording | null> {
    const filepath = path.join(this.recordingsDir, `${id}.json`);
    if (!(await exists(filepath))) return null;

    try {
      return JSON.parse(await readFile(filepath, 'utf-8'));
    } catch {
      return null;
    }
  }

  public async deleteRecording(id: string): Promise<boolean> {
    const filepath = path.join(this.recordingsDir, `${id}.json`);
    if (!(await exists(filepath))) return false;

    try {
      await rm(filepath);
      this.log.info(`Deleted recording ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  public async shutdown(): Promise<void> {
    this.log.info('Shutting down session replay...');
    for (const [sessionId] of this.recordings) {
      await this.stopRecording(sessionId);
    }
    await this.stop();
  }

  public stop() {}
}
