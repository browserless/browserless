import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
import { Logger } from '@browserless.io/browserless';
import path from 'path';

import type {
  IReplayStore,
  ReplayMetadata,
  ReplayStoreError,
  Result,
} from './interfaces/replay-store.interface.js';
import { ok, err } from './interfaces/replay-store.interface.js';

interface InitializedState {
  db: DatabaseType;
  stmtInsert: Statement;
  stmtSelectAll: Statement;
  stmtSelectById: Statement;
  stmtDelete: Statement;
  stmtUpdateEncoding: Statement;
}

/**
 * SQLite-based metadata store for session replays.
 *
 * Replaces O(n) file scanning with O(1) indexed queries.
 * Uses better-sqlite3 for Node.js compatibility.
 *
 * Schema:
 *   replays table with indexed trackingId and startedAt columns
 *   Events stored separately in JSON files (not in SQLite)
 *
 * Error Handling:
 *   All methods return Result<T, ReplayStoreError> instead of throwing.
 *   This makes error handling explicit and testable.
 */
export class ReplayStore implements IReplayStore {
  private log = new Logger('replay-store');
  private dbPath: string;
  private state: InitializedState | null = null;

  constructor(replaysDir: string) {
    // Migrate legacy recordings.db to replays.db if it exists
    const legacyDbPath = path.join(replaysDir, 'recordings.db');
    const newDbPath = path.join(replaysDir, 'replays.db');
    try {
      const fs = require('fs');
      if (fs.existsSync(legacyDbPath) && !fs.existsSync(newDbPath)) {
        fs.renameSync(legacyDbPath, newDbPath);
        // Also rename WAL/SHM files if they exist
        try { fs.renameSync(legacyDbPath + '-wal', newDbPath + '-wal'); } catch { /* ignore */ }
        try { fs.renameSync(legacyDbPath + '-shm', newDbPath + '-shm'); } catch { /* ignore */ }
      }
    } catch { /* ignore migration errors, DB will be created fresh */ }

    this.dbPath = path.join(replaysDir, 'replays.db');
    this.initialize();
  }

