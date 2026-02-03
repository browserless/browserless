import type {
  IReplayStore,
  ReplayMetadata,
  ReplayStoreError,
  Result,
} from './interfaces/replay-store.interface.js';
import { ok, err } from './interfaces/replay-store.interface.js';

/**
 * In-memory mock implementation of IReplayStore for testing.
 *
 * Features:
 * - Full interface compliance
 * - Configurable error injection for testing error paths
 * - Transaction simulation with rollback
 * - Fast O(1) operations via Map
 */
export class MockReplayStore implements IReplayStore {
  private replays: Map<string, ReplayMetadata> = new Map();
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
   * Get all replays for test assertions.
   */
  getAll(): ReplayMetadata[] {
    return Array.from(this.replays.values());
  }

  /**
   * Clear all replays for test isolation.
   */
  clear(): void {
    this.replays.clear();
  }

  insert(metadata: ReplayMetadata): Result<void, ReplayStoreError> {
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

    this.replays.set(metadata.id, { ...metadata });

    return ok(undefined);
  }

  insertBatch(metadata: ReplayMetadata[]): Result<void, ReplayStoreError> {
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
    const backup = new Map(this.replays);

    try {
      for (const m of metadata) {
        const result = this.insert(m);
        if (!result.ok) {
          // Rollback
          this.replays = backup;
          return err({
            type: 'transaction_failed',
            message: 'Batch insert failed, rolled back',
          });
        }
      }
      return ok(undefined);
    } catch {
      // Rollback on any error
      this.replays = backup;
      return err({
        type: 'transaction_failed',
        message: 'Batch insert failed, rolled back',
      });
    }
  }

  list(): Result<ReplayMetadata[], ReplayStoreError> {
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

    const results = Array.from(this.replays.values())
      .sort((a, b) => b.startedAt - a.startedAt);

    return ok(results);
  }

  findById(id: string): Result<ReplayMetadata | null, ReplayStoreError> {
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

    return ok(this.replays.get(id) ?? null);
  }

  delete(id: string): Result<boolean, ReplayStoreError> {
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

    const existing = this.replays.get(id);
    if (!existing) {
      return ok(false);
    }

    this.replays.delete(id);
    return ok(true);
  }

  updateEncodingStatus(
    id: string,
    encodingStatus: ReplayMetadata['encodingStatus'],
    videoPath?: string,
  ): Result<boolean, ReplayStoreError> {
    if (this.closed) {
      return err({ type: 'connection_failed', message: 'Store is closed' });
    }

    const replay = this.replays.get(id);
    if (!replay) {
      return ok(false);
    }

    replay.encodingStatus = encodingStatus;
    if (videoPath !== undefined) {
      replay.videoPath = videoPath;
    }
    return ok(true);
  }

  transaction<T>(fn: () => T): Result<T, ReplayStoreError> {
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
    const backup = new Map(this.replays);

    try {
      const result = fn();
      return ok(result);
    } catch (error) {
      // Rollback
      this.replays = backup;
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
    this.replays.clear();
  }
}
