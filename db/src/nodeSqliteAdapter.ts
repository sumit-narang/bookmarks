/**
 * Node.js SQLite adapter built on top of node:sqlite.
 */

import { DatabaseSync } from 'node:sqlite';
import type { DatabaseAdapter, RunResult, SqliteValue } from './types';

export interface NodeSqliteAdapterOptions {
  filename: string;
}

export class NodeSqliteAdapter implements DatabaseAdapter {
  private readonly database: DatabaseSync;
  private transactionDepth = 0;

  constructor(options: NodeSqliteAdapterOptions) {
    this.database = new DatabaseSync(options.filename);
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec('PRAGMA journal_mode = WAL;');
  }

  async exec(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  async run(sql: string, params: readonly SqliteValue[] = []): Promise<RunResult> {
    const statement = this.database.prepare(sql);
    const result = statement.run(...params);

    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  async get<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T | null> {
    const statement = this.database.prepare(sql);
    const row = statement.get(...params) as T | undefined;

    return row ?? null;
  }

  async all<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T[]> {
    const statement = this.database.prepare(sql);
    const rows = statement.all(...params) as T[];

    return rows;
  }

  async transaction<T>(callback: (database: DatabaseAdapter) => Promise<T>): Promise<T> {
    const savepointName = `sp_${this.transactionDepth}`;
    const isTopLevel = this.transactionDepth === 0;

    if (isTopLevel) {
      this.database.exec('BEGIN;');
    } else {
      this.database.exec(`SAVEPOINT ${savepointName};`);
    }

    this.transactionDepth += 1;

    try {
      const result = await callback(this);
      this.transactionDepth -= 1;

      if (isTopLevel) {
        this.database.exec('COMMIT;');
      } else {
        this.database.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }

      return result;
    } catch (error) {
      this.transactionDepth -= 1;

      if (isTopLevel) {
        this.database.exec('ROLLBACK;');
      } else {
        this.database.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        this.database.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }

      throw error;
    }
  }

  async close(): Promise<void> {
    this.database.close();
  }
}

/**
 * Create a Node.js adapter instance.
 * @param options
 * @returns {NodeSqliteAdapter}
 */
export const createNodeSqliteAdapter = (options: NodeSqliteAdapterOptions): NodeSqliteAdapter => {
  return new NodeSqliteAdapter(options);
};
