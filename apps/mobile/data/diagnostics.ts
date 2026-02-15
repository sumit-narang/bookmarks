/**
 * Dev/e2e diagnostics helpers for deterministic persistence assertions.
 */

import { createHttpRequest, readJsonResponse } from '../../../http/src';
import { getActiveUserId, resetActiveUserId } from './runtimeSession';
import { clearAuthSession, loadAuthSession } from './authSession';
import { getDatabase } from './database';
import {
  addPlaceToCollection,
  createCollection,
  getCollectionsForPlace,
  getPlaces,
  removePlaceFromCollection,
  saveGooglePlace,
} from './storage';
import { loadHexagonPreferences, saveHexagonPreferences } from './preferencesStorage';
import { wipeLocalDataOnSignOut } from './localPersistence';
import { createAuthenticatedHttpClientOptions, syncAuthenticatedData } from './syncManager';

interface CountRow {
  count: number;
}

interface SyncStateRow {
  entity_type: string;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  remote_cursor: string | null;
  last_synced_operation_id: string | null;
  updated_at: string;
}

interface PreferenceRow {
  hexagon_theme: string;
  hexagon_variant: string;
  hexagon_size: number;
  hexagon_custom_depth: number | null;
  hexagon_use_custom_depth: number;
}

export interface DiagnosticsSyncStateSnapshot {
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  remoteCursor: string | null;
  lastSyncedOperationId: string | null;
  updatedAt: string | null;
}

export interface DiagnosticsSnapshot {
  activeUserId: string;
  hasAuthSession: boolean;
  authSessionUserId: string | null;
  tableCounts: {
    places: number;
    savedPlaces: number;
    collections: number;
    collectionPlaces: number;
    outbox: number;
    outboxPending: number;
    syncState: number;
  };
  syncState: {
    preferences: DiagnosticsSyncStateSnapshot;
    places: DiagnosticsSyncStateSnapshot;
    collections: DiagnosticsSyncStateSnapshot;
  };
  preferences: {
    hexagonTheme: string | null;
    hexagonVariant: string | null;
    hexagonSize: number | null;
    hexagonCustomDepth: number | null;
    hexagonUseCustomDepth: boolean | null;
  };
}

const emptySyncStateSnapshot: DiagnosticsSyncStateSnapshot = {
  lastPulledAt: null,
  lastPushedAt: null,
  remoteCursor: null,
  lastSyncedOperationId: null,
  updatedAt: null,
};

const readCount = async (
  database: Awaited<ReturnType<typeof getDatabase>>,
  sql: string,
  params: string[]
): Promise<number> => {
  const row = await database.get<CountRow>(sql, params);
  return Number(row?.count ?? 0);
};

const mapSyncStateRows = (rows: SyncStateRow[]): DiagnosticsSnapshot['syncState'] => {
  const byEntityType = new Map<string, DiagnosticsSyncStateSnapshot>();

  for (const row of rows) {
    byEntityType.set(row.entity_type, {
      lastPulledAt: row.last_pulled_at,
      lastPushedAt: row.last_pushed_at,
      remoteCursor: row.remote_cursor,
      lastSyncedOperationId: row.last_synced_operation_id,
      updatedAt: row.updated_at,
    });
  }

  return {
    preferences: byEntityType.get('preferences') ?? { ...emptySyncStateSnapshot },
    places: byEntityType.get('places') ?? { ...emptySyncStateSnapshot },
    collections: byEntityType.get('collections') ?? { ...emptySyncStateSnapshot },
  };
};

/**
 * Read a full diagnostics snapshot for the current active user scope.
 * @returns {Promise<DiagnosticsSnapshot>}
 */
