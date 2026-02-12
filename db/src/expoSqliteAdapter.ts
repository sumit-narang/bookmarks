/**
 * Expo-compatible SQLite adapter wrapper.
 *
 * This adapter is dependency-injected so the module can compile in Node
 * environments without importing expo-sqlite directly.
 */

import type { DatabaseAdapter, RunResult, SqliteValue } from './types';

export interface ExpoDatabaseClient {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqliteValue[]): Promise<{ changes: number; lastInsertRowId?: number; lastInsertRowid?: number }>;
  getFirstAsync<T>(sql: string, params: SqliteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: SqliteValue[]): Promise<T[]>;
  closeAsync?(): Promise<void>;
}

export class ExpoSqliteAdapter implements DatabaseAdapter {
  private readonly database: ExpoDatabaseClient;
  private isInTransaction = false;

  constructor(database: ExpoDatabaseClient) {
    this.database = database;
  }

  async exec(sql: string): Promise<void> {
    await this.database.execAsync(sql);
  }

  async run(sql: string, params: readonly SqliteValue[] = []): Promise<RunResult> {
    const result = await this.database.runAsync(sql, [...params]);

    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid ?? result.lastInsertRowId ?? 0,
    };
  }

  async get<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T | null> {
    return this.database.getFirstAsync<T>(sql, [...params]);
  }

  async all<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T[]> {
    return this.database.getAllAsync<T>(sql, [...params]);
  }

  async transaction<T>(callback: (database: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (this.isInTransaction) {
      throw new Error('Nested Expo transactions are not currently supported.');
    }

    this.isInTransaction = true;

    try {
      await this.database.execAsync('BEGIN;');
      const result = await callback(this);
      await this.database.execAsync('COMMIT;');
      return result;
    } catch (error) {
      await this.database.execAsync('ROLLBACK;');
      throw error;
    } finally {
      this.isInTransaction = false;
    }
  }

  async close(): Promise<void> {
    if (this.database.closeAsync) {
      await this.database.closeAsync();
    }
  }
}

/**
 * Create an Expo adapter from an injected expo-sqlite database instance.
 * @param database
 * @returns {ExpoSqliteAdapter}
 */
export const createExpoSqliteAdapter = (database: ExpoDatabaseClient): ExpoSqliteAdapter => {
  return new ExpoSqliteAdapter(database);
};