  /**
   * Initialize (or reinitialize) the SQLite database connection,
   * create tables/indexes, and prepare statements.
   */
  private initialize(): InitializedState | null {
    try {
      // Close stale handle if any
      try { this.state?.db.close(); } catch { /* ignore */ }

      const db = new Database(this.dbPath);

      // Migrate legacy table name if it exists
      try {
        db.exec(`ALTER TABLE recordings RENAME TO replays`);
      } catch { /* table already renamed or doesn't exist */ }

      // Create table and indexes if they don't exist
      db.exec(`
        CREATE TABLE IF NOT EXISTS replays (
          id TEXT PRIMARY KEY,
          trackingId TEXT,
          startedAt INTEGER NOT NULL,
          endedAt INTEGER NOT NULL,
          duration INTEGER NOT NULL,
          eventCount INTEGER NOT NULL,
          browserType TEXT,
          routePath TEXT,
          userAgent TEXT,
          frameCount INTEGER NOT NULL DEFAULT 0,
          videoPath TEXT,
          encodingStatus TEXT NOT NULL DEFAULT 'none'
        );
        CREATE INDEX IF NOT EXISTS idx_trackingId ON replays(trackingId);
        CREATE INDEX IF NOT EXISTS idx_startedAt ON replays(startedAt DESC);
      `);

      // Migrate existing tables: add video columns if missing
      try {
        db.exec(`ALTER TABLE replays ADD COLUMN frameCount INTEGER NOT NULL DEFAULT 0`);
      } catch { /* column already exists */ }
      try {
        db.exec(`ALTER TABLE replays ADD COLUMN videoPath TEXT`);
      } catch { /* column already exists */ }
      try {
        db.exec(`ALTER TABLE replays ADD COLUMN encodingStatus TEXT NOT NULL DEFAULT 'none'`);
      } catch { /* column already exists */ }

      this.state = {
        db,
        stmtInsert: db.prepare(`
          INSERT OR REPLACE INTO replays
          (id, trackingId, startedAt, endedAt, duration, eventCount, browserType, routePath, userAgent, frameCount, videoPath, encodingStatus)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        stmtSelectAll: db.prepare(
          `SELECT * FROM replays ORDER BY startedAt DESC`
        ),
        stmtSelectById: db.prepare(
          `SELECT * FROM replays WHERE id = ?`
        ),
        stmtDelete: db.prepare(
          `DELETE FROM replays WHERE id = ?`
        ),
        stmtUpdateEncoding: db.prepare(
          `UPDATE replays SET encodingStatus = ?, videoPath = ? WHERE id = ?`
        ),
      };

      this.log.info(`Replay store initialized at ${this.dbPath}`);
      return this.state;
    } catch (error) {
      this.state = null;
      this.log.error(`Failed to initialize replay store: ${error}`);
      return null;
    }
  }

  /**
   * Ensure the store is healthy before operations.
   * If unhealthy, attempt to reinitialize the database.
   * Returns the initialized state or null if recovery failed.
   */
  private ensureHealthy(): InitializedState | null {
    if (this.state) return this.state;

    this.log.info('Replay store unhealthy, attempting recovery...');
    return this.initialize();
  }

  /**
   * Insert or update replay metadata.
   */
  insert(metadata: ReplayMetadata): Result<void, ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      s.stmtInsert.run(
        metadata.id,
        metadata.trackingId ?? null,
        metadata.startedAt,
        metadata.endedAt,
        metadata.duration,
        metadata.eventCount,
        metadata.browserType,
        metadata.routePath,
        metadata.userAgent ?? null,
        metadata.frameCount,
        metadata.videoPath ?? null,
        metadata.encodingStatus
      );
      return ok(undefined);
    } catch (error) {
      this.log.error(`Insert failed: ${error}`);
      return err({
        type: 'query_failed',
        message: `Failed to insert replay ${metadata.id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Insert multiple replays in a single atomic transaction.
   * Either all succeed or none are inserted.
   */
  insertBatch(metadata: ReplayMetadata[]): Result<void, ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    if (metadata.length === 0) {
      return ok(undefined);
    }

    const txnResult = this.transaction(() => {
      for (const m of metadata) {
        s.stmtInsert.run(
          m.id,
          m.trackingId ?? null,
          m.startedAt,
          m.endedAt,
          m.duration,
          m.eventCount,
          m.browserType,
          m.routePath,
          m.userAgent ?? null,
          m.frameCount,
          m.videoPath ?? null,
          m.encodingStatus
        );
      }
    });

    if (!txnResult.ok) {
      return err({
        type: 'transaction_failed',
        message: `Failed to insert batch of ${metadata.length} replays`,
        cause: 'cause' in txnResult.error ? txnResult.error.cause : undefined,
      });
    }

    return ok(undefined);
  }

  /**
   * List all replays, ordered by startedAt descending.
   * O(1) query instead of O(n) file reads.
   */
  list(): Result<ReplayMetadata[], ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const results = s.stmtSelectAll.all() as ReplayMetadata[];
      return ok(results);
    } catch (error) {
      this.log.error(`List query failed: ${error}`);
      return err({
        type: 'query_failed',
        message: 'Failed to list replays',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Find replay by ID.
   */
  findById(id: string): Result<ReplayMetadata | null, ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = s.stmtSelectById.get(id) as ReplayMetadata | null;
      return ok(result);
    } catch (error) {
      this.log.error(`FindById query failed: ${error}`);
      return err({
        type: 'query_failed',
        message: `Failed to find replay by id: ${id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Delete replay metadata by ID.
   */
  delete(id: string): Result<boolean, ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = s.stmtDelete.run(id);
      return ok(result.changes > 0);
    } catch (error) {
      this.log.error(`Delete query failed: ${error}`);
      return err({
        type: 'query_failed',
        message: `Failed to delete replay: ${id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Update encoding status and video path for a replay.
   */
  updateEncodingStatus(
    id: string,
    encodingStatus: ReplayMetadata['encodingStatus'],
    videoPath?: string,
  ): Result<boolean, ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = s.stmtUpdateEncoding.run(
        encodingStatus,
        videoPath ?? null,
        id,
      );
      return ok(result.changes > 0);
    } catch (error) {
      this.log.error(`UpdateEncodingStatus failed: ${error}`);
      return err({
        type: 'query_failed',
        message: `Failed to update encoding status for replay ${id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Execute a function within a database transaction.
   * If the function throws, the transaction is rolled back.
   */
  transaction<T>(fn: () => T): Result<T, ReplayStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      // better-sqlite3's db.transaction() returns a wrapper function
      // that executes fn() within BEGIN/COMMIT or ROLLBACK on error
      const txnWrapper = s.db.transaction(fn);
      const result = txnWrapper();
      return ok(result);
    } catch (error) {
      this.log.error(`Transaction failed: ${error}`);
      return err({
        type: 'transaction_failed',
        message: 'Transaction rolled back due to error',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Check if the store is healthy and can accept queries.
   */
  isHealthy(): boolean {
    if (!this.state) {
      return false;
    }

    // Quick integrity check
    try {
      this.state.db.prepare('SELECT 1').get();
      return true;
    } catch {
      this.state = null;
      return false;
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      this.state?.db.close();
      this.state = null;
      this.log.info('Replay store closed');
    } catch (error) {
      this.log.error(`Error closing database: ${error}`);
    }
  }
}
