/**
 * Collection persistence use-cases.
 *
 * Core operations: create, list, get, update, remove (soft-delete).
 * Membership operations: add place, remove place, list places.
 * Derives placeCount from collection_places membership.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { CollectionRow, PlaceRow } from '../../schema/src';
import { createOutboxEntry, listPendingMutations } from '../../sync/src';
import type { PlaceRecord } from '../../places/src';
import type {
  CollectionOutboxMutation,
  CollectionInput,
  CollectionRecord,
  CollectionSyncOperation,
  CollectionSyncOperationType,
  CreateCollectionOptions,
  UpdateCollectionOptions,
  AddPlaceToCollectionOptions,
  RemovePlaceFromCollectionOptions,
  ListCollectionPlacesOptions,
  ValidatedCollectionInput,
} from './types';
import { validateCollectionInput } from './validation';

/** Extended row returned by queries that join a place-count column. */
interface CollectionRowWithCount extends CollectionRow {
  place_count: number;
}

/** Extended place row returned by queries that join a saved-status column. */
interface PlaceRowWithSaved extends PlaceRow {
  is_saved: number;
}

interface CollectionVersionRow {
  id: string;
  user_id: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CollectionPlaceVersionRow {
  place_id: string;
  deleted_at: string | null;
  position: number;
}

interface CollectionOutboxPayload {
  userId: string;
  collectionId: string;
  operationType: CollectionSyncOperationType;
  updatedAt: string;
  collection: CollectionInput | null;
  placeId: string | null;
  placeIds?: string[];
}

const COLLECTIONS_ENTITY_TYPE = 'collections';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const ensureUserExists = async (database: DatabaseAdapter, userId: string, timestamp: string): Promise<void> => {
  await database.run(
    `INSERT INTO users (id, provider, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING;`,
    [userId, 'local', timestamp, timestamp]
  );
};

const mapRowToRecord = (row: CollectionRowWithCount): CollectionRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    coverImage: row.cover_image,
    placeCount: Number(row.place_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
};

const mapPlaceRowToRecord = (row: PlaceRowWithSaved): PlaceRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    googlePlaceId: row.google_place_id,
    name: row.name,
    address: row.address,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    rating: row.rating === null ? null : Number(row.rating),
    notes: row.notes,
    imageUrl: row.image_url,
    metadataJson: row.metadata_json,
    isSaved: row.is_saved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
};

const toCollectionInput = (validated: ValidatedCollectionInput): CollectionInput => {
  return {
    name: validated.name,
    coverImage: validated.coverImage,
  };
};

const compareCollectionTimestamps = (leftUpdatedAt: string, rightUpdatedAt: string): number => {
  if (leftUpdatedAt > rightUpdatedAt) {
    return 1;
  }

  if (leftUpdatedAt < rightUpdatedAt) {
    return -1;
  }

  return 0;
};

const readCollectionVersion = async (
  database: DatabaseAdapter,
  userId: string,
  collectionId: string
): Promise<CollectionVersionRow | null> => {
  return database.get<CollectionVersionRow>(
    `SELECT id, user_id, updated_at, deleted_at
     FROM collections
     WHERE id = ? AND user_id = ?;`,
    [collectionId, userId]
  );
};

const isCollectionOutboxPayload = (payload: unknown): payload is CollectionOutboxPayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  if (
    typeof candidate.userId !== 'string'
    || typeof candidate.collectionId !== 'string'
    || typeof candidate.updatedAt !== 'string'
    || typeof candidate.operationType !== 'string'
  ) {
    return false;
  }

  if (
    candidate.operationType !== 'create'
    && candidate.operationType !== 'update'
    && candidate.operationType !== 'delete'
    && candidate.operationType !== 'add-place'
    && candidate.operationType !== 'remove-place'
    && candidate.operationType !== 'upsert'
  ) {
    return false;
  }

  if (candidate.placeId !== null && typeof candidate.placeId !== 'string') {
    return false;
  }

  if (candidate.collection !== null && candidate.collection !== undefined) {
    if (!candidate.collection || typeof candidate.collection !== 'object') {
      return false;
    }

    try {
      validateCollectionInput(candidate.collection as CollectionInput);
    } catch {
      return false;
    }
  }

  if (candidate.placeIds !== undefined) {
    if (!Array.isArray(candidate.placeIds)) {
      return false;
    }

    for (const placeId of candidate.placeIds) {
      if (typeof placeId !== 'string') {
        return false;
      }
    }
  }

  return true;
};

