/**
 * Place persistence use-cases.
 *
 * Core operations: upsert (with google_place_id dedup), list, get, remove.
 * Derives isSaved from collection_places membership.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { PlaceRow } from '../../schema/src';
import { createOutboxEntry, listPendingMutations } from '../../sync/src';
import type {
  PlaceInput,
  PlaceOutboxMutation,
  PlaceRecord,
  PlaceSyncOperation,
  PlaceSyncOperationType,
  ValidatedPlaceInput,
} from './types';
import { validatePlaceInput } from './validation';

/** Extended row returned by queries that join a saved-status column. */
interface PlaceRowWithSaved extends PlaceRow {
  is_saved: number;
}

interface PlaceVersionRow {
  id: string;
  user_id: string;
  updated_at: string;
  last_operation_id: string | null;
  deleted_at: string | null;
}

interface PlaceOutboxPayload {
  userId: string;
  placeId: string;
  operationType: PlaceSyncOperationType;
  updatedAt: string;
  place: PlaceInput | null;
}

const PLACES_ENTITY_TYPE = 'places';

const ensureUserExists = async (database: DatabaseAdapter, userId: string, timestamp: string): Promise<void> => {
  await database.run(
    `INSERT INTO users (id, provider, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING;`,
    [userId, 'local', timestamp, timestamp]
  );
};

const mapRowToRecord = (row: PlaceRowWithSaved): PlaceRecord => {
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

const toPlaceInput = (validated: ValidatedPlaceInput): PlaceInput => {
  return {
    name: validated.name,
    address: validated.address,
    latitude: validated.latitude,
    longitude: validated.longitude,
    googlePlaceId: validated.googlePlaceId,
    rating: validated.rating,
    notes: validated.notes,
    imageUrl: validated.imageUrl,
    metadataJson: validated.metadataJson,
  };
};

const isPlaceOutboxPayload = (payload: unknown): payload is PlaceOutboxPayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  if (
    typeof candidate.userId !== 'string'
    || typeof candidate.placeId !== 'string'
    || typeof candidate.updatedAt !== 'string'
    || (candidate.operationType !== 'upsert' && candidate.operationType !== 'delete')
  ) {
    return false;
  }

  if (candidate.operationType === 'delete') {
    return candidate.place === null;
  }

  if (!candidate.place || typeof candidate.place !== 'object') {
    return false;
  }

  try {
    validatePlaceInput(candidate.place as PlaceInput);
    return true;
  } catch {
    return false;
  }
};

const readPlaceVersion = async (
  database: DatabaseAdapter,
  userId: string,
  placeId: string
): Promise<PlaceVersionRow | null> => {
  return database.get<PlaceVersionRow>(
    `SELECT id, user_id, updated_at, last_operation_id, deleted_at
     FROM places
     WHERE id = ? AND user_id = ?;`,
    [placeId, userId]
  );
};

const comparePlaceVersions = (
  left: { updatedAt: string; operationId: string | null },
  right: { updatedAt: string; operationId: string | null }
): number => {
  if (left.updatedAt > right.updatedAt) {
    return 1;
  }

  if (left.updatedAt < right.updatedAt) {
    return -1;
  }

  const leftOperationId = left.operationId ?? '';
  const rightOperationId = right.operationId ?? '';

  if (leftOperationId > rightOperationId) {
    return 1;
  }

  if (leftOperationId < rightOperationId) {
    return -1;
  }

  return 0;
};

const recordPlaceOutboxMutation = async (
  database: DatabaseAdapter,
  payload: PlaceOutboxPayload,
  operationId: string
): Promise<void> => {
  await createOutboxEntry(database, {
    userId: payload.userId,
    entityType: PLACES_ENTITY_TYPE,
    entityId: payload.placeId,
    operationType: payload.operationType,
    operationId,
    payloadJson: JSON.stringify(payload),
  });
};

/**
 * SQL fragment that derives saved status from collection_places membership.
 * Returns 1 when at least one non-deleted membership exists, 0 otherwise.
 */
