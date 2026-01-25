/**
 * Result type for explicit error handling without exceptions.
 * Inspired by Rust's Result<T, E> type.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Discriminated union for RecordingStore errors.
 * Each error type has a specific `type` field for pattern matching.
 */
export type RecordingStoreError =
  | { type: 'connection_failed'; message: string; cause?: Error }
  | { type: 'query_failed'; message: string; cause?: Error }
  | { type: 'transaction_failed'; message: string; cause?: Error }
  | { type: 'not_found'; message: string };

/**
 * Recording metadata stored in SQLite.
 * Events are stored separately in JSON files for playback.
 */
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

/**
 * Interface for recording metadata storage.
 *
 * Implementations:
 * - RecordingStore: SQLite-based production store
 * - MockRecordingStore: In-memory store for testing
 *
 * All methods return Result types for explicit error handling.
 * No exceptions are thrown - errors are returned as values.
 */
export interface IRecordingStore {
  /**
   * Insert or update a single recording metadata entry.
   * Uses UPSERT semantics (INSERT OR REPLACE).
   */
  insert(metadata: RecordingMetadata): Result<void, RecordingStoreError>;

  /**
   * Insert multiple recording metadata entries in a single transaction.
   * Either all succeed or none are inserted (atomic).
   */
  insertBatch(metadata: RecordingMetadata[]): Result<void, RecordingStoreError>;

  /**
   * List all recordings, ordered by startedAt descending.
   * O(1) query via SQLite index.
   */
  list(): Result<RecordingMetadata[], RecordingStoreError>;

  /**
   * Find recording by ID.
   * O(1) primary key lookup.
   */
  findById(id: string): Result<RecordingMetadata | null, RecordingStoreError>;

  /**
   * Delete recording metadata by ID.
   * Returns true if a record was deleted, false if not found.
   */
  delete(id: string): Result<boolean, RecordingStoreError>;

  /**
   * Execute multiple operations in a single transaction.
   * If the function throws or returns an error, the transaction is rolled back.
   */
  transaction<T>(fn: () => T): Result<T, RecordingStoreError>;

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
