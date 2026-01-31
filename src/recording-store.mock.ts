import type {
  IRecordingStore,
  RecordingMetadata,
  RecordingStoreError,
  Result,
} from './interfaces/recording-store.interface.js';
import { ok, err } from './interfaces/recording-store.interface.js';

/**
 * In-memory mock implementation of IRecordingStore for testing.
 *
 * Features:
 * - Full interface compliance
 * - Configurable error injection for testing error paths
 * - Transaction simulation with rollback
 * - Fast O(1) operations via Map
 */
export class MockRecordingStore implements IRecordingStore {
  private recordings: Map<string, RecordingMetadata> = new Map();
  private healthy = true;
  private closed = false;

  // Error injection for testing
  private shouldFailNextInsert = false;
  private shouldFailNextQuery = false;
  private shouldFailNextTransaction = false;

  /**
   * Inject an error on the next insert operation.
   */
  injectInsertError(): void {
    this.shouldFailNextInsert = true;
  }

  /**
   * Inject an error on the next query operation.
   */
  injectQueryError(): void {
    this.shouldFailNextQuery = true;
  }

  /**
   * Inject an error on the next transaction operation.
   */
  injectTransactionError(): void {
    this.shouldFailNextTransaction = true;
  }

  /**
   * Set the healthy state for testing.
   */
  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  /**
   * Get all recordings for test assertions.
   */
  getAll(): RecordingMetadata[] {
    return Array.from(this.recordings.values());
  }

  /**
   * Clear all recordings for test isolation.
   */
  clear(): void {
    this.recordings.clear();
  }

  insert(metadata: RecordingMetadata): Result<void, RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    if (this.shouldFailNextInsert) {
      this.shouldFailNextInsert = false;
      return err({
        type: 'query_failed',
        message: 'Injected insert error',
      });
    }

    this.recordings.set(metadata.id, { ...metadata });

    return ok(undefined);
  }

  insertBatch(metadata: RecordingMetadata[]): Result<void, RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    if (this.shouldFailNextTransaction) {
      this.shouldFailNextTransaction = false;
      return err({
        type: 'transaction_failed',
        message: 'Injected transaction error',
      });
    }

    // Simulate transaction - all or nothing
    const backup = new Map(this.recordings);

    try {
      for (const m of metadata) {
        const result = this.insert(m);
        if (!result.ok) {
          // Rollback
          this.recordings = backup;
          return err({
            type: 'transaction_failed',
            message: 'Batch insert failed, rolled back',
          });
        }
      }
      return ok(undefined);
    } catch {
      // Rollback on any error
      this.recordings = backup;
      return err({
        type: 'transaction_failed',
        message: 'Batch insert failed, rolled back',
      });
    }
  }

  list(): Result<RecordingMetadata[], RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    if (this.shouldFailNextQuery) {
      this.shouldFailNextQuery = false;
      return err({
        type: 'query_failed',
        message: 'Injected query error',
      });
    }

    const results = Array.from(this.recordings.values())
      .sort((a, b) => b.startedAt - a.startedAt);

    return ok(results);
  }

  findById(id: string): Result<RecordingMetadata | null, RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    if (this.shouldFailNextQuery) {
      this.shouldFailNextQuery = false;
      return err({
        type: 'query_failed',
        message: 'Injected query error',
      });
    }

    return ok(this.recordings.get(id) ?? null);
  }

  delete(id: string): Result<boolean, RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    if (this.shouldFailNextQuery) {
      this.shouldFailNextQuery = false;
      return err({
        type: 'query_failed',
        message: 'Injected query error',
      });
    }

    const existing = this.recordings.get(id);
    if (!existing) {
      return ok(false);
    }

    this.recordings.delete(id);
    return ok(true);
  }

  updateEncodingStatus(
    id: string,
    encodingStatus: RecordingMetadata['encodingStatus'],
    videoPath?: string,
  ): Result<boolean, RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    const recording = this.recordings.get(id);
    if (!recording) {
      return ok(false);
    }

    recording.encodingStatus = encodingStatus;
    if (videoPath !== undefined) {
      recording.videoPath = videoPath;
    }
    return ok(true);
  }

  transaction<T>(fn: () => T): Result<T, RecordingStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    if (this.shouldFailNextTransaction) {
      this.shouldFailNextTransaction = false;
      return err({
        type: 'transaction_failed',
        message: 'Injected transaction error',
      });
    }

    // Simulate transaction with rollback on error
    const backup = new Map(this.recordings);

    try {
      const result = fn();
      return ok(result);
    } catch (error) {
      // Rollback
      this.recordings = backup;
      return err({
        type: 'transaction_failed',
        message: 'Transaction failed, rolled back',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  isHealthy(): boolean {
    return this.healthy && !this.closed;
  }

  close(): void {
    this.closed = true;
    this.recordings.clear();
  }
}
