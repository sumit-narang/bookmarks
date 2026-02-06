/**
 * Bookmarks CLI foundation commands.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
import { schemaMigrations } from '../../../schema/src';

interface ParsedArgs {
  command: string | null;
  databasePath: string;
}

const defaultDatabasePath = resolve(process.cwd(), '.bookmarks', 'local.sqlite');

const parseArguments = (argv: string[]): ParsedArgs => {
  const command = argv[0] ?? null;
  let databasePath = defaultDatabasePath;

  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--db' || current === '--database') {
      const nextValue = argv[index + 1];

      if (nextValue) {
        databasePath = resolve(nextValue);
        index += 1;
      }
    }
  }

  return { command, databasePath };
};

const ensureParentDirectory = (databasePath: string): void => {
  mkdirSync(dirname(databasePath), { recursive: true });
};

const runDbInit = async (databasePath: string): Promise<void> => {
  ensureParentDirectory(databasePath);

  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const applied = await migrateDatabase(database, schemaMigrations);

    if (applied.length === 0) {
      console.log(`Database already initialized: ${databasePath}`);
      return;
    }

    console.log(`Database initialized: ${databasePath}`);
    console.log(`Applied migrations: ${applied.join(', ')}`);
  } finally {
    await database.close();
  }
};

const runDbReset = async (databasePath: string): Promise<void> => {
  if (existsSync(databasePath)) {
    rmSync(databasePath);
  }

  await runDbInit(databasePath);
  console.log('Database reset complete.');
};

const runDbInspect = async (databasePath: string): Promise<void> => {
  ensureParentDirectory(databasePath);

  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);

    const tables = await listUserTables(database);
    const summary: Record<string, number> = {};

    for (const table of tables) {
      const row = await database.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${table};`);
      summary[table] = row?.count ?? 0;
    }

    console.log(`Database: ${databasePath}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await database.close();
  }
};

const printHelp = (): void => {
  console.log('Bookmarks CLI');
  console.log('');
  console.log('Commands:');
  console.log('  db:init      Initialize SQLite schema');
  console.log('  db:reset     Recreate local SQLite file and schema');
  console.log('  db:inspect   Print table row counts');
  console.log('');
  console.log('Options:');
  console.log('  --db <path>  Custom SQLite database path');
};

const run = async (): Promise<void> => {
  const { command, databasePath } = parseArguments(process.argv.slice(2));

  switch (command) {
    case 'db:init':
      await runDbInit(databasePath);
      return;
    case 'db:reset':
      await runDbReset(databasePath);
      return;
    case 'db:inspect':
      await runDbInspect(databasePath);
      return;
    default:
      printHelp();
      process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error('CLI command failed:', error);
  process.exit(1);
});
