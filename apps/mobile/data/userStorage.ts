/**
 * SQLite-backed user session persistence for mobile auth state.
 */

import { nowIso } from '../../../core/src';
import type { UserRow } from '../../../schema/src';
import { getDatabase } from './database';
import type { AuthenticatedUser } from './types';
import { GUEST_USER_ID } from './runtimeSession';

interface PersistedUserRow extends UserRow {}

const AUTH_PROVIDERS = ['google', 'apple'];

const hasRows = async (queryResult: { count: number } | null): Promise<boolean> => {
  return Number(queryResult?.count ?? 0) > 0;
};

const mapRowToUser = (row: PersistedUserRow): AuthenticatedUser => {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? 'User',
    picture: row.avatar_url,
    provider: row.provider === 'apple' ? 'apple' : 'google',
  };
};

/**
 * Load the most recently updated authenticated user.
 * @returns {Promise<AuthenticatedUser | null>}
 */
export const loadStoredUser = async (): Promise<AuthenticatedUser | null> => {
  const database = await getDatabase();

  const row = await database.get<PersistedUserRow>(
    `SELECT id, provider, email, name, avatar_url, created_at, updated_at
     FROM users
     WHERE provider IN (?, ?)
     ORDER BY updated_at DESC
     LIMIT 1;`,
    AUTH_PROVIDERS
  );

  if (!row) {
    return null;
  }

  return mapRowToUser(row);
};

/**
 * Upsert an authenticated user profile.
 * @param user
 */
export const saveUser = async (user: AuthenticatedUser): Promise<void> => {
  const database = await getDatabase();
  const timestamp = nowIso();

  await database.run(
    `INSERT INTO users (id, provider, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       email = excluded.email,
       name = excluded.name,
       avatar_url = excluded.avatar_url,
       updated_at = excluded.updated_at;`,
    [
      user.id,
      user.provider,
      user.email,
      user.name,
      user.picture,
      timestamp,
      timestamp,
    ]
  );
};

/**
 * Move guest-scoped data into an authenticated user scope.
 * This preserves pre-login bookmarks after sign-in.
 * @param authenticatedUserId
 */
export const migrateGuestDataToUser = async (authenticatedUserId: string): Promise<void> => {
  if (!authenticatedUserId || authenticatedUserId === GUEST_USER_ID) {
    return;
  }

  const database = await getDatabase();

  await database.transaction(async (tx) => {
    const guestHasPlaces = await hasRows(
      await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM places WHERE user_id = ?;', [GUEST_USER_ID])
    );
    const guestHasCollections = await hasRows(
      await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM collections WHERE user_id = ?;', [GUEST_USER_ID])
    );
    const guestHasPreferences = await hasRows(
      await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM preferences WHERE user_id = ?;', [GUEST_USER_ID])
    );
    const guestHasOutbox = await hasRows(
      await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM outbox WHERE user_id = ?;', [GUEST_USER_ID])
    );
    const guestHasSyncState = await hasRows(
      await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM sync_state WHERE user_id = ?;', [GUEST_USER_ID])
    );

    if (!guestHasPlaces && !guestHasCollections && !guestHasPreferences && !guestHasOutbox && !guestHasSyncState) {
      return;
    }

    await tx.run(
      `UPDATE places AS guest_place
       SET google_place_id = NULL
       WHERE guest_place.user_id = ?
         AND guest_place.google_place_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM places AS existing_place
           WHERE existing_place.user_id = ?
             AND existing_place.google_place_id = guest_place.google_place_id
         );`,
      [GUEST_USER_ID, authenticatedUserId]
    );

    await tx.run('UPDATE places SET user_id = ? WHERE user_id = ?;', [authenticatedUserId, GUEST_USER_ID]);
    await tx.run('UPDATE collections SET user_id = ? WHERE user_id = ?;', [authenticatedUserId, GUEST_USER_ID]);

    const targetHasPreferences = await hasRows(
      await tx.get<{ count: number }>('SELECT COUNT(*) AS count FROM preferences WHERE user_id = ?;', [authenticatedUserId])
    );

    if (targetHasPreferences) {
      await tx.run('DELETE FROM preferences WHERE user_id = ?;', [GUEST_USER_ID]);
    } else {
      await tx.run('UPDATE preferences SET user_id = ? WHERE user_id = ?;', [authenticatedUserId, GUEST_USER_ID]);
    }

    await tx.run(
      'UPDATE outbox SET user_id = ?, payload_json = REPLACE(payload_json, ?, ?) WHERE user_id = ?;',
      [
        authenticatedUserId,
        `"userId":"${GUEST_USER_ID}"`,
        `"userId":"${authenticatedUserId}"`,
        GUEST_USER_ID,
      ]
    );

    await tx.run(
      `DELETE FROM sync_state
       WHERE user_id = ?
         AND entity_type IN (
           SELECT entity_type FROM sync_state WHERE user_id = ?
         );`,
      [GUEST_USER_ID, authenticatedUserId]
    );
    await tx.run('UPDATE sync_state SET user_id = ? WHERE user_id = ?;', [authenticatedUserId, GUEST_USER_ID]);
    await tx.run('DELETE FROM users WHERE id = ?;', [GUEST_USER_ID]);
  });
};