const IS_SAVED_SUBQUERY = `(
  CASE WHEN EXISTS (
    SELECT 1 FROM collection_places cp
    WHERE cp.place_id = p.id AND cp.deleted_at IS NULL
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
  p.last_operation_id,
  p.deleted_at,
  ${IS_SAVED_SUBQUERY}`;

export interface UpsertPlaceOptions {
  userId: string;
  input: PlaceInput;
  placeId?: string;
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/**
 * Upsert a place for a user.
 *
 * When googlePlaceId is provided and a matching non-deleted row already
 * exists for the same user, the existing row is updated. Otherwise a new
 * row is inserted with a fresh UUID.
 *
 * @param database
 * @param options
 * @returns {Promise<PlaceRecord>}
 */
export const upsertPlace = async (
  database: DatabaseAdapter,
  options: UpsertPlaceOptions
): Promise<PlaceRecord> => {
  const validated = validatePlaceInput(options.input);
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;

  let placeId: string | null = null;
  let resolvedOperationId: string | null = nextOperationId;

  await database.transaction(async (tx) => {
    await ensureUserExists(tx, options.userId, timestamp);

    if (options.placeId) {
      const existingById = await tx.get<{ id: string }>(
        `SELECT id FROM places
         WHERE id = ? AND user_id = ?;`,
        [options.placeId, options.userId]
      );

      placeId = options.placeId;
      const operationIdForWrite = resolvedOperationId ?? `${timestamp}:${placeId}`;
      resolvedOperationId = operationIdForWrite;

      if (existingById) {
        await tx.run(
          `UPDATE places SET
            google_place_id = ?,
            name = ?,
            address = ?,
            latitude = ?,
            longitude = ?,
            rating = ?,
            notes = ?,
            image_url = ?,
            metadata_json = ?,
            updated_at = ?,
            last_operation_id = ?,
            deleted_at = NULL
          WHERE id = ? AND user_id = ?;`,
          [
            validated.googlePlaceId,
            validated.name,
            validated.address,
            validated.latitude,
            validated.longitude,
            validated.rating,
            validated.notes,
            validated.imageUrl,
            validated.metadataJson,
            timestamp,
            operationIdForWrite,
            placeId,
            options.userId,
          ]
        );
      } else {
        await tx.run(
          `INSERT INTO places (
            id, user_id, google_place_id, name, address,
            latitude, longitude, rating, notes, image_url,
            metadata_json, created_at, updated_at, last_operation_id, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
          [
            placeId,
            options.userId,
            validated.googlePlaceId,
            validated.name,
            validated.address,
            validated.latitude,
            validated.longitude,
            validated.rating,
            validated.notes,
            validated.imageUrl,
            validated.metadataJson,
            timestamp,
            timestamp,
            operationIdForWrite,
          ]
        );
      }
    } else {
      // Check for existing place by google_place_id (unique per user)
      if (validated.googlePlaceId) {
        const existing = await tx.get<{ id: string }>(
          `SELECT id FROM places
           WHERE user_id = ? AND google_place_id = ? AND deleted_at IS NULL;`,
          [options.userId, validated.googlePlaceId]
        );

        if (existing) {
          placeId = existing.id;
          const operationIdForWrite = resolvedOperationId ?? `${timestamp}:${placeId}`;
          resolvedOperationId = operationIdForWrite;

          await tx.run(
            `UPDATE places SET
              name = ?,
              address = ?,
              latitude = ?,
              longitude = ?,
              rating = ?,
              notes = ?,
              image_url = ?,
              metadata_json = ?,
              updated_at = ?,
              last_operation_id = ?
            WHERE id = ? AND user_id = ?;`,
            [
              validated.name,
              validated.address,
              validated.latitude,
              validated.longitude,
              validated.rating,
              validated.notes,
              validated.imageUrl,
              validated.metadataJson,
              timestamp,
              operationIdForWrite,
              placeId,
              options.userId,
            ]
          );
        }
      }

      if (!placeId) {
        // Insert new place row
        placeId = createUuid();
        const operationIdForWrite = resolvedOperationId ?? `${timestamp}:${placeId}`;
        resolvedOperationId = operationIdForWrite;

        await tx.run(
          `INSERT INTO places (
            id, user_id, google_place_id, name, address,
            latitude, longitude, rating, notes, image_url,
            metadata_json, created_at, updated_at, last_operation_id, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
          [
            placeId,
            options.userId,
            validated.googlePlaceId,
            validated.name,
            validated.address,
            validated.latitude,
            validated.longitude,
            validated.rating,
            validated.notes,
            validated.imageUrl,
            validated.metadataJson,
            timestamp,
            timestamp,
            operationIdForWrite,
          ]
        );
      }
    }

    if (shouldRecordOutbox && nextOperationId && placeId) {
      await recordPlaceOutboxMutation(tx, {
        userId: options.userId,
        placeId,
        operationType: 'upsert',
        updatedAt: timestamp,
        place: toPlaceInput(validated),
      }, nextOperationId);
    }
  });

  if (!placeId) {
    throw new Error(`Failed to upsert place for user ${options.userId}.`);
  }

  const record = await getPlace(database, options.userId, placeId);

  if (!record) {
    throw new Error(`Failed to read-back place ${placeId} after upsert.`);
  }

  return record;
};

/**
 * List all non-deleted places for a user, newest first.
 * @param database
 * @param userId
 * @returns {Promise<PlaceRecord[]>}
 */
export const listPlaces = async (
  database: DatabaseAdapter,
  userId: string
): Promise<PlaceRecord[]> => {
  const rows = await database.all<PlaceRowWithSaved>(
    `SELECT ${SELECT_PLACE_FIELDS}
     FROM places p
     WHERE p.user_id = ? AND p.deleted_at IS NULL
     ORDER BY p.created_at DESC;`,
    [userId]
  );

  return rows.map(mapRowToRecord);
};

/**
 * Fetch a single place by ID, if it belongs to the given user and is not deleted.
 * @param database
 * @param userId
 * @param placeId
 * @returns {Promise<PlaceRecord | null>}
 */
export const getPlace = async (
  database: DatabaseAdapter,
  userId: string,
  placeId: string
): Promise<PlaceRecord | null> => {
  const row = await database.get<PlaceRowWithSaved>(
    `SELECT ${SELECT_PLACE_FIELDS}
     FROM places p
     WHERE p.id = ? AND p.user_id = ? AND p.deleted_at IS NULL;`,
    [placeId, userId]
  );

  if (!row) {
    return null;
  }

  return mapRowToRecord(row);
};

export interface RemovePlaceOptions {
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/**
 * Soft-delete a place by setting deleted_at timestamp.
 * @param database
 * @param userId
 * @param placeId
 * @param options
 * @returns {Promise<boolean>} true if a row was updated
 */
export const removePlace = async (
  database: DatabaseAdapter,
  userId: string,
  placeId: string,
  options: RemovePlaceOptions = {}
): Promise<boolean> => {
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const timestamp = options.updatedAt ?? nowIso();
  const nextOperationId = options.operationId === undefined
    ? (shouldRecordOutbox ? createUuid() : null)
    : options.operationId;
  const operationIdForWrite = nextOperationId ?? `${timestamp}:${placeId}`;

  let removed = false;

  await database.transaction(async (tx) => {
    const result = await tx.run(
      `UPDATE places SET deleted_at = ?, updated_at = ?, last_operation_id = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
      [timestamp, timestamp, operationIdForWrite, placeId, userId]
    );

    removed = result.changes > 0;

    if (removed && shouldRecordOutbox && nextOperationId) {
      await recordPlaceOutboxMutation(tx, {
        userId,
        placeId,
        operationType: 'delete',
        updatedAt: timestamp,
        place: null,
      }, nextOperationId);
    }
  });

  return removed;
};

/**
 * Read all pending place mutations from the local outbox.
 * @param database
 * @param userId
 * @param limit
 * @returns {Promise<PlaceOutboxMutation[]>}
 */
export const listPendingPlaceMutations = async (
  database: DatabaseAdapter,
  userId: string,
  limit = 50
): Promise<PlaceOutboxMutation[]> => {
  const rows = await listPendingMutations(database, userId, PLACES_ENTITY_TYPE, limit);
  const mutations: PlaceOutboxMutation[] = [];

  for (const row of rows) {
    if (!isPlaceOutboxPayload(row.payload)) {
      throw new Error(`Invalid place outbox payload for row ${row.outboxId}.`);
    }

    mutations.push({
      outboxId: row.outboxId,
      userId: row.userId,
      placeId: row.entityId,
      operationId: row.operationId,
      operationType: row.payload.operationType,
      updatedAt: row.payload.updatedAt,
      attempts: row.attempts,
      place: row.payload.place,
    });
  }

  return mutations;
};

/**
 * Apply a remote place operation if it is newer than the local row.
 * @param database
 * @param operation
 * @returns {Promise<{ applied: boolean; place: PlaceRecord | null }>}
 */
export const applyPlaceSyncOperation = async (
  database: DatabaseAdapter,
  operation: PlaceSyncOperation
): Promise<{ applied: boolean; place: PlaceRecord | null }> => {
  let applied = false;
  let place: PlaceRecord | null = null;

  await database.transaction(async (tx) => {
    const existing = await readPlaceVersion(tx, operation.userId, operation.placeId);

    if (
      existing
      && comparePlaceVersions(
        {
          updatedAt: operation.updatedAt,
          operationId: operation.operationId,
        },
        {
          updatedAt: existing.updated_at,
          operationId: existing.last_operation_id ?? `${existing.updated_at}:${existing.id}`,
        }
      ) <= 0
    ) {
      place = existing.deleted_at ? null : await getPlace(tx, operation.userId, operation.placeId);
      return;
    }

    if (operation.operationType === 'delete') {
      const result = await tx.run(
        `UPDATE places
         SET deleted_at = ?,
             updated_at = ?,
             last_operation_id = ?
         WHERE id = ? AND user_id = ?;`,
        [
          operation.updatedAt,
          operation.updatedAt,
          operation.operationId,
          operation.placeId,
          operation.userId,
        ]
      );

      applied = result.changes > 0;
      place = null;
      return;
    }

    if (!operation.place) {
      throw new Error('Place upsert sync operation requires place data.');
    }

    const validated = validatePlaceInput(operation.place);
    await ensureUserExists(tx, operation.userId, operation.updatedAt);

    if (existing) {
      await tx.run(
        `UPDATE places SET
          google_place_id = ?,
          name = ?,
          address = ?,
          latitude = ?,
          longitude = ?,
          rating = ?,
          notes = ?,
          image_url = ?,
          metadata_json = ?,
          updated_at = ?,
          last_operation_id = ?,
          deleted_at = NULL
        WHERE id = ? AND user_id = ?;`,
        [
          validated.googlePlaceId,
          validated.name,
          validated.address,
          validated.latitude,
          validated.longitude,
          validated.rating,
          validated.notes,
          validated.imageUrl,
          validated.metadataJson,
          operation.updatedAt,
          operation.operationId,
          operation.placeId,
          operation.userId,
        ]
      );
    } else {
      await tx.run(
        `INSERT INTO places (
          id, user_id, google_place_id, name, address,
          latitude, longitude, rating, notes, image_url,
          metadata_json, created_at, updated_at, last_operation_id, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
        [
          operation.placeId,
          operation.userId,
          validated.googlePlaceId,
          validated.name,
          validated.address,
          validated.latitude,
          validated.longitude,
          validated.rating,
          validated.notes,
          validated.imageUrl,
          validated.metadataJson,
          operation.updatedAt,
          operation.updatedAt,
          operation.operationId,
        ]
      );
    }

    applied = true;
    place = await getPlace(tx, operation.userId, operation.placeId);
  });

  return {
    applied,
    place,
  };
};
