/**
 * Foundation schema integration tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../db/src';
import { schemaMigrations } from '../schema/src';

const expectedTables = [
  'collection_places',
  'collections',
  'outbox',
  'places',
  'preferences',
  'schema_migrations',
  'sync_state',
  'users',
];

const withTemporaryDatabase = async (run: (databasePath: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'bookmarks-foundation-'));
  const databasePath = join(root, 'integration.sqlite');

  try {
    await run(databasePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('migrateDatabase creates all expected v1 tables', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      const applied = await migrateDatabase(database, schemaMigrations);
      const tables = await listUserTables(database);

      assert.deepEqual(applied, ['0001_initial', '0002_sync_state_entity_type']);
      assert.deepEqual(tables, expectedTables);
    } finally {
      await database.close();
    }
  });
});

test('migrateDatabase is idempotent', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);
      const appliedSecondRun = await migrateDatabase(database, schemaMigrations);
      const migrationRows = await database.all<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id;');

      assert.deepEqual(appliedSecondRun, []);
      assert.deepEqual(migrationRows.map((row) => row.id), ['0001_initial', '0002_sync_state_entity_type']);
    } finally {
      await database.close();
    }
  });
});
