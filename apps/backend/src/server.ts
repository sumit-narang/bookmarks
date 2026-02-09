/**
 * Backend server for persistence foundation routes.
 */

import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../../../core/src';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
import {
  addPlaceToCollection,
  applyCollectionSyncOperation,
  createCollection,
  getCollection,
  listCollectionPlaces,
  listCollections,
  parseCollectionInput,
  removeCollection,
  removePlaceFromCollection,
  updateCollection,
  type CollectionInput,
  type CollectionSyncOperation,
  type CollectionSyncOperationType,
} from '../../../collections/src';
import {
  applyPlaceSyncOperation,
  getPlace,
  listPlaces,
  parsePlaceInput,
  removePlace,
  upsertPlace,
  type PlaceInput,
  type PlaceSyncOperation,
} from '../../../places/src';
import {
  applyPreferenceSyncOperation,
  getOrCreatePreferences,
  getPreferenceSyncState,
  setPreferences,
  type HexagonPreferencesValues,
  type HexagonPreferencesPatch,
  type PreferenceSyncOperation,
} from '../../../preferences/src';
import { schemaMigrations } from '../../../schema/src';

export interface BackendServerOptions {
  host: string;
  port: number;
  databasePath: string;
}

export interface BackendServer {
  /** Start listening. Returns the actual bound port (useful when port 0 is requested). */
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
}

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
};

const readJsonBody = async <TPayload>(request: IncomingMessage): Promise<TPayload> => {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {} as TPayload;
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw) {
    return {} as TPayload;
  }

  return JSON.parse(raw) as TPayload;
};

const parsePreferencePatch = (value: unknown): HexagonPreferencesPatch => {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object') {
    throw new Error('Preference patch must be an object.');
  }

  const input = value as Record<string, unknown>;
  const patch: HexagonPreferencesPatch = {};

  if ('hexagonTheme' in input) {
    if (typeof input.hexagonTheme !== 'string') {
      throw new Error('hexagonTheme must be a string.');
    }

    patch.hexagonTheme = input.hexagonTheme;
  }

  if ('hexagonVariant' in input) {
    if (typeof input.hexagonVariant !== 'string') {
      throw new Error('hexagonVariant must be a string.');
    }

    patch.hexagonVariant = input.hexagonVariant;
  }

  if ('hexagonSize' in input) {
    if (typeof input.hexagonSize !== 'number') {
      throw new Error('hexagonSize must be a number.');
    }

    patch.hexagonSize = input.hexagonSize;
  }

  if ('hexagonCustomDepth' in input) {
    if (typeof input.hexagonCustomDepth !== 'number' && input.hexagonCustomDepth !== null) {
      throw new Error('hexagonCustomDepth must be a number or null.');
    }

    patch.hexagonCustomDepth = input.hexagonCustomDepth;
  }

  if ('hexagonUseCustomDepth' in input) {
    if (typeof input.hexagonUseCustomDepth !== 'boolean') {
      throw new Error('hexagonUseCustomDepth must be a boolean.');
    }

    patch.hexagonUseCustomDepth = input.hexagonUseCustomDepth;
  }

  return patch;
};

const parsePreferenceValues = (value: unknown): HexagonPreferencesValues => {
  const patch = parsePreferencePatch(value);

  if (
    patch.hexagonTheme === undefined
    || patch.hexagonVariant === undefined
    || patch.hexagonSize === undefined
    || patch.hexagonCustomDepth === undefined
    || patch.hexagonUseCustomDepth === undefined
  ) {
    throw new Error('Sync operation preferences must include all preference fields.');
  }

  return {
    hexagonTheme: patch.hexagonTheme,
    hexagonVariant: patch.hexagonVariant,
    hexagonSize: patch.hexagonSize,
    hexagonCustomDepth: patch.hexagonCustomDepth,
    hexagonUseCustomDepth: patch.hexagonUseCustomDepth,
  };
};

const compareOperationVersion = (
  left: { updatedAt: string; operationId: string },
  right: { updatedAt: string; operationId: string }
): number => {
  if (left.updatedAt > right.updatedAt) {
    return 1;
  }

  if (left.updatedAt < right.updatedAt) {
    return -1;
  }

  if (left.operationId > right.operationId) {
    return 1;
  }

  if (left.operationId < right.operationId) {
    return -1;
  }

  return 0;
};

