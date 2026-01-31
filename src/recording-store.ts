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
  private db: DatabaseType | null = null;
  private log = new Logger('recording-store');
  private healthy = false;

  // Prepared statements cache
  private stmtInsert: Statement | null = null;
  private stmtSelectAll: Statement | null = null;
  private stmtSelectById: Statement | null = null;
  private stmtDelete: Statement | null = null;
  private stmtUpdateEncoding: Statement | null = null;

  constructor(recordingsDir: string) {
    const dbPath = path.join(recordingsDir, 'recordings.db');

    try {
      this.db = new Database(dbPath);

      // Create table and indexes if they don't exist
      this.db.exec(`
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
        this.db.exec(`ALTER TABLE recordings ADD COLUMN frameCount INTEGER NOT NULL DEFAULT 0`);
      } catch { /* column already exists */ }
      try {
        this.db.exec(`ALTER TABLE recordings ADD COLUMN videoPath TEXT`);
      } catch { /* column already exists */ }
      try {
        this.db.exec(`ALTER TABLE recordings ADD COLUMN encodingStatus TEXT NOT NULL DEFAULT 'none'`);
      } catch { /* column already exists */ }

      // Prepare statements for better performance
      this.stmtInsert = this.db.prepare(`
        INSERT OR REPLACE INTO recordings
        (id, trackingId, startedAt, endedAt, duration, eventCount, browserType, routePath, userAgent, frameCount, videoPath, encodingStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      this.stmtSelectAll = this.db.prepare(
        `SELECT * FROM recordings ORDER BY startedAt DESC`
      );

      this.stmtSelectById = this.db.prepare(
        `SELECT * FROM recordings WHERE id = ?`
      );

      this.stmtDelete = this.db.prepare(
        `DELETE FROM recordings WHERE id = ?`
      );

      this.stmtUpdateEncoding = this.db.prepare(
        `UPDATE recordings SET encodingStatus = ?, videoPath = ? WHERE id = ?`
      );

      this.healthy = true;
      this.log.info(`Recording store initialized at ${dbPath}`);
    } catch (error) {
      this.healthy = false;
      this.log.error(`Failed to initialize recording store: ${error}`);
    }
  }

  /**
   * Insert or update recording metadata.
   */
  insert(metadata: RecordingMetadata): Result<void, RecordingStoreError> {
    if (!this.db || !this.stmtInsert) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      this.stmtInsert.run(
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
    if (!this.db || !this.stmtInsert) {
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
        this.stmtInsert!.run(
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
    if (!this.db || !this.stmtSelectAll) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const results = this.stmtSelectAll.all() as RecordingMetadata[];
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
    if (!this.db || !this.stmtSelectById) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = this.stmtSelectById.get(id) as RecordingMetadata | null;
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
    if (!this.db || !this.stmtDelete) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = this.stmtDelete.run(id);
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
    if (!this.db || !this.stmtUpdateEncoding) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      const result = this.stmtUpdateEncoding.run(
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
    if (!this.db) {
      return err({
        type: 'connection_failed',
        message: 'Database not initialized',
      });
    }

    try {
      // better-sqlite3's db.transaction() returns a wrapper function
      // that executes fn() within BEGIN/COMMIT or ROLLBACK on error
      const txnWrapper = this.db.transaction(fn);
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
    if (!this.healthy || !this.db) {
      return false;
    }

    // Quick integrity check
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      // Finalize prepared statements
      this.stmtInsert = null;
      this.stmtSelectAll = null;
      this.stmtSelectById = null;
      this.stmtDelete = null;
      this.stmtUpdateEncoding = null;

      this.db?.close();
      this.db = null;
      this.healthy = false;
      this.log.info('Recording store closed');
    } catch (error) {
      this.log.error(`Error closing database: ${error}`);
    }
  }
}
