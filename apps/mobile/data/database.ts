/**
 * Mobile SQLite lifecycle helpers.
 * Opens the Expo SQLite database and runs shared migrations.
 */

import * as SQLite from 'expo-sqlite';
import type { DatabaseAdapter, ExpoDatabaseClient } from '../../../db/src';
import { createExpoSqliteAdapter, migrateDatabase } from '../../../db/src';
import { schemaMigrations } from '../../../schema/src';

const MOBILE_DATABASE_NAME = 'bookmarks-mobile.sqlite';

let databaseAdapter: DatabaseAdapter | null = null;
let initializationPromise: Promise<DatabaseAdapter> | null = null;

const openDatabase = async (): Promise<DatabaseAdapter> => {
  const sqliteDatabase = await SQLite.openDatabaseAsync(MOBILE_DATABASE_NAME);
  const adapter = createExpoSqliteAdapter(sqliteDatabase as unknown as ExpoDatabaseClient);
  await migrateDatabase(adapter, schemaMigrations);
  return adapter;
};

/**
 * Initialize (or return) the shared mobile database adapter.
 * @returns {Promise<DatabaseAdapter>}
 */
export const initializeDatabase = async (): Promise<DatabaseAdapter> => {
  if (databaseAdapter) {
    return databaseAdapter;
  }

  if (!initializationPromise) {
    initializationPromise = openDatabase()
      .then((adapter) => {
        databaseAdapter = adapter;
        return adapter;
      })
      .finally(() => {
        initializationPromise = null;
      });
  }

  return initializationPromise;
};

/**
 * Get the initialized mobile database adapter.
 * @returns {Promise<DatabaseAdapter>}
 */
export const getDatabase = async (): Promise<DatabaseAdapter> => {
  return initializeDatabase();
};

/**
 * Close the current database connection.
 */
export const closeDatabase = async (): Promise<void> => {
  if (!databaseAdapter) {
    return;
  }

  await databaseAdapter.close();
  databaseAdapter = null;
};

/**
 * Delete the mobile SQLite file after closing active adapters.
 */
export const wipeMobileDatabase = async (): Promise<void> => {
  await closeDatabase();
  await SQLite.deleteDatabaseAsync(MOBILE_DATABASE_NAME);
};

/**
 * Read-only access to the configured mobile database filename.
 * @returns {string}
 */
export const getMobileDatabaseName = (): string => {
  return MOBILE_DATABASE_NAME;
};
