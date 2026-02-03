/**
 * Result type for explicit error handling without exceptions.
 * Inspired by Rust's Result<T, E> type.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Discriminated union for ReplayStore errors.
 * Each error type has a specific `type` field for pattern matching.
 */
export type ReplayStoreError =
  | { type: 'connection_failed'; message: string; cause?: Error }
  | { type: 'query_failed'; message: string; cause?: Error }
  | { type: 'transaction_failed'; message: string; cause?: Error }
  | { type: 'not_found'; message: string };

/**
 * Replay metadata stored in SQLite.
 * Events are stored separately in JSON files for playback.
 */
export interface ReplayMetadata {
  browserType: string;
  duration: number;
  endedAt: number;
  eventCount: number;
  frameCount: number;
  id: string;
  routePath: string;
  startedAt: number;
  trackingId?: string;
  userAgent?: string;
  videoPath?: string;
  encodingStatus: 'none' | 'deferred' | 'pending' | 'encoding' | 'completed' | 'failed';
}

/**
 * Interface for replay metadata storage.
 *
 * Implementations:
 * - ReplayStore: SQLite-based production store
 * - MockReplayStore: In-memory store for testing
 *
 * All methods return Result types for explicit error handling.
 * No exceptions are thrown - errors are returned as values.
 */
export interface IReplayStore {
  /**
   * Insert or update a single replay metadata entry.
   * Uses UPSERT semantics (INSERT OR REPLACE).
   */
  insert(metadata: ReplayMetadata): Result<void, ReplayStoreError>;

  /**
   * Insert multiple replay metadata entries in a single transaction.
   * Either all succeed or none are inserted (atomic).
   */
  insertBatch(metadata: ReplayMetadata[]): Result<void, ReplayStoreError>;

  /**
   * List all replays, ordered by startedAt descending.
   * O(1) query via SQLite index.
   */
  list(): Result<ReplayMetadata[], ReplayStoreError>;

  /**
   * Find replay by ID.
   * O(1) primary key lookup.
   */
  findById(id: string): Result<ReplayMetadata | null, ReplayStoreError>;

  /**
   * Delete replay metadata by ID.
   * Returns true if a record was deleted, false if not found.
   */
  delete(id: string): Result<boolean, ReplayStoreError>;

  /**
   * Update encoding status and video path for a replay.
   * Returns true if a record was updated, false if not found.
   */
  updateEncodingStatus(
    id: string,
    encodingStatus: ReplayMetadata['encodingStatus'],
    videoPath?: string,
  ): Result<boolean, ReplayStoreError>;

  /**
   * Execute multiple operations in a single transaction.
   * If the function throws or returns an error, the transaction is rolled back.
   */
  transaction<T>(fn: () => T): Result<T, ReplayStoreError>;

  /**
   * Check if the store is healthy and can accept queries.
   * Does not throw - returns false if unhealthy.
   */
  isHealthy(): boolean;

  /**
   * Close the database connection.
   * After this, all operations will fail.
   */
  close(): void;
}

/**
 * Helper to create a success Result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Helper to create a failure Result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Type guard to check if a Result is successful.
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

/**
 * Type guard to check if a Result is an error.
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}
