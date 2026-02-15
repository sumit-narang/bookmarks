/**
 * Migration runner utilities.
 */

import { nowIso } from '../../core/src';
import type { Migration } from '../../schema/src';
import type { DatabaseAdapter } from './types';

interface MigrationRow {
  id: string;
}

/**
 * Ensure migration bookkeeping table exists.
 * @param database
 */
export const ensureMigrationTable = async (database: DatabaseAdapter): Promise<void> => {
  await database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
};

/**
 * Apply pending migrations in-order.
 * @param database
 * @param migrations
 * @returns {Promise<string[]>} applied migration IDs
 */
export const migrateDatabase = async (
  database: DatabaseAdapter,
  migrations: readonly Migration[]
): Promise<string[]> => {
  await ensureMigrationTable(database);

  const appliedRows = await database.all<MigrationRow>('SELECT id FROM schema_migrations;');
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const pendingMigrations = migrations.filter((migration) => !appliedIds.has(migration.id));

  if (pendingMigrations.length === 0) {
    return [];
  }

  await database.transaction(async (tx) => {
    for (const migration of pendingMigrations) {
      for (const statement of migration.statements) {
        await tx.exec(statement);
      }

      await tx.run(
        'INSERT INTO schema_migrations (id, description, applied_at) VALUES (?, ?, ?);',
        [migration.id, migration.description, nowIso()]
      );
    }
  });

  return pendingMigrations.map((migration) => migration.id);
};

/**
 * List all non-SQLite-internal tables.
 * @param database
 * @returns {Promise<string[]>}
 */
export const listUserTables = async (database: DatabaseAdapter): Promise<string[]> => {
  const rows = await database.all<{ name: string }>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
     ORDER BY name;`
  );

  return rows.map((row) => row.name);
};