const recordCollectionOutboxMutation = async (
  database: DatabaseAdapter,
  payload: CollectionOutboxPayload,
  operationId: string
): Promise<void> => {
  await createOutboxEntry(database, {
    userId: payload.userId,
    entityType: COLLECTIONS_ENTITY_TYPE,
    entityId: payload.collectionId,
    operationType: payload.operationType,
    operationId,
    payloadJson: JSON.stringify(payload),
  });
};

const upsertCollectionRow = async (
  database: DatabaseAdapter,
  userId: string,
  collectionId: string,
  input: ValidatedCollectionInput,
  updatedAt: string
): Promise<void> => {
  const existing = await readCollectionVersion(database, userId, collectionId);

  if (existing) {
    await database.run(
      `UPDATE collections SET
         name = ?,
         cover_image = ?,
         updated_at = ?,
         deleted_at = NULL
       WHERE id = ? AND user_id = ?;`,
      [input.name, input.coverImage, updatedAt, collectionId, userId]
    );
    return;
  }

  await database.run(
    `INSERT INTO collections (id, user_id, name, cover_image, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL);`,
    [collectionId, userId, input.name, input.coverImage, updatedAt, updatedAt]
  );
};

const touchCollectionTimestamp = async (
  database: DatabaseAdapter,
  userId: string,
  collectionId: string,
  updatedAt: string
): Promise<void> => {
  await database.run(
    `UPDATE collections SET updated_at = ?
     WHERE id = ? AND user_id = ?;`,
    [updatedAt, collectionId, userId]
  );
};

