/**
 * Bookmarks CLI foundation commands.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
import {
  createPreferencesHttpClient,
  getOrCreatePreferences,
  setPreferences,
  syncPreferences,
  type HexagonPreferencesPatch,
} from '../../../preferences/src';
import { schemaMigrations } from '../../../schema/src';

interface ParsedArgs {
  command: string | null;
  databasePath: string;
  userId: string;
  remoteUrl: string;
  theme: string | undefined;
  variant: string | undefined;
  size: number | undefined;
  customDepth: number | null;
  hasCustomDepth: boolean;
  useCustomDepth: boolean | undefined;
}

const defaultDatabasePath = resolve(process.cwd(), '.bookmarks', 'local.sqlite');
const defaultUserId = 'local-user';
const defaultRemoteUrl = 'http://127.0.0.1:8787';

const parseBoolean = (value: string, optionName: string): boolean => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`${optionName} must be true or false.`);
};

const parseRequiredValue = (argv: string[], index: number, optionName: string): string => {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return value;
};

const parseNumberValue = (value: string, optionName: string): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} must be a valid number.`);
  }

  return parsed;
};

const parseArguments = (argv: string[]): ParsedArgs => {
  const command = argv[0] ?? null;
  let databasePath = defaultDatabasePath;
  let userId = defaultUserId;
  let remoteUrl = defaultRemoteUrl;
  let theme: string | undefined;
  let variant: string | undefined;
  let size: number | undefined;
  let customDepth: number | null = null;
  let hasCustomDepth = false;
  let useCustomDepth: boolean | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current) {
      continue;
    }

    switch (current) {
      case '--db':
      case '--database': {
        databasePath = resolve(parseRequiredValue(argv, index, current));
        index += 1;
        break;
      }
      case '--user': {
        userId = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--remote-url': {
        remoteUrl = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--theme': {
        theme = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--variant': {
        variant = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--size': {
        size = parseNumberValue(parseRequiredValue(argv, index, current), current);
        index += 1;
        break;
      }
      case '--custom-depth': {
        customDepth = parseNumberValue(parseRequiredValue(argv, index, current), current);
        hasCustomDepth = true;
        index += 1;
        break;
      }
      case '--clear-custom-depth': {
        customDepth = null;
        hasCustomDepth = true;
        break;
      }
      case '--use-custom-depth': {
        useCustomDepth = parseBoolean(parseRequiredValue(argv, index, current), current);
        index += 1;
        break;
      }
      default: {
        if (current.startsWith('--')) {
          throw new Error(`Unknown option: ${current}`);
        }
      }
    }
  }

  return {
    command,
    databasePath,
    userId,
    remoteUrl,
    theme,
    variant,
    size,
    customDepth,
    hasCustomDepth,
    useCustomDepth,
  };
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

const buildPreferencePatch = (args: ParsedArgs): HexagonPreferencesPatch => {
  const patch: HexagonPreferencesPatch = {};

  if (args.theme !== undefined) {
    patch.hexagonTheme = args.theme;
  }

  if (args.variant !== undefined) {
    patch.hexagonVariant = args.variant;
  }

  if (args.size !== undefined) {
    patch.hexagonSize = args.size;
  }

  if (args.hasCustomDepth) {
    patch.hexagonCustomDepth = args.customDepth;
  }

  if (args.useCustomDepth !== undefined) {
    patch.hexagonUseCustomDepth = args.useCustomDepth;
  }

  return patch;
};

const runPreferencesGet = async (databasePath: string, userId: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const preferences = await getOrCreatePreferences(database, userId);
    console.log(JSON.stringify(preferences, null, 2));
  } finally {
    await database.close();
  }
};

const runPreferencesSet = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  const patch = buildPreferencePatch(args);

  if (Object.keys(patch).length === 0) {
    throw new Error('No preference updates provided. Pass one or more preference flags.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const preferences = await setPreferences(database, {
      userId: args.userId,
      patch,
      recordOutbox: true,
    });

    console.log(JSON.stringify(preferences, null, 2));
  } finally {
    await database.close();
  }
};

const runPreferencesSync = async (databasePath: string, userId: string, remoteUrl: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);

    const remote = createPreferencesHttpClient({ baseUrl: remoteUrl });
    const result = await syncPreferences({ database, userId, remote });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.close();
  }
};

const printHelp = (): void => {
  console.log('Bookmarks CLI');
  console.log('');
  console.log('Commands:');
  console.log('  db:init               Initialize SQLite schema');
  console.log('  db:reset              Recreate local SQLite file and schema');
  console.log('  db:inspect            Print table row counts');
  console.log('  preferences:get       Get current user preferences');
  console.log('  preferences:set       Update user preferences');
  console.log('  preferences:sync      Push/pull preference sync with backend');
  console.log('');
  console.log('Options:');
  console.log('  --db <path>                 Custom SQLite database path');
  console.log(`  --user <id>                 User ID (default: ${defaultUserId})`);
  console.log(`  --remote-url <url>          Backend URL (default: ${defaultRemoteUrl})`);
  console.log('  --theme <name>              Hexagon theme');
  console.log('  --variant <name>            Hexagon variant');
  console.log('  --size <number>             Hexagon size');
  console.log('  --custom-depth <number>     Hexagon custom depth');
  console.log('  --clear-custom-depth        Set custom depth to null');
  console.log('  --use-custom-depth <bool>   true | false');
};

const run = async (): Promise<void> => {
  const parsed = parseArguments(process.argv.slice(2));

  switch (parsed.command) {
    case 'db:init':
      await runDbInit(parsed.databasePath);
      return;
    case 'db:reset':
      await runDbReset(parsed.databasePath);
      return;
    case 'db:inspect':
      await runDbInspect(parsed.databasePath);
      return;
    case 'preferences:get':
      await runPreferencesGet(parsed.databasePath, parsed.userId);
      return;
    case 'preferences:set':
      await runPreferencesSet(parsed.databasePath, parsed);
      return;
    case 'preferences:sync':
      await runPreferencesSync(parsed.databasePath, parsed.userId, parsed.remoteUrl);
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
