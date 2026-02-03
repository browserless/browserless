import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
import { Logger } from '@browserless.io/browserless';
import path from 'path';

import type {
  IRecordingStore,
  RecordingMetadata,
  RecordingStoreError,
  Result,
} from './interfaces/recording-store.interface.js';
import { ok, err } from './interfaces/recording-store.interface.js';

interface InitializedState {
  db: DatabaseType;
  stmtInsert: Statement;
  stmtSelectAll: Statement;
  stmtSelectById: Statement;
  stmtDelete: Statement;
  stmtUpdateEncoding: Statement;
}

/**
 * SQLite-based metadata store for session recordings.
 *
 * Replaces O(n) file scanning with O(1) indexed queries.
 * Uses better-sqlite3 for Node.js compatibility.
 *
 * Schema:
 *   recordings table with indexed trackingId and startedAt columns
 *   Events stored separately in JSON files (not in SQLite)
 *
 * Error Handling:
 *   All methods return Result<T, RecordingStoreError> instead of throwing.
 *   This makes error handling explicit and testable.
 */
export class RecordingStore implements IRecordingStore {
  private log = new Logger('recording-store');
  private dbPath: string;
  private state: InitializedState | null = null;

  constructor(recordingsDir: string) {
    this.dbPath = path.join(recordingsDir, 'recordings.db');
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

      // Create table and indexes if they don't exist
      db.exec(`
        CREATE TABLE IF NOT EXISTS recordings (
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
        CREATE INDEX IF NOT EXISTS idx_trackingId ON recordings(trackingId);
        CREATE INDEX IF NOT EXISTS idx_startedAt ON recordings(startedAt DESC);
      `);

      // Migrate existing tables: add video columns if missing
      try {
        db.exec(`ALTER TABLE recordings ADD COLUMN frameCount INTEGER NOT NULL DEFAULT 0`);
      } catch { /* column already exists */ }
      try {
        db.exec(`ALTER TABLE recordings ADD COLUMN videoPath TEXT`);
      } catch { /* column already exists */ }
      try {
        db.exec(`ALTER TABLE recordings ADD COLUMN encodingStatus TEXT NOT NULL DEFAULT 'none'`);
      } catch { /* column already exists */ }

      this.state = {
        db,
        stmtInsert: db.prepare(`
          INSERT OR REPLACE INTO recordings
          (id, trackingId, startedAt, endedAt, duration, eventCount, browserType, routePath, userAgent, frameCount, videoPath, encodingStatus)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        stmtSelectAll: db.prepare(
          `SELECT * FROM recordings ORDER BY startedAt DESC`
        ),
        stmtSelectById: db.prepare(
          `SELECT * FROM recordings WHERE id = ?`
        ),
        stmtDelete: db.prepare(
          `DELETE FROM recordings WHERE id = ?`
        ),
        stmtUpdateEncoding: db.prepare(
          `UPDATE recordings SET encodingStatus = ?, videoPath = ? WHERE id = ?`
        ),
      };

      this.log.info(`Recording store initialized at ${this.dbPath}`);
      return this.state;
    } catch (error) {
      this.state = null;
      this.log.error(`Failed to initialize recording store: ${error}`);
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

    this.log.info('Recording store unhealthy, attempting recovery...');
    return this.initialize();
  }

  /**
   * Insert or update recording metadata.
   */
  insert(metadata: RecordingMetadata): Result<void, RecordingStoreError> {
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
        message: `Failed to insert recording ${metadata.id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Insert multiple recordings in a single atomic transaction.
   * Either all succeed or none are inserted.
   */
  insertBatch(metadata: RecordingMetadata[]): Result<void, RecordingStoreError> {
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
        message: `Failed to insert batch of ${metadata.length} recordings`,
        cause: 'cause' in txnResult.error ? txnResult.error.cause : undefined,
      });
    }

    return ok(undefined);
  }

  /**
   * List all recordings, ordered by startedAt descending.
   * O(1) query instead of O(n) file reads.
   */
  list(): Result<RecordingMetadata[], RecordingStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const results = s.stmtSelectAll.all() as RecordingMetadata[];
      return ok(results);
    } catch (error) {
      this.log.error(`List query failed: ${error}`);
      return err({
        type: 'query_failed',
        message: 'Failed to list recordings',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Find recording by ID.
   */
  findById(id: string): Result<RecordingMetadata | null, RecordingStoreError> {
    const s = this.ensureHealthy();
    if (!s) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = s.stmtSelectById.get(id) as RecordingMetadata | null;
      return ok(result);
    } catch (error) {
      this.log.error(`FindById query failed: ${error}`);
      return err({
        type: 'query_failed',
        message: `Failed to find recording by id: ${id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Delete recording metadata by ID.
   */
  delete(id: string): Result<boolean, RecordingStoreError> {
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
        message: `Failed to delete recording: ${id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Update encoding status and video path for a recording.
   */
  updateEncodingStatus(
    id: string,
    encodingStatus: RecordingMetadata['encodingStatus'],
    videoPath?: string,
  ): Result<boolean, RecordingStoreError> {
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
        message: `Failed to update encoding status for recording ${id}`,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Execute a function within a database transaction.
   * If the function throws, the transaction is rolled back.
   */
  transaction<T>(fn: () => T): Result<T, RecordingStoreError> {
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
      this.log.info('Recording store closed');
    } catch (error) {
      this.log.error(`Error closing database: ${error}`);
    }
  }
}
