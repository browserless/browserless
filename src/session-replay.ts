import {
  Config,
  Logger,
  exists,
} from '@browserless.io/browserless';
import { exec } from 'child_process';
import { EventEmitter } from 'events';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import cron, { type ScheduledTask } from 'node-cron';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { ReplayStore } from './replay-store.js';
import { replayEventsTotal, replayOverflowsTotal } from './prom-metrics.js';
import type { IReplayStore, ReplayMetadata } from './interfaces/replay-store.interface.js';

// Re-export ReplayMetadata for backwards compatibility
export type { ReplayMetadata } from './interfaces/replay-store.interface.js';

export interface ReplayEvent {
  data: unknown;
  timestamp: number;
  type: number;
}

export interface Replay {
  events: ReplayEvent[];
  metadata: ReplayMetadata;
}

/**
 * Result of stopping a replay.
 * Returns both the filepath and metadata for CDP event injection.
 */
export interface StopReplayResult {
  filepath: string;
  metadata: ReplayMetadata;
}

export interface SessionReplayState {
  events: ReplayEvent[];
  isReplaying: boolean;
  /** Merged session events exceeded maxReplaySize — stop adding to merged array
   *  but keep per-tab tracking alive for video metadata. */
  sessionOverflow: boolean;
  /** Running total of approximate JSON size (bytes) for merged events array */
  estimatedBytes: number;
  sessionId: string;
  startedAt: number;
  trackingId?: string;
  /** Functions to call for final event collection before stopping */
  finalCollectors: Array<() => Promise<void>>;
  /** Cleanup functions to call after replay stops (e.g., disconnect puppeteer) */
  cleanupFns: Array<() => Promise<void>>;
  /** Per-tab events, keyed by targetId */
  tabEvents: Map<string, ReplayEvent[]>;
  /** Per-tab metadata (start time, tracking info) */
  tabMetadata: Map<string, { startedAt: number; trackingId?: string }>;
}

/**
 * SessionReplay manages browser session replay capture and playback.
 *
 * Supports dependency injection for the replay store:
 * - If a store is provided via constructor, it's used directly
 * - If no store is provided, one is created during initialize()
 *
 * This decoupling allows for easy mocking in tests.
 */
export class SessionReplay extends EventEmitter {
  protected replays: Map<string, SessionReplayState> = new Map();
  protected log = new Logger('session-replay');
  protected replaysDir: string;
  protected videosDir: string;
  protected enabled: boolean;
  protected maxReplaySize: number;
  protected store: IReplayStore | null = null;
  protected ownsStore = false; // Track if we created the store (for cleanup)
  protected maxAgeMs: number;
  private cleanupTask: ScheduledTask | null = null;

  constructor(
    protected config: Config,
    injectedStore?: IReplayStore
  ) {
    super();
    this.enabled = process.env.ENABLE_REPLAY !== 'false';
    this.replaysDir = process.env.REPLAY_DIR || '/tmp/browserless-replays';
    this.videosDir = process.env.VIDEO_DIR || '/tmp/browserless-videos';
    this.maxReplaySize = +(process.env.REPLAY_MAX_SIZE || '52428800');
    // Default: 7 days (604800000ms)
    this.maxAgeMs = +(process.env.REPLAY_MAX_AGE_MS || '604800000');

    // Use injected store if provided
    if (injectedStore) {
      this.store = injectedStore;
      this.ownsStore = false;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getReplaysDir(): string {
    return this.replaysDir;
  }

  public getVideosDir(): string {
    return this.videosDir;
  }

  /**
   * Get the current replay store.
   * Useful for testing or advanced use cases.
   */
  public getStore(): IReplayStore | null {
    return this.store;
  }

  public async initialize(): Promise<void> {
    if (!this.enabled) {
      this.log.info('Session replay is disabled');
      return;
    }

    if (!(await exists(this.replaysDir))) {
      await mkdir(this.replaysDir, { recursive: true });
      this.log.info(`Created replays directory: ${this.replaysDir}`);
    }

    if (!(await exists(this.videosDir))) {
      await mkdir(this.videosDir, { recursive: true });
      this.log.info(`Created videos directory: ${this.videosDir}`);
    }

    // Only create store if not injected
    if (!this.store) {
      this.store = new ReplayStore(this.replaysDir);
      this.ownsStore = true;
    }

    // Migrate any existing JSON replays to SQLite (one-time migration)
    await this.migrateExistingReplays();

    this.log.info(`Session replay enabled, storing in: ${this.replaysDir}`);

    // Start daily cleanup of old replays
    this.startCleanupTimer();
  }

  /**
   * One-time migration: read existing JSON files and populate SQLite metadata.
   * Safe to run multiple times - INSERT OR REPLACE handles duplicates.
   */
  private async migrateExistingReplays(): Promise<void> {
    if (!this.store) return;

    try {
      const files = await readdir(this.replaysDir);
      let migrated = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(path.join(this.replaysDir, file), 'utf-8');
          const replay = JSON.parse(content);
          if (replay.metadata) {
            const result = this.store.insert(replay.metadata);
            if (result.ok) {
              migrated++;
            }
          }
        } catch {
          // Skip invalid files
        }
      }

      if (migrated > 0) {
        this.log.info(`Migrated ${migrated} existing replays to SQLite`);
      }
    } catch {
      // Directory might not exist or be empty
    }
  }

