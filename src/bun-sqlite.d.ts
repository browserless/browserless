/**
 * Type declarations for bun:sqlite module.
 * This is a minimal declaration to satisfy TypeScript.
 * Full types are available at runtime when using Bun.
 */

declare module 'bun:sqlite' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }

  export interface Statement<T = unknown> {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): T | null;
    all(...params: unknown[]): T[];
    finalize(): void;
  }

  export class Database {
    constructor(filename: string);

    exec(sql: string): void;
    query<T = unknown>(sql: string): Statement<T>;
    prepare<T = unknown>(sql: string): Statement<T>;
    transaction<T>(fn: () => T): () => T;
    close(): void;

    readonly filename: string;
    readonly inTransaction: boolean;
  }
}