const parsePreferenceSyncOperation = (value: unknown): PreferenceSyncOperation => {
  if (!value || typeof value !== 'object') {
    throw new Error('Sync operation must be an object.');
  }

  const input = value as Record<string, unknown>;

  if (typeof input.userId !== 'string') {
    throw new Error('Sync operation is missing userId.');
  }

  if (typeof input.operationId !== 'string') {
    throw new Error('Sync operation is missing operationId.');
  }

  if (typeof input.updatedAt !== 'string') {
    throw new Error('Sync operation is missing updatedAt.');
  }

  return {
    userId: input.userId,
    operationId: input.operationId,
    updatedAt: input.updatedAt,
    preferences: parsePreferenceValues(input.preferences),
  };
};

interface GenericSyncOperationInput {
  entityId: string;
  operationId: string;
  operationType: string;
  updatedAt: string;
  payload: Record<string, unknown>;
}

const parseGenericSyncOperationInput = (value: unknown): GenericSyncOperationInput => {
  if (!value || typeof value !== 'object') {
    throw new Error('Sync operation must be an object.');
  }

  const input = value as Record<string, unknown>;

  if (typeof input.entityId !== 'string') {
    throw new Error('Sync operation is missing entityId.');
  }

  if (typeof input.operationId !== 'string') {
    throw new Error('Sync operation is missing operationId.');
  }

  if (typeof input.operationType !== 'string') {
    throw new Error('Sync operation is missing operationType.');
  }

  if (typeof input.updatedAt !== 'string') {
    throw new Error('Sync operation is missing updatedAt.');
  }

  if (!input.payload || typeof input.payload !== 'object') {
    throw new Error('Sync operation is missing payload object.');
  }

  return {
    entityId: input.entityId,
    operationId: input.operationId,
    operationType: input.operationType,
    updatedAt: input.updatedAt,
    payload: input.payload as Record<string, unknown>,
  };
};

const parsePlaceSyncOperation = (value: unknown, userId: string): PlaceSyncOperation => {
  const operation = parseGenericSyncOperationInput(value);
  const payloadUserId = typeof operation.payload.userId === 'string' ? operation.payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error('Place sync operation userId does not match payload userId.');
  }

  const placeId = typeof operation.payload.placeId === 'string' ? operation.payload.placeId : operation.entityId;

  if (operation.operationType !== 'upsert' && operation.operationType !== 'delete') {
    throw new Error(`Unsupported place sync operation type: ${operation.operationType}.`);
  }

  if (operation.operationType === 'upsert') {
    const placeInput = parsePlaceInput(operation.payload.place);

    return {
      userId,
      placeId,
      operationId: operation.operationId,
      operationType: 'upsert',
      updatedAt: operation.updatedAt,
      place: placeInput,
    };
  }

  return {
    userId,
    placeId,
    operationId: operation.operationId,
    operationType: 'delete',
    updatedAt: operation.updatedAt,
    place: null,
  };
};

const parseCollectionSyncOperation = (value: unknown, userId: string): CollectionSyncOperation => {
  const operation = parseGenericSyncOperationInput(value);
  const payloadUserId = typeof operation.payload.userId === 'string' ? operation.payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error('Collection sync operation userId does not match payload userId.');
  }

  const collectionId = typeof operation.payload.collectionId === 'string'
    ? operation.payload.collectionId
    : operation.entityId;

  if (
    operation.operationType !== 'create'
    && operation.operationType !== 'update'
    && operation.operationType !== 'delete'
    && operation.operationType !== 'add-place'
    && operation.operationType !== 'remove-place'
    && operation.operationType !== 'upsert'
  ) {
    throw new Error(`Unsupported collection sync operation type: ${operation.operationType}.`);
  }

  const placeId = typeof operation.payload.placeId === 'string' ? operation.payload.placeId : null;

  let collectionInput: CollectionInput | null = null;

  if (operation.payload.collection !== null && operation.payload.collection !== undefined) {
    collectionInput = parseCollectionInput(operation.payload.collection);
  }

  let placeIds: string[] | undefined;

  if (operation.payload.placeIds !== undefined) {
    if (!Array.isArray(operation.payload.placeIds)) {
      throw new Error('Collection sync operation placeIds must be an array when provided.');
    }

    placeIds = operation.payload.placeIds.map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error('Collection sync operation placeIds entries must be strings.');
      }

      return entry;
    });
  }

  return {
    userId,
    collectionId,
    operationId: operation.operationId,
    operationType: operation.operationType,
    updatedAt: operation.updatedAt,
    collection: collectionInput,
    placeId,
    placeIds,
  };
};

const extractPreferenceUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/preferences$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];

  if (!encodedUserId) {
    return null;
  }

  return decodeURIComponent(encodedUserId);
};

const handlePreferenceGet = async (response: ServerResponse, userId: string, databasePath: string): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const preferences = await getOrCreatePreferences(adapter, userId);
    writeJson(response, 200, { preferences });
  } finally {
    await adapter.close();
  }
};

const handlePreferencePut = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<{ patch?: unknown; updatedAt?: unknown; operationId?: unknown }>(request);
  const patch = parsePreferencePatch(payload.patch ?? payload);

  if (Object.keys(patch).length === 0) {
    throw new Error('Preference patch cannot be empty.');
  }

  if (payload.updatedAt !== undefined && typeof payload.updatedAt !== 'string') {
    throw new Error('updatedAt must be a string when provided.');
  }

  if (payload.operationId !== undefined && payload.operationId !== null && typeof payload.operationId !== 'string') {
    throw new Error('operationId must be a string or null when provided.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const preferences = await setPreferences(adapter, {
      userId,
      patch,
      updatedAt: payload.updatedAt,
      operationId: (payload.operationId as string | null | undefined) ?? null,
      recordOutbox: false,
    });

    writeJson(response, 200, { preferences });
  } finally {
    await adapter.close();
  }
};