const placeExistsForUser = async (
  database: DatabaseAdapter,
  userId: string,
  placeId: string
): Promise<boolean> => {
  const place = await database.get<{ id: string }>(
    `SELECT id FROM places
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [placeId, userId]
  );

  return Boolean(place);
};

const reconcileCollectionMemberships = async (
  database: DatabaseAdapter,
  userId: string,
  collectionId: string,
  remotePlaceIds: string[],
  updatedAt: string
): Promise<void> => {
  const dedupedRemotePlaceIds: string[] = [];
  const seenRemoteIds = new Set<string>();

  for (const placeId of remotePlaceIds) {
    if (!seenRemoteIds.has(placeId)) {
      dedupedRemotePlaceIds.push(placeId);
      seenRemoteIds.add(placeId);
    }
  }

  const existingMemberships = await database.all<CollectionPlaceVersionRow>(
    `SELECT place_id, deleted_at, position
     FROM collection_places
     WHERE collection_id = ?;`,
    [collectionId]
  );

  const existingByPlaceId = new Map<string, CollectionPlaceVersionRow>();

  for (const membership of existingMemberships) {
    existingByPlaceId.set(membership.place_id, membership);
  }

  let position = 0;

  for (const placeId of dedupedRemotePlaceIds) {
    if (!(await placeExistsForUser(database, userId, placeId))) {
      continue;
    }

    const existingMembership = existingByPlaceId.get(placeId);

    if (existingMembership) {
      await database.run(
        `UPDATE collection_places
         SET deleted_at = NULL,
             position = ?,
             updated_at = ?
         WHERE collection_id = ? AND place_id = ?;`,
        [position, updatedAt, collectionId, placeId]
      );
    } else {
      await database.run(
        `INSERT INTO collection_places (collection_id, place_id, position, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL);`,
        [collectionId, placeId, position, updatedAt, updatedAt]
      );
    }

    position += 1;
  }

  for (const membership of existingMemberships) {
    if (!seenRemoteIds.has(membership.place_id) && membership.deleted_at === null) {
      await database.run(
        `UPDATE collection_places
         SET deleted_at = ?,
             updated_at = ?
         WHERE collection_id = ? AND place_id = ?;`,
        [updatedAt, updatedAt, collectionId, membership.place_id]
      );
    }
  }
};

/**
 * SQL subquery that derives place count from non-deleted collection_places membership.
 */
const PLACE_COUNT_SUBQUERY = `(
  SELECT COUNT(*) FROM collection_places cp
  WHERE cp.collection_id = c.id AND cp.deleted_at IS NULL
) AS place_count`;

const SELECT_COLLECTION_FIELDS = `
  c.id,
  c.user_id,
  c.name,
  c.cover_image,
  c.created_at,
  c.updated_at,
  c.deleted_at,
  ${PLACE_COUNT_SUBQUERY}`;

/**
 * SQL fragment that derives saved status from collection_places membership.
 * Returns 1 when at least one non-deleted membership exists, 0 otherwise.
 */
const IS_SAVED_SUBQUERY = `(
  CASE WHEN EXISTS (
    SELECT 1 FROM collection_places cp2
    WHERE cp2.place_id = p.id AND cp2.deleted_at IS NULL
  ) THEN 1 ELSE 0 END
) AS is_saved`;

const SELECT_PLACE_FIELDS = `
  p.id,
  p.user_id,
  p.google_place_id,
  p.name,
  p.address,
  p.latitude,
  p.longitude,
  p.rating,
  p.notes,
  p.image_url,
  p.metadata_json,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  ${IS_SAVED_SUBQUERY}`;

// ---------------------------------------------------------------------------
// Collection CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new collection for a user.
 * @param database
 * @param options
 * @returns {Promise<CollectionRecord>}
 */
export const createCollection = async (
  database: DatabaseAdapter,
  options: CreateCollectionOptions
): Promise<CollectionRecord> => {
  const validated = validateCollectionInput(options.input);
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const collectionId = options.collectionId ?? createUuid();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;

  await database.transaction(async (tx) => {
    await ensureUserExists(tx, options.userId, timestamp);

    await tx.run(
      `INSERT INTO collections (id, user_id, name, cover_image, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL);`,
      [collectionId, options.userId, validated.name, validated.coverImage, timestamp, timestamp]
    );

    if (shouldRecordOutbox && nextOperationId) {
      await recordCollectionOutboxMutation(tx, {
        userId: options.userId,
        collectionId,
        operationType: 'create',
        updatedAt: timestamp,
        collection: toCollectionInput(validated),
        placeId: null,
      }, nextOperationId);
    }
  });

  const record = await getCollection(database, options.userId, collectionId);

  if (!record) {
    throw new Error(`Failed to read-back collection ${collectionId} after create.`);
  }

  return record;
};

/**
 * List all non-deleted collections for a user, newest first.
 * @param database
 * @param userId
 * @returns {Promise<CollectionRecord[]>}
 */
export const listCollections = async (
  database: DatabaseAdapter,
  userId: string
): Promise<CollectionRecord[]> => {
  const rows = await database.all<CollectionRowWithCount>(
    `SELECT ${SELECT_COLLECTION_FIELDS}
     FROM collections c
     WHERE c.user_id = ? AND c.deleted_at IS NULL
     ORDER BY c.created_at DESC;`,
    [userId]
  );

  return rows.map(mapRowToRecord);
};

/**
 * Fetch a single collection by ID, if it belongs to the given user and is not deleted.
 * @param database
 * @param userId
 * @param collectionId
 * @returns {Promise<CollectionRecord | null>}
 */
export const getCollection = async (
  database: DatabaseAdapter,
  userId: string,
  collectionId: string
): Promise<CollectionRecord | null> => {
  const row = await database.get<CollectionRowWithCount>(
    `SELECT ${SELECT_COLLECTION_FIELDS}
     FROM collections c
     WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL;`,
    [collectionId, userId]
  );

  if (!row) {
    return null;
  }

  return mapRowToRecord(row);
};

/**
 * Update a collection's name and/or cover image.
 * @param database
 * @param options
 * @returns {Promise<CollectionRecord>}
 */
export const updateCollection = async (
  database: DatabaseAdapter,
  options: UpdateCollectionOptions
): Promise<CollectionRecord> => {
  const validated = validateCollectionInput(options.input);
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;

  await database.transaction(async (tx) => {
    const result = await tx.run(
      `UPDATE collections SET name = ?, cover_image = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
      [validated.name, validated.coverImage, timestamp, options.collectionId, options.userId]
    );

    if (result.changes === 0) {
      throw new Error(`Collection ${options.collectionId} not found for user ${options.userId}.`);
    }

    if (shouldRecordOutbox && nextOperationId) {
      await recordCollectionOutboxMutation(tx, {
        userId: options.userId,
        collectionId: options.collectionId,
        operationType: 'update',
        updatedAt: timestamp,
        collection: toCollectionInput(validated),
        placeId: null,
      }, nextOperationId);
    }
  });

  const record = await getCollection(database, options.userId, options.collectionId);

  if (!record) {
    throw new Error(`Failed to read-back collection ${options.collectionId} after update.`);
  }

  return record;
};

