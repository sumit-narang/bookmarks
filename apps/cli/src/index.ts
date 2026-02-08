/**
 * Bookmarks CLI foundation commands.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
import {
  createPlacesHttpClient,
  listPlaces,
  pullPlaceUpdates,
  pushPlaceOutbox,
  removePlace,
  upsertPlace,
  type PlaceInput,
} from '../../../places/src';
import {
  addPlaceToCollection,
  createCollectionsHttpClient,
  createCollection,
  getCollection,
  listCollectionPlaces,
  listCollections,
  pullCollectionUpdates,
  pushCollectionOutbox,
  removeCollection,
  removePlaceFromCollection,
  updateCollection,
} from '../../../collections/src';
import {
  createPreferencesHttpClient,
  getOrCreatePreferences,
  pullPreferenceUpdates,
  pushPreferenceOutbox,
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
  placeName: string | undefined;
  placeAddress: string | undefined;
  placeLat: number | undefined;
  placeLng: number | undefined;
  placeGooglePlaceId: string | undefined;
  placeRating: number | undefined;
  placeNotes: string | undefined;
  placeImageUrl: string | undefined;
  placeId: string | undefined;
  collectionId: string | undefined;
  collectionName: string | undefined;
  collectionCoverImage: string | undefined;
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
  let placeName: string | undefined;
  let placeAddress: string | undefined;
  let placeLat: number | undefined;
  let placeLng: number | undefined;
  let placeGooglePlaceId: string | undefined;
  let placeRating: number | undefined;
  let placeNotes: string | undefined;
  let placeImageUrl: string | undefined;
  let placeId: string | undefined;
  let collectionId: string | undefined;
  let collectionName: string | undefined;
  let collectionCoverImage: string | undefined;

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
      case '--name': {
        placeName = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--address': {
        placeAddress = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--lat': {
        placeLat = parseNumberValue(parseRequiredValue(argv, index, current), current);
        index += 1;
        break;
      }
      case '--lng': {
        placeLng = parseNumberValue(parseRequiredValue(argv, index, current), current);
        index += 1;
        break;
      }
      case '--google-place-id': {
        placeGooglePlaceId = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--rating': {
        placeRating = parseNumberValue(parseRequiredValue(argv, index, current), current);
        index += 1;
        break;
      }
      case '--notes': {
        placeNotes = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--image-url': {
        placeImageUrl = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--place-id': {
        placeId = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--collection-id': {
        collectionId = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--collection-name': {
        collectionName = parseRequiredValue(argv, index, current);
        index += 1;
        break;
      }
      case '--cover-image': {
        collectionCoverImage = parseRequiredValue(argv, index, current);
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
    placeName,
    placeAddress,
    placeLat,
    placeLng,
    placeGooglePlaceId,
    placeRating,
    placeNotes,
    placeImageUrl,
    placeId,
    collectionId,
    collectionName,
    collectionCoverImage,
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

const runSyncPushInternal = async (
  database: ReturnType<typeof createNodeSqliteAdapter>,
  userId: string,
  remoteUrl: string
): Promise<{
  preferences: Awaited<ReturnType<typeof pushPreferenceOutbox>>;
  places: Awaited<ReturnType<typeof pushPlaceOutbox>>;
  collections: Awaited<ReturnType<typeof pushCollectionOutbox>>;
}> => {
  const preferencesRemote = createPreferencesHttpClient({ baseUrl: remoteUrl });
  const placesRemote = createPlacesHttpClient({ baseUrl: remoteUrl });
  const collectionsRemote = createCollectionsHttpClient({ baseUrl: remoteUrl });

  const preferences = await pushPreferenceOutbox({
    database,
    userId,
    remote: preferencesRemote,
  });

  const places = await pushPlaceOutbox({
    database,
    userId,
    remote: placesRemote,
  });

  const collections = await pushCollectionOutbox({
    database,
    userId,
    remote: collectionsRemote,
  });

  return {
    preferences,
    places,
    collections,
  };
};

const runSyncPullInternal = async (
  database: ReturnType<typeof createNodeSqliteAdapter>,
  userId: string,
  remoteUrl: string
): Promise<{
  preferences: Awaited<ReturnType<typeof pullPreferenceUpdates>>;
  places: Awaited<ReturnType<typeof pullPlaceUpdates>>;
  collections: Awaited<ReturnType<typeof pullCollectionUpdates>>;
}> => {
  const preferencesRemote = createPreferencesHttpClient({ baseUrl: remoteUrl });
  const placesRemote = createPlacesHttpClient({ baseUrl: remoteUrl });
  const collectionsRemote = createCollectionsHttpClient({ baseUrl: remoteUrl });

  const preferences = await pullPreferenceUpdates({
    database,
    userId,
    remote: preferencesRemote,
  });

  const places = await pullPlaceUpdates({
    database,
    userId,
    remote: placesRemote,
  });

  const collections = await pullCollectionUpdates({
    database,
    userId,
    remote: collectionsRemote,
  });

  return {
    preferences,
    places,
    collections,
  };
};

const runSyncPush = async (databasePath: string, userId: string, remoteUrl: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const result = await runSyncPushInternal(database, userId, remoteUrl);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.close();
  }
};

const runSyncPull = async (databasePath: string, userId: string, remoteUrl: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const result = await runSyncPullInternal(database, userId, remoteUrl);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.close();
  }
};

const runSyncRun = async (databasePath: string, userId: string, remoteUrl: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const push = await runSyncPushInternal(database, userId, remoteUrl);
    const pull = await runSyncPullInternal(database, userId, remoteUrl);
    console.log(JSON.stringify({ push, pull }, null, 2));
  } finally {
    await database.close();
  }
};

const buildPlaceInput = (args: ParsedArgs): PlaceInput => {
  if (args.placeName === undefined) {
    throw new Error('Place --name is required.');
  }

  if (args.placeLat === undefined) {
    throw new Error('Place --lat is required.');
  }

  if (args.placeLng === undefined) {
    throw new Error('Place --lng is required.');
  }

  return {
    name: args.placeName,
    address: args.placeAddress ?? null,
    latitude: args.placeLat,
    longitude: args.placeLng,
    googlePlaceId: args.placeGooglePlaceId ?? null,
    rating: args.placeRating ?? null,
    notes: args.placeNotes ?? null,
    imageUrl: args.placeImageUrl ?? null,
    metadataJson: null,
  };
};

const runPlacesList = async (databasePath: string, userId: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const places = await listPlaces(database, userId);
    console.log(JSON.stringify(places, null, 2));
  } finally {
    await database.close();
  }
};

const runPlacesUpsertGoogle = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  const input = buildPlaceInput(args);
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const place = await upsertPlace(database, { userId: args.userId, input });
    console.log(JSON.stringify(place, null, 2));
  } finally {
    await database.close();
  }
};

const runPlacesRemove = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.placeId) {
    throw new Error('--place-id is required for places:remove.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const removed = await removePlace(database, args.userId, args.placeId);

    if (!removed) {
      console.error('Place not found or already removed.');
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({ removed: true, placeId: args.placeId }));
  } finally {
    await database.close();
  }
};

const runCollectionsCreate = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionName) {
    throw new Error('--collection-name is required for collections:create.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const collection = await createCollection(database, {
      userId: args.userId,
      input: { name: args.collectionName, coverImage: args.collectionCoverImage ?? null },
    });
    console.log(JSON.stringify(collection, null, 2));
  } finally {
    await database.close();
  }
};

const runCollectionsList = async (databasePath: string, userId: string): Promise<void> => {
  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const collections = await listCollections(database, userId);
    console.log(JSON.stringify(collections, null, 2));
  } finally {
    await database.close();
  }
};

const runCollectionsGet = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionId) {
    throw new Error('--collection-id is required for collections:get.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const collection = await getCollection(database, args.userId, args.collectionId);

    if (!collection) {
      console.error('Collection not found.');
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(collection, null, 2));
  } finally {
    await database.close();
  }
};

const runCollectionsUpdate = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionId) {
    throw new Error('--collection-id is required for collections:update.');
  }

  if (!args.collectionName) {
    throw new Error('--collection-name is required for collections:update.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const collection = await updateCollection(database, {
      userId: args.userId,
      collectionId: args.collectionId,
      input: { name: args.collectionName, coverImage: args.collectionCoverImage ?? null },
    });
    console.log(JSON.stringify(collection, null, 2));
  } finally {
    await database.close();
  }
};

const runCollectionsRemove = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionId) {
    throw new Error('--collection-id is required for collections:remove.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const removed = await removeCollection(database, args.userId, args.collectionId);

    if (!removed) {
      console.error('Collection not found or already removed.');
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({ removed: true, collectionId: args.collectionId }));
  } finally {
    await database.close();
  }
};

const runCollectionsAddPlace = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionId) {
    throw new Error('--collection-id is required for collections:add-place.');
  }

  if (!args.placeId) {
    throw new Error('--place-id is required for collections:add-place.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const added = await addPlaceToCollection(database, {
      userId: args.userId,
      collectionId: args.collectionId,
      placeId: args.placeId,
    });
    console.log(JSON.stringify({ added, collectionId: args.collectionId, placeId: args.placeId }));
  } finally {
    await database.close();
  }
};

const runCollectionsRemovePlace = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionId) {
    throw new Error('--collection-id is required for collections:remove-place.');
  }

  if (!args.placeId) {
    throw new Error('--place-id is required for collections:remove-place.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const removed = await removePlaceFromCollection(database, {
      userId: args.userId,
      collectionId: args.collectionId,
      placeId: args.placeId,
    });
    console.log(JSON.stringify({ removed, collectionId: args.collectionId, placeId: args.placeId }));
  } finally {
    await database.close();
  }
};

const runCollectionsListPlaces = async (databasePath: string, args: ParsedArgs): Promise<void> => {
  if (!args.collectionId) {
    throw new Error('--collection-id is required for collections:list-places.');
  }

  ensureParentDirectory(databasePath);
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    const places = await listCollectionPlaces(database, {
      userId: args.userId,
      collectionId: args.collectionId,
    });
    console.log(JSON.stringify(places, null, 2));
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
  console.log('  sync:push             Push preferences + places + collections outbox');
  console.log('  sync:pull             Pull preferences + places + collections state');
  console.log('  sync:run              Run sync:push then sync:pull');
  console.log('  places:list               List places for a user');
  console.log('  places:upsert-google      Upsert a place (dedup by google place ID)');
  console.log('  places:remove             Soft-delete a place');
  console.log('  collections:create        Create a new collection');
  console.log('  collections:list          List collections for a user');
  console.log('  collections:get           Get a single collection');
  console.log('  collections:update        Update a collection');
  console.log('  collections:remove        Soft-delete a collection');
  console.log('  collections:add-place     Add a place to a collection');
  console.log('  collections:remove-place  Remove a place from a collection');
  console.log('  collections:list-places   List places in a collection');
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
  console.log('  --name <string>             Place name');
  console.log('  --address <string>          Place address');
  console.log('  --lat <number>              Latitude');
  console.log('  --lng <number>              Longitude');
  console.log('  --google-place-id <string>  Google Place ID');
  console.log('  --rating <number>           Place rating');
  console.log('  --notes <string>            Place notes');
  console.log('  --image-url <string>        Place image URL');
  console.log('  --place-id <id>             Place ID (for removal or membership)');
  console.log('  --collection-id <id>        Collection ID');
  console.log('  --collection-name <string>  Collection name');
  console.log('  --cover-image <string>      Collection cover image URL');
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
    case 'sync:push':
      await runSyncPush(parsed.databasePath, parsed.userId, parsed.remoteUrl);
      return;
    case 'sync:pull':
      await runSyncPull(parsed.databasePath, parsed.userId, parsed.remoteUrl);
      return;
    case 'sync:run':
      await runSyncRun(parsed.databasePath, parsed.userId, parsed.remoteUrl);
      return;
    case 'places:list':
      await runPlacesList(parsed.databasePath, parsed.userId);
      return;
    case 'places:upsert-google':
      await runPlacesUpsertGoogle(parsed.databasePath, parsed);
      return;
    case 'places:remove':
      await runPlacesRemove(parsed.databasePath, parsed);
      return;
    case 'collections:create':
      await runCollectionsCreate(parsed.databasePath, parsed);
      return;
    case 'collections:list':
      await runCollectionsList(parsed.databasePath, parsed.userId);
      return;
    case 'collections:get':
      await runCollectionsGet(parsed.databasePath, parsed);
      return;
    case 'collections:update':
      await runCollectionsUpdate(parsed.databasePath, parsed);
      return;
    case 'collections:remove':
      await runCollectionsRemove(parsed.databasePath, parsed);
      return;
    case 'collections:add-place':
      await runCollectionsAddPlace(parsed.databasePath, parsed);
      return;
    case 'collections:remove-place':
      await runCollectionsRemovePlace(parsed.databasePath, parsed);
      return;
    case 'collections:list-places':
      await runCollectionsListPlaces(parsed.databasePath, parsed);
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