const handleSyncPush = async (request: IncomingMessage, response: ServerResponse, databasePath: string): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (typeof payload.userId !== 'string') {
    throw new Error('Push payload must include userId.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parsePreferenceSyncOperation(operation));

  for (const operation of operations) {
    if (operation.userId !== payload.userId) {
      throw new Error('All operation userId values must match payload userId.');
    }
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const appliedOperationIds: string[] = [];
    let latestOperationId: string | null = null;
    let latestUpdatedAt: string | null = null;

    for (const operation of operations) {
      const result = await applyPreferenceSyncOperation(adapter, operation);

      if (result.applied) {
        appliedOperationIds.push(operation.operationId);
      }

      if (
        latestUpdatedAt === null
        || operation.updatedAt > latestUpdatedAt
        || (operation.updatedAt === latestUpdatedAt && (latestOperationId === null || operation.operationId > latestOperationId))
      ) {
        latestUpdatedAt = operation.updatedAt;
        latestOperationId = operation.operationId;
      }
    }

    writeJson(response, 200, {
      appliedOperationIds,
      latestOperationId,
      serverTimestamp: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const handleSyncPull = async (url: URL, response: ServerResponse, databasePath: string): Promise<void> => {
  const userId = url.searchParams.get('userId');

  if (!userId) {
    throw new Error('Pull query requires userId.');
  }

  const cursor = url.searchParams.get('cursor');
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const preferences = await getOrCreatePreferences(adapter, userId);
    const syncState = await getPreferenceSyncState(adapter, userId);

    const shouldReturnPreference = cursor === null || preferences.updatedAt > cursor;

    writeJson(response, 200, {
      preference: shouldReturnPreference ? preferences : null,
      cursor: shouldReturnPreference ? preferences.updatedAt : cursor,
      lastSyncedOperationId: syncState?.lastSyncedOperationId ?? null,
    });
  } finally {
    await adapter.close();
  }
};

interface PlaceSyncSnapshotRow {
  id: string;
  user_id: string;
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  notes: string | null;
  image_url: string | null;
  metadata_json: string | null;
  updated_at: string;
  deleted_at: string | null;
}

const handlePlaceSyncPush = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (typeof payload.userId !== 'string') {
    throw new Error('Push payload must include userId.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parsePlaceSyncOperation(operation, payload.userId as string));
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const appliedOperationIds: string[] = [];
    let latestVersion: { updatedAt: string; operationId: string } | null = null;

    for (const operation of operations) {
      const result = await applyPlaceSyncOperation(adapter, operation);

      if (result.applied) {
        appliedOperationIds.push(operation.operationId);
      }

      if (
        latestVersion === null
        || compareOperationVersion(
          {
            updatedAt: operation.updatedAt,
            operationId: operation.operationId,
          },
          latestVersion
        ) > 0
      ) {
        latestVersion = {
          updatedAt: operation.updatedAt,
          operationId: operation.operationId,
        };
      }
    }

    writeJson(response, 200, {
      appliedOperationIds,
      latestOperationId: latestVersion?.operationId ?? null,
      serverTimestamp: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const handlePlaceSyncPull = async (url: URL, response: ServerResponse, databasePath: string): Promise<void> => {
  const userId = url.searchParams.get('userId');

  if (!userId) {
    throw new Error('Pull query requires userId.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const rows = await adapter.all<PlaceSyncSnapshotRow>(
      `SELECT
         id,
         user_id,
         google_place_id,
         name,
         address,
         latitude,
         longitude,
         rating,
         notes,
         image_url,
         metadata_json,
         updated_at,
         deleted_at
       FROM places
       WHERE user_id = ?
       ORDER BY updated_at ASC, id ASC;`,
      [userId]
    );

    const entities = rows.map((row) => {
      const operationType = row.deleted_at ? 'delete' : 'upsert';

      return {
        entityId: row.id,
        updatedAt: row.updated_at,
        operationId: `${row.updated_at}:${row.id}`,
        data: {
          userId: row.user_id,
          placeId: row.id,
          operationType,
          updatedAt: row.updated_at,
          place: operationType === 'upsert'
            ? {
              name: row.name,
              address: row.address,
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              googlePlaceId: row.google_place_id,
              rating: row.rating === null ? null : Number(row.rating),
              notes: row.notes,
              imageUrl: row.image_url,
              metadataJson: row.metadata_json,
            }
            : null,
        },
      };
    });

    writeJson(response, 200, {
      entities,
      cursor: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

interface CollectionSyncSnapshotRow {
  id: string;
  user_id: string;
  name: string;
  cover_image: string | null;
  updated_at: string;
  deleted_at: string | null;
}

interface CollectionSyncPlaceRow {
  place_id: string;
}

const handleCollectionSyncPush = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (typeof payload.userId !== 'string') {
    throw new Error('Push payload must include userId.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parseCollectionSyncOperation(operation, payload.userId as string));
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const appliedOperationIds: string[] = [];
    let latestVersion: { updatedAt: string; operationId: string } | null = null;

    for (const operation of operations) {
      const result = await applyCollectionSyncOperation(adapter, operation);

      if (result.applied) {
        appliedOperationIds.push(operation.operationId);
      }

      if (
        latestVersion === null
        || compareOperationVersion(
          {
            updatedAt: operation.updatedAt,
            operationId: operation.operationId,
          },
          latestVersion
        ) > 0
      ) {
        latestVersion = {
          updatedAt: operation.updatedAt,
          operationId: operation.operationId,
        };
      }
    }

    writeJson(response, 200, {
      appliedOperationIds,
      latestOperationId: latestVersion?.operationId ?? null,
      serverTimestamp: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const handleCollectionSyncPull = async (url: URL, response: ServerResponse, databasePath: string): Promise<void> => {
  const userId = url.searchParams.get('userId');

  if (!userId) {
    throw new Error('Pull query requires userId.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const rows = await adapter.all<CollectionSyncSnapshotRow>(
      `SELECT id, user_id, name, cover_image, updated_at, deleted_at
       FROM collections
       WHERE user_id = ?
       ORDER BY updated_at ASC, id ASC;`,
      [userId]
    );

    const entities: Array<{
      entityId: string;
      updatedAt: string;
      operationId: string;
      data: {
        userId: string;
        collectionId: string;
        operationType: CollectionSyncOperationType;
        updatedAt: string;
        collection: CollectionInput | null;
        placeId: string | null;
        placeIds?: string[];
      };
    }> = [];

    for (const row of rows) {
      if (row.deleted_at) {
        entities.push({
          entityId: row.id,
          updatedAt: row.updated_at,
          operationId: `${row.updated_at}:${row.id}`,
          data: {
            userId: row.user_id,
            collectionId: row.id,
            operationType: 'delete',
            updatedAt: row.updated_at,
            collection: null,
            placeId: null,
          },
        });

        continue;
      }

      const placeRows = await adapter.all<CollectionSyncPlaceRow>(
        `SELECT cp.place_id
         FROM collection_places cp
         INNER JOIN places p ON p.id = cp.place_id
         WHERE cp.collection_id = ?
           AND cp.deleted_at IS NULL
           AND p.user_id = ?
           AND p.deleted_at IS NULL
         ORDER BY cp.position ASC;`,
        [row.id, row.user_id]
      );

      entities.push({
        entityId: row.id,
        updatedAt: row.updated_at,
        operationId: `${row.updated_at}:${row.id}`,
        data: {
          userId: row.user_id,
          collectionId: row.id,
          operationType: 'upsert',
          updatedAt: row.updated_at,
          collection: {
            name: row.name,
            coverImage: row.cover_image,
          },
          placeId: null,
          placeIds: placeRows.map((placeRow) => placeRow.place_id),
        },
      });
    }

    writeJson(response, 200, {
      entities,
      cursor: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const extractPlaceListUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/places$/);

  if (!match) {
    return null;
  }

  const encoded = match[1];

  if (!encoded) {
    return null;
  }

  return decodeURIComponent(encoded);
};

const extractPlaceIds = (pathname: string): { userId: string; placeId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/places\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedPlaceId = match[2];

  if (!encodedUserId || !encodedPlaceId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    placeId: decodeURIComponent(encodedPlaceId),
  };
};

const extractUpsertGoogleUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/places\/upsert-google$/);

  if (!match) {
    return null;
  }

  const encoded = match[1];

  if (!encoded) {
    return null;
  }

  return decodeURIComponent(encoded);
};

const handlePlaceList = async (
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const places = await listPlaces(adapter, userId);
    writeJson(response, 200, { places });
  } finally {
    await adapter.close();
  }
};

const handlePlaceGet = async (
  response: ServerResponse,
  userId: string,
  placeId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const place = await getPlace(adapter, userId, placeId);

    if (!place) {
      writeJson(response, 404, { error: 'Place not found.' });
      return;
    }

    writeJson(response, 200, { place });
  } finally {
    await adapter.close();
  }
};

const handlePlaceUpsertGoogle = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<Record<string, unknown>>(request);
  const input = parsePlaceInput(payload);

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const place = await upsertPlace(adapter, { userId, input });
    writeJson(response, 200, { place });
  } finally {
    await adapter.close();
  }
};

const handlePlaceDelete = async (
  response: ServerResponse,
  userId: string,
  placeId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const removed = await removePlace(adapter, userId, placeId);

    if (!removed) {
      writeJson(response, 404, { error: 'Place not found.' });
      return;
    }

    writeJson(response, 200, { removed: true });
  } finally {
    await adapter.close();
  }
};

// --- Collection URL extractors ---

const extractCollectionListUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections$/);

  if (!match) {
    return null;
  }

  const encoded = match[1];

  if (!encoded) {
    return null;
  }

  return decodeURIComponent(encoded);
};

const extractCollectionIds = (pathname: string): { userId: string; collectionId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedCollectionId = match[2];

  if (!encodedUserId || !encodedCollectionId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    collectionId: decodeURIComponent(encodedCollectionId),
  };
};

const extractCollectionPlacesPath = (pathname: string): { userId: string; collectionId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections\/([^/]+)\/places$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedCollectionId = match[2];

  if (!encodedUserId || !encodedCollectionId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    collectionId: decodeURIComponent(encodedCollectionId),
  };
};

const extractCollectionPlaceIds = (pathname: string): { userId: string; collectionId: string; placeId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections\/([^/]+)\/places\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedCollectionId = match[2];
  const encodedPlaceId = match[3];

  if (!encodedUserId || !encodedCollectionId || !encodedPlaceId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    collectionId: decodeURIComponent(encodedCollectionId),
    placeId: decodeURIComponent(encodedPlaceId),
  };
};

// --- Collection handlers ---

const handleCollectionCreate = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<Record<string, unknown>>(request);
  const input = parseCollectionInput(payload);

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collection = await createCollection(adapter, { userId, input });
    writeJson(response, 201, { collection });
  } finally {
    await adapter.close();
  }
};

const handleCollectionList = async (
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collections = await listCollections(adapter, userId);
    writeJson(response, 200, { collections });
  } finally {
    await adapter.close();
  }
};

const handleCollectionGet = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collection = await getCollection(adapter, userId, collectionId);

    if (!collection) {
      writeJson(response, 404, { error: 'Collection not found.' });
      return;
    }

    writeJson(response, 200, { collection });
  } finally {
    await adapter.close();
  }
};

const handleCollectionUpdate = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<Record<string, unknown>>(request);
  const input = parseCollectionInput(payload);

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collection = await updateCollection(adapter, { userId, collectionId, input });
    writeJson(response, 200, { collection });
  } finally {
    await adapter.close();
  }
};

const handleCollectionDelete = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const removed = await removeCollection(adapter, userId, collectionId);

    if (!removed) {
      writeJson(response, 404, { error: 'Collection not found.' });
      return;
    }

    writeJson(response, 200, { removed: true });
  } finally {
    await adapter.close();
  }
};