export interface RemoveCollectionOptions {
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/**
 * Soft-delete a collection by setting deleted_at timestamp.
 * @param database
 * @param userId
 * @param collectionId
 * @returns {Promise<boolean>} true if a row was updated
 */
export const removeCollection = async (
  database: DatabaseAdapter,
  userId: string,
  collectionId: string,
  options: RemoveCollectionOptions = {}
): Promise<boolean> => {
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;
  let removed = false;

  await database.transaction(async (tx) => {
    const result = await tx.run(
      `UPDATE collections SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
      [timestamp, timestamp, collectionId, userId]
    );

    removed = result.changes > 0;

    if (removed) {
      await tx.run(
        `UPDATE collection_places SET deleted_at = ?, updated_at = ?
         WHERE collection_id = ? AND deleted_at IS NULL;`,
        [timestamp, timestamp, collectionId]
      );
    }

    if (removed && shouldRecordOutbox && nextOperationId) {
      await recordCollectionOutboxMutation(tx, {
        userId,
        collectionId,
        operationType: 'delete',
        updatedAt: timestamp,
        collection: null,
        placeId: null,
      }, nextOperationId);
    }
  });

  return removed;
};

// ---------------------------------------------------------------------------
// Membership operations
// ---------------------------------------------------------------------------

/**
 * Add a place to a collection. Auto-assigns position at end.
 * If a soft-deleted membership exists, it is restored.
 * @param database
 * @param options
 * @returns {Promise<boolean>} true if a membership was created or restored
 */
export const addPlaceToCollection = async (
  database: DatabaseAdapter,
  options: AddPlaceToCollectionOptions
): Promise<boolean> => {
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;

  return await database.transaction(async (tx) => {
    // Verify collection belongs to user and is not deleted
    const collection = await tx.get<{ id: string }>(
      `SELECT id FROM collections
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
      [options.collectionId, options.userId]
    );

    if (!collection) {
      throw new Error(`Collection ${options.collectionId} not found for user ${options.userId}.`);
    }

    // Verify place belongs to user and is not deleted
    const place = await tx.get<{ id: string }>(
      `SELECT id FROM places
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
      [options.placeId, options.userId]
    );

    if (!place) {
      throw new Error(`Place ${options.placeId} not found for user ${options.userId}.`);
    }

    // Check for existing membership (including soft-deleted)
    const existing = await tx.get<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM collection_places
       WHERE collection_id = ? AND place_id = ?;`,
      [options.collectionId, options.placeId]
    );

    if (existing) {
      if (existing.deleted_at === null) {
        // Already an active member — no-op
        return false;
      }

      // Restore soft-deleted membership with new position at end
      const maxRow = await tx.get<{ max_pos: number | null }>(
        `SELECT MAX(position) AS max_pos FROM collection_places
         WHERE collection_id = ? AND deleted_at IS NULL;`,
        [options.collectionId]
      );
      const nextPosition = (maxRow?.max_pos ?? -1) + 1;

      await tx.run(
        `UPDATE collection_places SET deleted_at = NULL, position = ?, updated_at = ?
         WHERE collection_id = ? AND place_id = ?;`,
        [nextPosition, timestamp, options.collectionId, options.placeId]
      );

      await touchCollectionTimestamp(tx, options.userId, options.collectionId, timestamp);

      if (shouldRecordOutbox && nextOperationId) {
        await recordCollectionOutboxMutation(tx, {
          userId: options.userId,
          collectionId: options.collectionId,
          operationType: 'add-place',
          updatedAt: timestamp,
          collection: null,
          placeId: options.placeId,
        }, nextOperationId);
      }

      return true;
    }

    // New membership — assign position at end
    const maxRow = await tx.get<{ max_pos: number | null }>(
      `SELECT MAX(position) AS max_pos FROM collection_places
       WHERE collection_id = ? AND deleted_at IS NULL;`,
      [options.collectionId]
    );
    const nextPosition = (maxRow?.max_pos ?? -1) + 1;

    await tx.run(
      `INSERT INTO collection_places (collection_id, place_id, position, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL);`,
      [options.collectionId, options.placeId, nextPosition, timestamp, timestamp]
    );

    await touchCollectionTimestamp(tx, options.userId, options.collectionId, timestamp);

    if (shouldRecordOutbox && nextOperationId) {
      await recordCollectionOutboxMutation(tx, {
        userId: options.userId,
        collectionId: options.collectionId,
        operationType: 'add-place',
        updatedAt: timestamp,
        collection: null,
        placeId: options.placeId,
      }, nextOperationId);
    }

    return true;
  });
};

/**
 * Remove a place from a collection (soft-delete the membership).
 * @param database
 * @param options
 * @returns {Promise<boolean>} true if a membership was soft-deleted
 */
export const removePlaceFromCollection = async (
  database: DatabaseAdapter,
  options: RemovePlaceFromCollectionOptions
): Promise<boolean> => {
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;

  return await database.transaction(async (tx) => {
    const result = await tx.run(
      `UPDATE collection_places SET deleted_at = ?, updated_at = ?
       WHERE collection_id = ? AND place_id = ? AND deleted_at IS NULL;`,
      [timestamp, timestamp, options.collectionId, options.placeId]
    );

    const removed = result.changes > 0;

    if (!removed) {
      return false;
    }

    await touchCollectionTimestamp(tx, options.userId, options.collectionId, timestamp);

    if (shouldRecordOutbox && nextOperationId) {
      await recordCollectionOutboxMutation(tx, {
        userId: options.userId,
        collectionId: options.collectionId,
        operationType: 'remove-place',
        updatedAt: timestamp,
        collection: null,
        placeId: options.placeId,
      }, nextOperationId);
    }

    return true;
  });
};

/**
 * List all non-deleted places in a collection, ordered by position.
 * Verifies the collection belongs to the user.
 * @param database
 * @param options
 * @returns {Promise<PlaceRecord[]>}
 */
export const listCollectionPlaces = async (
  database: DatabaseAdapter,
  options: ListCollectionPlacesOptions
): Promise<PlaceRecord[]> => {
  // Verify collection belongs to user
  const collection = await database.get<{ id: string }>(
    `SELECT id FROM collections
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [options.collectionId, options.userId]
  );

  if (!collection) {
    throw new Error(`Collection ${options.collectionId} not found for user ${options.userId}.`);
  }

  const rows = await database.all<PlaceRowWithSaved>(
    `SELECT ${SELECT_PLACE_FIELDS}
     FROM places p
     INNER JOIN collection_places cp ON cp.place_id = p.id
     WHERE cp.collection_id = ? AND cp.deleted_at IS NULL AND p.deleted_at IS NULL
     ORDER BY cp.position ASC;`,
    [options.collectionId]
  );

  return rows.map(mapPlaceRowToRecord);
};

/**
 * Read all pending collection mutations from the local outbox.
 * @param database
 * @param userId
 * @param limit
 * @returns {Promise<CollectionOutboxMutation[]>}
 */
export const listPendingCollectionMutations = async (
  database: DatabaseAdapter,
  userId: string,
  limit = 50
): Promise<CollectionOutboxMutation[]> => {
  const rows = await listPendingMutations(database, userId, COLLECTIONS_ENTITY_TYPE, limit);
  const mutations: CollectionOutboxMutation[] = [];

  for (const row of rows) {
    if (!isCollectionOutboxPayload(row.payload)) {
      throw new Error(`Invalid collection outbox payload for row ${row.outboxId}.`);
    }

    mutations.push({
      outboxId: row.outboxId,
      userId: row.userId,
      collectionId: row.entityId,
      operationId: row.operationId,
      operationType: row.payload.operationType,
      updatedAt: row.payload.updatedAt,
      attempts: row.attempts,
      collection: row.payload.collection,
      placeId: row.payload.placeId,
    });
  }

  return mutations;
};

/**
 * Apply a remote collection operation if it is newer than local collection state.
 * @param database
 * @param operation
 * @returns {Promise<{ applied: boolean; collection: CollectionRecord | null }>}
 */
export const applyCollectionSyncOperation = async (
  database: DatabaseAdapter,
  operation: CollectionSyncOperation
): Promise<{ applied: boolean; collection: CollectionRecord | null }> => {
  let applied = false;
  let collection: CollectionRecord | null = null;

  await database.transaction(async (tx) => {
    const existing = await readCollectionVersion(tx, operation.userId, operation.collectionId);

    if (existing && compareCollectionTimestamps(operation.updatedAt, existing.updated_at) <= 0) {
      collection = existing.deleted_at ? null : await getCollection(tx, operation.userId, operation.collectionId);
      return;
    }

    switch (operation.operationType) {
      case 'delete': {
        const result = await tx.run(
          `UPDATE collections
           SET deleted_at = ?,
               updated_at = ?
           WHERE id = ? AND user_id = ?;`,
          [operation.updatedAt, operation.updatedAt, operation.collectionId, operation.userId]
        );

        if (result.changes > 0) {
          await tx.run(
            `UPDATE collection_places
             SET deleted_at = ?,
                 updated_at = ?
             WHERE collection_id = ? AND deleted_at IS NULL;`,
            [operation.updatedAt, operation.updatedAt, operation.collectionId]
          );
          applied = true;
        }

        collection = null;
        return;
      }
      case 'create':
      case 'update':
      case 'upsert': {
        if (!operation.collection) {
          throw new Error('Collection sync upsert operation requires collection data.');
        }

        const validated = validateCollectionInput(operation.collection);
        await ensureUserExists(tx, operation.userId, operation.updatedAt);
        await upsertCollectionRow(tx, operation.userId, operation.collectionId, validated, operation.updatedAt);

        if (operation.placeIds) {
          await reconcileCollectionMemberships(
            tx,
            operation.userId,
            operation.collectionId,
            operation.placeIds,
            operation.updatedAt
          );
          await touchCollectionTimestamp(tx, operation.userId, operation.collectionId, operation.updatedAt);
        }

        applied = true;
        collection = await getCollection(tx, operation.userId, operation.collectionId);
        return;
      }
      case 'add-place': {
        if (!operation.placeId) {
          throw new Error('Collection add-place sync operation requires placeId.');
        }

        const activeCollection = await tx.get<{ id: string }>(
          `SELECT id FROM collections
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
          [operation.collectionId, operation.userId]
        );

        if (!activeCollection || !(await placeExistsForUser(tx, operation.userId, operation.placeId))) {
          collection = await getCollection(tx, operation.userId, operation.collectionId);
          return;
        }

        const existingMembership = await tx.get<{ deleted_at: string | null }>(
          `SELECT deleted_at FROM collection_places
           WHERE collection_id = ? AND place_id = ?;`,
          [operation.collectionId, operation.placeId]
        );

        if (existingMembership && existingMembership.deleted_at === null) {
          collection = await getCollection(tx, operation.userId, operation.collectionId);
          return;
        }

        const maxRow = await tx.get<{ max_pos: number | null }>(
          `SELECT MAX(position) AS max_pos FROM collection_places
           WHERE collection_id = ? AND deleted_at IS NULL;`,
          [operation.collectionId]
        );
        const nextPosition = (maxRow?.max_pos ?? -1) + 1;

        if (existingMembership) {
          await tx.run(
            `UPDATE collection_places
             SET deleted_at = NULL,
                 position = ?,
                 updated_at = ?
             WHERE collection_id = ? AND place_id = ?;`,
            [nextPosition, operation.updatedAt, operation.collectionId, operation.placeId]
          );
        } else {
          await tx.run(
            `INSERT INTO collection_places (collection_id, place_id, position, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, NULL);`,
            [operation.collectionId, operation.placeId, nextPosition, operation.updatedAt, operation.updatedAt]
          );
        }

        await touchCollectionTimestamp(tx, operation.userId, operation.collectionId, operation.updatedAt);
        applied = true;
        collection = await getCollection(tx, operation.userId, operation.collectionId);
        return;
      }
      case 'remove-place': {
        if (!operation.placeId) {
          throw new Error('Collection remove-place sync operation requires placeId.');
        }

        const result = await tx.run(
          `UPDATE collection_places
           SET deleted_at = ?,
               updated_at = ?
           WHERE collection_id = ? AND place_id = ? AND deleted_at IS NULL;`,
          [operation.updatedAt, operation.updatedAt, operation.collectionId, operation.placeId]
        );

        if (result.changes > 0) {
          await touchCollectionTimestamp(tx, operation.userId, operation.collectionId, operation.updatedAt);
          applied = true;
        }

        collection = await getCollection(tx, operation.userId, operation.collectionId);
        return;
      }
      default: {
        const unsupportedType: never = operation.operationType;
        throw new Error(`Unsupported collection sync operation type: ${unsupportedType}`);
      }
    }
  });

  return {
    applied,
    collection,
  };
};