  /**
   * Schedule daily cleanup of old replays via cron.
   * Runs at 3 AM daily + once on startup.
   */
  private startCleanupTimer(): void {
    const maxAgeDays = Math.ceil(this.maxAgeMs / 86400000);

    // Run daily at 3 AM
    this.cleanupTask = cron.schedule('0 3 * * *', () => {
      this.cleanupOldReplays(maxAgeDays).catch((err) => {
        this.log.warn(`Scheduled cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    // Also run once on startup
    this.cleanupOldReplays(maxAgeDays).catch((err) => {
      this.log.warn(`Initial cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Delete replays older than maxAgeDays using `find`.
   * Handles files, directories, and orphans in one shot.
   * Preserves the SQLite database file.
   */
  protected async cleanupOldReplays(maxAgeDays: number): Promise<void> {
    // find handles files, directories, and orphans in one shot
    // -mindepth 1 -maxdepth 1: only top-level entries
    // -mtime +N: older than N days
    // -not -name "replays.db*": preserve SQLite database + WAL/SHM files
    const { stdout } = await execAsync(
      `find ${this.replaysDir} -mindepth 1 -maxdepth 1 -mtime +${maxAgeDays} -not -name "replays.db*" -printf "%f\\n" -exec rm -rf {} +`
    );

    const deleted = stdout.trim().split('\n').filter(Boolean);

    // Clean up SQLite entries for deleted replays
    if (this.store && deleted.length > 0) {
      for (const entry of deleted) {
        const id = entry.replace('.json', '');
        this.store.delete(id);
      }
    }

    if (deleted.length > 0) {
      this.log.info(`Cleaned up ${deleted.length} old replays (>${maxAgeDays}d)`);
    }
  }

  public startReplay(sessionId: string, trackingId?: string): void {
    if (!this.enabled || this.replays.has(sessionId)) return;

    this.replays.set(sessionId, {
      cleanupFns: [],
      estimatedBytes: 0,
      events: [],
      finalCollectors: [],
      isReplaying: true,
      sessionOverflow: false,
      sessionId,
      startedAt: Date.now(),
      trackingId,
      tabEvents: new Map(),
      tabMetadata: new Map(),
    });
    this.log.debug(`Started replay for session ${sessionId}`);
  }

  public addEvent(sessionId: string, event: ReplayEvent): void {
    const state = this.replays.get(sessionId);
    if (!state?.isReplaying) return;

    // Stop adding to merged session events when max size exceeded,
    // but do NOT call stopReplay — per-tab tracking must stay alive
    // for video metadata on long-lived sessions.
    if (state.sessionOverflow) return;

    // O(1) per add: only stringify the single new event, not the entire array
    const eventSize = JSON.stringify(event).length + 1; // +1 for comma delimiter
    if (state.estimatedBytes + eventSize > this.maxReplaySize) {
      this.log.warn(`Replay ${sessionId} exceeded max size (~${Math.round(state.estimatedBytes / 1048576)}MB), stopping merged event capture`);
      state.sessionOverflow = true;
      replayOverflowsTotal.inc();
      return;
    }
    state.estimatedBytes += eventSize;
    state.events.push(event);
    replayEventsTotal.inc();
  }

  public addEvents(sessionId: string, events: ReplayEvent[]): void {
    for (const event of events) {
      this.addEvent(sessionId, event);
    }
  }

  /**
   * Add events for a specific tab (targetId).
   * Stores in both the merged events array (for session-level replay)
   * and the per-tab events map (for per-tab replay files).
   */
  public addTabEvents(sessionId: string, targetId: string, events: ReplayEvent[]): void {
    const state = this.replays.get(sessionId);
    if (!state?.isReplaying) return;

    // Initialize tab tracking on first event
    if (!state.tabEvents.has(targetId)) {
      state.tabEvents.set(targetId, []);
      state.tabMetadata.set(targetId, { startedAt: Date.now() });
    }

    const tabEventList = state.tabEvents.get(targetId)!;

    for (const event of events) {
      if (state.sessionOverflow) {
        // Still add to per-tab (for per-tab replay files) even if merged overflowed
        tabEventList.push(event);
        replayEventsTotal.inc();
        continue;
      }
      const eventSize = JSON.stringify(event).length + 1;
      if (state.estimatedBytes + eventSize > this.maxReplaySize) {
        this.log.warn(`Replay ${sessionId} exceeded max size (~${Math.round(state.estimatedBytes / 1048576)}MB), stopping merged event capture`);
        state.sessionOverflow = true;
        replayOverflowsTotal.inc();
        tabEventList.push(event);
        replayEventsTotal.inc();
        continue;
      }
      state.estimatedBytes += eventSize;
      state.events.push(event);
      tabEventList.push(event);
      replayEventsTotal.inc();
    }
  }

  /**
   * Finalize a tab's recording into a separate replay file.
   * Called when a tab is destroyed (Target.targetDestroyed).
   * Returns StopReplayResult with per-tab metadata.
   */
  public async stopTabReplay(
    sessionId: string,
    targetId: string,
    metadata?: Partial<ReplayMetadata>,
    frameCount?: number,
  ): Promise<StopReplayResult | null> {
    const state = this.replays.get(sessionId);
    if (!state) return null;

    const tabEventList = state.tabEvents.get(targetId);
    const tabMeta = state.tabMetadata.get(targetId);
    if (!tabEventList || !tabMeta) return null;

    const endedAt = Date.now();
    const tabReplayId = `${sessionId}--tab-${targetId}`;
    const resolvedFrameCount = frameCount ?? 0;

    const replayMetadata: ReplayMetadata = {
      browserType: metadata?.browserType || 'unknown',
      duration: endedAt - tabMeta.startedAt,
      endedAt,
      eventCount: tabEventList.length,
      frameCount: resolvedFrameCount,
      id: tabReplayId,
      routePath: metadata?.routePath || 'unknown',
      startedAt: tabMeta.startedAt,
      trackingId: state.trackingId,
      encodingStatus: resolvedFrameCount > 0 ? 'deferred' : 'none',
      parentSessionId: sessionId,
      targetId,
    };

    const replay: Replay = {
      events: tabEventList,
      metadata: replayMetadata,
    };

    const filepath = path.join(this.replaysDir, `${tabReplayId}.json`);

    try {
      await writeFile(filepath, JSON.stringify(replay), 'utf-8');

      if (this.store) {
        const result = this.store.insert(replayMetadata);
        if (!result.ok) {
          this.log.warn(`Failed to save tab replay metadata: ${result.error.message}`);
        }
      }

      this.log.info(`Saved tab replay ${tabReplayId} with ${tabEventList.length} events`);
    } catch (err) {
      this.log.error(`Failed to save tab replay ${tabReplayId}: ${err}`);
      return null;
    }

    // Clean up tab state (events stay in merged session array)
    state.tabEvents.delete(targetId);
    state.tabMetadata.delete(targetId);

    return { filepath, metadata: replayMetadata };
  }

  /**
   * Register a function to be called for final event collection before stopping.
   * This ensures we don't lose events between the last poll and session close.
   */
  public registerFinalCollector(sessionId: string, collector: () => Promise<void>): void {
    const state = this.replays.get(sessionId);
    if (state) {
      state.finalCollectors.push(collector);
    }
  }

  /**
   * Register a cleanup function to be called after replay stops.
   * Use this for resources that need cleanup (e.g., disconnect puppeteer connections).
   */
  public registerCleanupFn(sessionId: string, cleanupFn: () => Promise<void>): void {
    const state = this.replays.get(sessionId);
    if (state) {
      state.cleanupFns.push(cleanupFn);
    }
  }

  public async stopReplay(
    sessionId: string,
    metadata?: Partial<ReplayMetadata>
  ): Promise<StopReplayResult | null> {
    const state = this.replays.get(sessionId);
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

    state.isReplaying = false;
    const endedAt = Date.now();

    const replayMetadata: ReplayMetadata = {
      browserType: metadata?.browserType || 'unknown',
      duration: endedAt - state.startedAt,
      endedAt,
      eventCount: state.events.length,
      frameCount: metadata?.frameCount ?? 0,
      id: sessionId,
      routePath: metadata?.routePath || 'unknown',
      startedAt: state.startedAt,
      trackingId: state.trackingId,
      userAgent: metadata?.userAgent,
      encodingStatus: metadata?.frameCount ? 'deferred' : 'none',
    };

    const replay: Replay = {
      events: state.events,
      metadata: replayMetadata,
    };

    const filepath = path.join(this.replaysDir, `${sessionId}.json`);

    try {
      // Save full replay to JSON (events + metadata for playback)
      await writeFile(filepath, JSON.stringify(replay), 'utf-8');

      // Save metadata to SQLite for fast queries
      if (this.store) {
        const result = this.store.insert(replay.metadata);
        if (!result.ok) {
          this.log.warn(`Failed to save replay metadata to store: ${result.error.message}`);
        }
      }

      this.log.info(`Saved replay ${sessionId} with ${state.events.length} events`);
    } catch (err) {
      this.log.error(`Failed to save replay ${sessionId}: ${err}`);
    }

    // Run cleanup functions BEFORE deleting state — cleanup may call stopTabReplay()
    // which needs this.replays.get(sessionId) to still exist.
    this.log.info(`Running ${state.cleanupFns.length} cleanup functions for ${sessionId}`);
    for (const cleanupFn of state.cleanupFns) {
      try {
        await cleanupFn();
      } catch (e) {
        this.log.warn(`Cleanup function failed for ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.log.info(`Cleanup complete for ${sessionId}`);

    this.replays.delete(sessionId);

    return { filepath, metadata: replayMetadata };
  }

  public isReplaying(sessionId: string): boolean {
    return this.replays.get(sessionId)?.isReplaying || false;
  }

  public getReplayState(sessionId: string): SessionReplayState | undefined {
    return this.replays.get(sessionId);
  }

  /**
   * List all replay metadata.
   * Uses SQLite for O(1) query instead of O(n) file reads.
   */
  public async listReplays(): Promise<ReplayMetadata[]> {
    // Fast path: use SQLite store
    if (this.store) {
      const result = this.store.list();
      if (result.ok) {
        return result.value;
      }
      this.log.warn(`Failed to list replays from store: ${result.error.message}`);
      // Fall through to fallback
    }

    // Fallback: scan files (only if store not initialized or errored)
    if (!(await exists(this.replaysDir))) return [];

    const files = await readdir(this.replaysDir);
    const replays: ReplayMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(path.join(this.replaysDir, file), 'utf-8');
        replays.push(JSON.parse(content).metadata);
      } catch {
        // Skip invalid files
      }
    }

    return replays.sort((a, b) => b.startedAt - a.startedAt);
  }

  public async getReplay(id: string): Promise<Replay | null> {
    const filepath = path.join(this.replaysDir, `${id}.json`);
    if (!(await exists(filepath))) return null;

    try {
      return JSON.parse(await readFile(filepath, 'utf-8'));
    } catch {
      return null;
    }
  }

  public async getReplayMetadata(id: string): Promise<ReplayMetadata | null> {
    // Fast path: SQLite lookup
    if (this.store) {
      const result = this.store.findById(id);
      if (result.ok) return result.value;
    }
    // Fallback: read JSON file, extract metadata only
    const replay = await this.getReplay(id);
    return replay?.metadata ?? null;
  }

  public async deleteReplay(id: string): Promise<boolean> {
    const filepath = path.join(this.replaysDir, `${id}.json`);
    if (!(await exists(filepath))) return false;

    try {
      await rm(filepath);
      // Video cleanup is handled by VideoManager.deleteVideoFrames()
      // called by the route handler — SessionReplay only owns replay data.
      // Also remove from SQLite
      if (this.store) {
        const result = this.store.delete(id);
        if (!result.ok) {
          this.log.warn(`Failed to delete replay from store: ${result.error.message}`);
        }
      }
      this.log.info(`Deleted replay ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop all active replays, saving events to disk.
   * Used by SIGTERM handler for graceful container shutdown.
   */
  public async stopAllReplays(): Promise<void> {
    const sessionIds = [...this.replays.keys()];
    if (sessionIds.length === 0) return;

    this.log.info(`Stopping ${sessionIds.length} active replay(s)...`);
    for (const sessionId of sessionIds) {
      try {
        await this.stopReplay(sessionId);
      } catch (e) {
        this.log.warn(`stopAllReplays failed for ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.log.info(`Stopped all replays`);
  }

  public async shutdown(): Promise<void> {
    this.log.info('Shutting down session replay...');

    // Stop cleanup cron
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
    }

    for (const [sessionId] of this.replays) {
      await this.stopReplay(sessionId);
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