const handleCollectionAddPlace = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<{ placeId?: unknown }>(request);

  if (typeof payload.placeId !== 'string') {
    throw new Error('Request body must include placeId as a string.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const added = await addPlaceToCollection(adapter, { userId, collectionId, placeId: payload.placeId });
    writeJson(response, 200, { added, collectionId, placeId: payload.placeId });
  } finally {
    await adapter.close();
  }
};

const handleCollectionRemovePlace = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  placeId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const removed = await removePlaceFromCollection(adapter, { userId, collectionId, placeId });

    if (!removed) {
      writeJson(response, 404, { error: 'Membership not found.' });
      return;
    }

    writeJson(response, 200, { removed: true });
  } finally {
    await adapter.close();
  }
};

const handleCollectionListPlaces = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const places = await listCollectionPlaces(adapter, { userId, collectionId });
    writeJson(response, 200, { places });
  } finally {
    await adapter.close();
  }
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: BackendServerOptions
): Promise<void> => {
  if (!request.url) {
    writeJson(response, 400, { error: 'Missing request URL.' });
    return;
  }

  const url = new URL(request.url, `http://${options.host}:${options.port}`);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, {
        status: 'ok',
        service: 'bookmarks-backend',
        databasePath: options.databasePath,
        timestamp: nowIso(),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/schema/tables') {
      const adapter = createNodeSqliteAdapter({ filename: options.databasePath });

      try {
        await migrateDatabase(adapter, schemaMigrations);
        const tables = await listUserTables(adapter);
        writeJson(response, 200, { tables });
      } finally {
        await adapter.close();
      }

      return;
    }

    const preferenceUserId = extractPreferenceUserId(url.pathname);

    if (preferenceUserId && request.method === 'GET') {
      await handlePreferenceGet(response, preferenceUserId, options.databasePath);
      return;
    }

    if (preferenceUserId && request.method === 'PUT') {
      await handlePreferencePut(request, response, preferenceUserId, options.databasePath);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/preferences/push') {
      await handleSyncPush(request, response, options.databasePath);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/preferences/pull') {
      await handleSyncPull(url, response, options.databasePath);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/places/push') {
      await handlePlaceSyncPush(request, response, options.databasePath);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/places/pull') {
      await handlePlaceSyncPull(url, response, options.databasePath);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/collections/push') {
      await handleCollectionSyncPush(request, response, options.databasePath);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/collections/pull') {
      await handleCollectionSyncPull(url, response, options.databasePath);
      return;
    }

    // --- Place routes ---

    const upsertGoogleUserId = extractUpsertGoogleUserId(url.pathname);

    if (upsertGoogleUserId && request.method === 'PUT') {
      await handlePlaceUpsertGoogle(request, response, upsertGoogleUserId, options.databasePath);
      return;
    }

    const placeIds = extractPlaceIds(url.pathname);

    if (placeIds && request.method === 'GET') {
      await handlePlaceGet(response, placeIds.userId, placeIds.placeId, options.databasePath);
      return;
    }

    if (placeIds && request.method === 'DELETE') {
      await handlePlaceDelete(response, placeIds.userId, placeIds.placeId, options.databasePath);
      return;
    }

    const placeListUserId = extractPlaceListUserId(url.pathname);

    if (placeListUserId && request.method === 'GET') {
      await handlePlaceList(response, placeListUserId, options.databasePath);
      return;
    }

    // --- Collection routes ---
    // Order: most specific paths first (collection-place-ids, collection-places, collection-ids, collection-list)

    const collectionPlaceIds = extractCollectionPlaceIds(url.pathname);

    if (collectionPlaceIds && request.method === 'DELETE') {
      await handleCollectionRemovePlace(
        response,
        collectionPlaceIds.userId,
        collectionPlaceIds.collectionId,
        collectionPlaceIds.placeId,
        options.databasePath
      );
      return;
    }

    const collectionPlacesPath = extractCollectionPlacesPath(url.pathname);

    if (collectionPlacesPath && request.method === 'POST') {
      await handleCollectionAddPlace(request, response, collectionPlacesPath.userId, collectionPlacesPath.collectionId, options.databasePath);
      return;
    }

    if (collectionPlacesPath && request.method === 'GET') {
      await handleCollectionListPlaces(response, collectionPlacesPath.userId, collectionPlacesPath.collectionId, options.databasePath);
      return;
    }

    const collectionIds = extractCollectionIds(url.pathname);

    if (collectionIds && request.method === 'GET') {
      await handleCollectionGet(response, collectionIds.userId, collectionIds.collectionId, options.databasePath);
      return;
    }

    if (collectionIds && request.method === 'PUT') {
      await handleCollectionUpdate(request, response, collectionIds.userId, collectionIds.collectionId, options.databasePath);
      return;
    }

    if (collectionIds && request.method === 'DELETE') {
      await handleCollectionDelete(response, collectionIds.userId, collectionIds.collectionId, options.databasePath);
      return;
    }

    const collectionListUserId = extractCollectionListUserId(url.pathname);

    if (collectionListUserId && request.method === 'POST') {
      await handleCollectionCreate(request, response, collectionListUserId, options.databasePath);
      return;
    }

    if (collectionListUserId && request.method === 'GET') {
      await handleCollectionList(response, collectionListUserId, options.databasePath);
      return;
    }

    writeJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    writeJson(response, 400, { error: (error as Error).message });
  }
};

