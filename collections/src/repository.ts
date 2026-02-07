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
import type { PlaceRecord } from '../../places/src';
import type {
  CollectionInput,
  CollectionRecord,
  CreateCollectionOptions,
  UpdateCollectionOptions,
  AddPlaceToCollectionOptions,
  RemovePlaceFromCollectionOptions,
  ListCollectionPlacesOptions,
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
  const timestamp = nowIso();
  const collectionId = createUuid();

  await database.transaction(async (tx) => {
    await ensureUserExists(tx, options.userId, timestamp);

    await tx.run(
      `INSERT INTO collections (id, user_id, name, cover_image, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL);`,
      [collectionId, options.userId, validated.name, validated.coverImage, timestamp, timestamp]
    );
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
  const timestamp = nowIso();

  const result = await database.run(
    `UPDATE collections SET name = ?, cover_image = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [validated.name, validated.coverImage, timestamp, options.collectionId, options.userId]
  );

  if (result.changes === 0) {
    throw new Error(`Collection ${options.collectionId} not found for user ${options.userId}.`);
  }

  const record = await getCollection(database, options.userId, options.collectionId);

  if (!record) {
    throw new Error(`Failed to read-back collection ${options.collectionId} after update.`);
  }

  return record;
};

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
  collectionId: string
): Promise<boolean> => {
  const timestamp = nowIso();

  const result = await database.run(
    `UPDATE collections SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [timestamp, timestamp, collectionId, userId]
  );

  return result.changes > 0;
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
  const timestamp = nowIso();

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
  const timestamp = nowIso();

  const result = await database.run(
    `UPDATE collection_places SET deleted_at = ?, updated_at = ?
     WHERE collection_id = ? AND place_id = ? AND deleted_at IS NULL;`,
    [timestamp, timestamp, options.collectionId, options.placeId]
  );

  return result.changes > 0;
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