export const getDiagnosticsSnapshot = async (): Promise<DiagnosticsSnapshot> => {
  const userId = getActiveUserId();
  const database = await getDatabase();
  const session = await loadAuthSession();

  const [
    placesCount,
    savedPlacesCount,
    collectionsCount,
    collectionPlacesCount,
    outboxCount,
    outboxPendingCount,
    syncStateCount,
    syncStateRows,
    preferenceRow,
  ] = await Promise.all([
    readCount(database, 'SELECT COUNT(*) AS count FROM places WHERE user_id = ?;', [userId]),
    readCount(
      database,
      `SELECT COUNT(*) AS count
       FROM places p
       WHERE p.user_id = ?
         AND p.deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM collection_places cp
           WHERE cp.place_id = p.id
             AND cp.deleted_at IS NULL
         );`,
      [userId]
    ),
    readCount(database, 'SELECT COUNT(*) AS count FROM collections WHERE user_id = ?;', [userId]),
    readCount(
      database,
      `SELECT COUNT(*) AS count
       FROM collection_places cp
       INNER JOIN collections c ON c.id = cp.collection_id
       WHERE c.user_id = ?;`,
      [userId]
    ),
    readCount(database, 'SELECT COUNT(*) AS count FROM outbox WHERE user_id = ?;', [userId]),
    readCount(database, 'SELECT COUNT(*) AS count FROM outbox WHERE user_id = ? AND processed_at IS NULL;', [userId]),
    readCount(database, 'SELECT COUNT(*) AS count FROM sync_state WHERE user_id = ?;', [userId]),
    database.all<SyncStateRow>(
      `SELECT entity_type, last_pulled_at, last_pushed_at, remote_cursor, last_synced_operation_id, updated_at
       FROM sync_state
       WHERE user_id = ?;`,
      [userId]
    ),
    database.get<PreferenceRow>(
      `SELECT hexagon_theme, hexagon_variant, hexagon_size, hexagon_custom_depth, hexagon_use_custom_depth
       FROM preferences
       WHERE user_id = ?;`,
      [userId]
    ),
  ]);

  return {
    activeUserId: userId,
    hasAuthSession: Boolean(session),
    authSessionUserId: session?.userId ?? null,
    tableCounts: {
      places: placesCount,
      savedPlaces: savedPlacesCount,
      collections: collectionsCount,
      collectionPlaces: collectionPlacesCount,
      outbox: outboxCount,
      outboxPending: outboxPendingCount,
      syncState: syncStateCount,
    },
    syncState: mapSyncStateRows(syncStateRows),
    preferences: {
      hexagonTheme: preferenceRow?.hexagon_theme ?? null,
      hexagonVariant: preferenceRow?.hexagon_variant ?? null,
      hexagonSize: preferenceRow ? Number(preferenceRow.hexagon_size) : null,
      hexagonCustomDepth: preferenceRow?.hexagon_custom_depth ?? null,
      hexagonUseCustomDepth: preferenceRow
        ? preferenceRow.hexagon_use_custom_depth === 1
        : null,
    },
  };
};

/**
 * Trigger authenticated sync and return the raw result.
 * @returns {Promise<Awaited<ReturnType<typeof syncAuthenticatedData>>>}
 */
export const runDiagnosticsSync = async (): Promise<Awaited<ReturnType<typeof syncAuthenticatedData>>> => {
  return syncAuthenticatedData();
};

/**
 * Wipe all app-local persistence and reset runtime auth scope.
 */
export const wipeDiagnosticsLocalData = async (): Promise<void> => {
  await wipeLocalDataOnSignOut(undefined, { wipeDatabase: true });
  await clearAuthSession();
  resetActiveUserId();
};

/**
 * Create a deterministic local place mutation for e2e flows.
 * @returns {Promise<string | null>}
 */
export const createDiagnosticsPlace = async (): Promise<string | null> => {
  const suffix = Date.now();

  return saveGooglePlace({
    placeId: `e2e-local-place-${suffix}`,
    googlePlaceId: `e2e-local-place-${suffix}`,
    name: `E2E Local Place ${suffix}`,
    type: 'Cafe',
    address: 'E2E Diagnostics Street',
    rating: 4.2,
    reviewCount: 42,
    description: 'Created from diagnostics panel',
    image: null,
    images: [],
    coordinates: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
    saved: false,
    isGooglePlace: false,
  });
};

/**
 * Create a collection and add the latest local place to it.
 * @returns {Promise<boolean>}
 */
export const createDiagnosticsCollectionForLatestPlace = async (): Promise<boolean> => {
  const places = await getPlaces();
  const latestPlace = places[0];

  if (!latestPlace) {
    return false;
  }

  const collection = await createCollection(`E2E Collection ${Date.now()}`, latestPlace.image ?? null);

  if (!collection) {
    return false;
  }

  const updatedCollections = await addPlaceToCollection(collection.id, latestPlace.id);
  return Array.isArray(updatedCollections);
};

/**
 * Remove the latest place from every collection so saved-state becomes false.
 * @returns {Promise<boolean>}
 */
export const removeLatestPlaceFromAllCollections = async (): Promise<boolean> => {
  const places = await getPlaces();
  const latestPlace = places[0];

  if (!latestPlace) {
    return false;
  }

  const collections = await getCollectionsForPlace(latestPlace.id);

  for (const collection of collections) {
    await removePlaceFromCollection(collection.id, latestPlace.id);
  }

  return true;
};

/**
 * Persist a deterministic preference change for e2e assertions.
 * @param theme
 */
export const setDiagnosticsHexagonTheme = async (theme: string): Promise<void> => {
  const current = await loadHexagonPreferences();

  await saveHexagonPreferences({
    ...current,
    hexagonTheme: theme,
  });
};

/**
 * Create a backend-only place mutation so the next sync pull has remote changes.
 * @returns {Promise<string | null>}
 */
export const createDiagnosticsRemotePlaceMutation = async (): Promise<string | null> => {
  const httpOptions = await createAuthenticatedHttpClientOptions();

  if (!httpOptions) {
    return null;
  }

  const userId = getActiveUserId();
  const suffix = Date.now();
  const request = createHttpRequest(httpOptions);

  const response = await request(`/users/${encodeURIComponent(userId)}/places/upsert-google`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `E2E Remote Place ${suffix}`,
      address: 'Remote Diagnostics Avenue',
      latitude: 48.8566,
      longitude: 2.3522,
      googlePlaceId: `e2e-remote-place-${suffix}`,
    }),
  });

  const payload = await readJsonResponse<{ place?: { id?: string } }>(response);
  return payload.place?.id ?? null;
};