/**
 * Create backend server instance.
 * @param options
 * @returns {BackendServer}
 */
export const createBackendServer = async (options: BackendServerOptions): Promise<BackendServer> => {
  mkdirSync(dirname(options.databasePath), { recursive: true });

  const migrationAdapter = createNodeSqliteAdapter({ filename: options.databasePath });

  try {
    await migrateDatabase(migrationAdapter, schemaMigrations);
  } finally {
    await migrationAdapter.close();
  }

  const server = createServer((request, response) => {
    handleRequest(request, response, options).catch((error) => {
      console.error('Unhandled backend request error:', error);
      writeJson(response, 500, { error: 'Internal server error.' });
    });
  });

  return {
    /**
     * Start listening. Returns the actual bound port, which may differ
     * from options.port when port 0 is used (OS-assigned ephemeral port).
     */
    async start(): Promise<{ port: number }> {
      return new Promise((resolvePromise, rejectPromise) => {
        const onError = (error: Error) => {
          rejectPromise(error);
        };

        server.once('error', onError);

        server.listen(options.port, options.host, () => {
          server.removeListener('error', onError);
          const address = server.address();
          const boundPort = (address && typeof address === 'object') ? address.port : options.port;
          resolvePromise({ port: boundPort });
        });
      });
    },
    async stop() {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }

          resolvePromise();
        });
      });
    },
  };
};

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export const defaultBackendDatabasePath = resolve(currentDirectory, '..', '..', '..', '.bookmarks', 'backend.sqlite');
