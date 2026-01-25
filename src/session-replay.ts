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
import { RecordingStore } from './recording-store.js';
import type { IRecordingStore, RecordingMetadata } from './interfaces/recording-store.interface.js';

// Re-export RecordingMetadata for backwards compatibility
export type { RecordingMetadata } from './interfaces/recording-store.interface.js';

export interface ReplayEvent {
  data: unknown;
  timestamp: number;
  type: number;
}

export interface Recording {
  events: ReplayEvent[];
  metadata: RecordingMetadata;
}

/**
 * Result of stopping a recording.
 * Returns both the filepath and metadata for CDP event injection.
 */
export interface StopRecordingResult {
  filepath: string;
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

/**
 * SessionReplay manages browser session recording and playback.
 *
 * Supports dependency injection for the recording store:
 * - If a store is provided via constructor, it's used directly
 * - If no store is provided, one is created during initialize()
 *
 * This decoupling allows for easy mocking in tests.
 */
export class SessionReplay extends EventEmitter {
  protected recordings: Map<string, SessionRecordingState> = new Map();
  protected log = new Logger('session-replay');
  protected recordingsDir: string;
  protected enabled: boolean;
  protected maxRecordingSize: number;
  protected store: IRecordingStore | null = null;
  protected ownsStore = false; // Track if we created the store (for cleanup)

  constructor(
    protected config: Config,
    injectedStore?: IRecordingStore
  ) {
    super();
    this.enabled = process.env.ENABLE_REPLAY !== 'false';
    this.recordingsDir = process.env.REPLAY_DIR || '/tmp/browserless-recordings';
    this.maxRecordingSize = +(process.env.REPLAY_MAX_SIZE || '52428800');

    // Use injected store if provided
    if (injectedStore) {
      this.store = injectedStore;
      this.ownsStore = false;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getRecordingsDir(): string {
    return this.recordingsDir;
  }

  /**
   * Get the current recording store.
   * Useful for testing or advanced use cases.
   */
  public getStore(): IRecordingStore | null {
    return this.store;
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

    // Only create store if not injected
    if (!this.store) {
      this.store = new RecordingStore(this.recordingsDir);
      this.ownsStore = true;
    }

    // Migrate any existing JSON recordings to SQLite (one-time migration)
    await this.migrateExistingRecordings();

    this.log.info(`Session replay enabled (bundled rrweb), storing in: ${this.recordingsDir}`);
  }

  /**
   * One-time migration: read existing JSON files and populate SQLite metadata.
   * Safe to run multiple times - INSERT OR REPLACE handles duplicates.
   */
  private async migrateExistingRecordings(): Promise<void> {
    if (!this.store) return;

    try {
      const files = await readdir(this.recordingsDir);
      let migrated = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(path.join(this.recordingsDir, file), 'utf-8');
          const recording = JSON.parse(content);
          if (recording.metadata) {
            const result = this.store.insert(recording.metadata);
            if (result.ok) {
              migrated++;
            }
          }
        } catch {
          // Skip invalid files
        }
      }

      if (migrated > 0) {
        this.log.info(`Migrated ${migrated} existing recordings to SQLite`);
      }
    } catch {
      // Directory might not exist or be empty
    }
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
  ): Promise<StopRecordingResult | null> {
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

    const recordingMetadata: RecordingMetadata = {
      browserType: metadata?.browserType || 'unknown',
      duration: endedAt - state.startedAt,
      endedAt,
      eventCount: state.events.length,
      id: sessionId,
      routePath: metadata?.routePath || 'unknown',
      startedAt: state.startedAt,
      trackingId: state.trackingId,
      userAgent: metadata?.userAgent,
    };

    const recording: Recording = {
      events: state.events,
      metadata: recordingMetadata,
    };

    const filepath = path.join(this.recordingsDir, `${sessionId}.json`);

    try {
      // Save full recording to JSON (events + metadata for playback)
      await writeFile(filepath, JSON.stringify(recording), 'utf-8');

      // Save metadata to SQLite for fast queries
      if (this.store) {
        const result = this.store.insert(recording.metadata);
        if (!result.ok) {
          this.log.warn(`Failed to save recording metadata to store: ${result.error.message}`);
        }
      }

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

    return { filepath, metadata: recordingMetadata };
  }

  public isRecording(sessionId: string): boolean {
    return this.recordings.get(sessionId)?.isRecording || false;
  }

  public getRecordingState(sessionId: string): SessionRecordingState | undefined {
    return this.recordings.get(sessionId);
  }

  /**
   * List all recordings metadata.
   * Uses SQLite for O(1) query instead of O(n) file reads.
   */
  public async listRecordings(): Promise<RecordingMetadata[]> {
    // Fast path: use SQLite store
    if (this.store) {
      const result = this.store.list();
      if (result.ok) {
        return result.value;
      }
      this.log.warn(`Failed to list recordings from store: ${result.error.message}`);
      // Fall through to fallback
    }

    // Fallback: scan files (only if store not initialized or errored)
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
      // Also remove from SQLite
      if (this.store) {
        const result = this.store.delete(id);
        if (!result.ok) {
          this.log.warn(`Failed to delete recording from store: ${result.error.message}`);
        }
      }
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
    // Only close SQLite connection if we own it
    if (this.ownsStore && this.store) {
      this.store.close();
    }
    this.store = null;
    this.stop();
  }

  public stop() {}
}
