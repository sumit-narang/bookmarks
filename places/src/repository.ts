/**
 * Place persistence use-cases.
 *
 * Core operations: upsert (with google_place_id dedup), list, get, remove.
 * Derives isSaved from collection_places membership.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { PlaceRow } from '../../schema/src';
import type { PlaceInput, PlaceRecord, ValidatedPlaceInput } from './types';
import { validatePlaceInput } from './validation';

/** Extended row returned by queries that join a saved-status column. */
interface PlaceRowWithSaved extends PlaceRow {
  is_saved: number;
}

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
  p.deleted_at,
  ${IS_SAVED_SUBQUERY}`;

export interface UpsertPlaceOptions {
  userId: string;
  input: PlaceInput;
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
  const timestamp = nowIso();

  let placeId: string | null = null;

  await database.transaction(async (tx) => {
    await ensureUserExists(tx, options.userId, timestamp);

    // Check for existing place by google_place_id (unique per user)
    if (validated.googlePlaceId) {
      const existing = await tx.get<{ id: string }>(
        `SELECT id FROM places
         WHERE user_id = ? AND google_place_id = ? AND deleted_at IS NULL;`,
        [options.userId, validated.googlePlaceId]
      );

      if (existing) {
        placeId = existing.id;

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
            updated_at = ?
          WHERE id = ?;`,
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
            placeId,
          ]
        );

        return;
      }
    }

    // Insert new place row
    placeId = createUuid();

    await tx.run(
      `INSERT INTO places (
        id, user_id, google_place_id, name, address,
        latitude, longitude, rating, notes, image_url,
        metadata_json, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);`,
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
      ]
    );
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

/**
 * Soft-delete a place by setting deleted_at timestamp.
 * @param database
 * @param userId
 * @param placeId
 * @returns {Promise<boolean>} true if a row was updated
 */
export const removePlace = async (
  database: DatabaseAdapter,
  userId: string,
  placeId: string
): Promise<boolean> => {
  const timestamp = nowIso();

  const result = await database.run(
    `UPDATE places SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [timestamp, timestamp, placeId, userId]
  );

  return result.changes > 0;
};
