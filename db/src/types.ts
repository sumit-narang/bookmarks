/**
 * Shared database adapter contracts.
 */

export type SqliteValue = string | number | bigint | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface DatabaseAdapter {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqliteValue[]): Promise<RunResult>;
  get<T>(sql: string, params?: readonly SqliteValue[]): Promise<T | null>;
  all<T>(sql: string, params?: readonly SqliteValue[]): Promise<T[]>;
  transaction<T>(callback: (database: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
