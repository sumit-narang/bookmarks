/**
 * Local preference persistence and outbox helpers.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { PreferenceRow } from '../../schema/src';
import {
  createOutboxEntry,
  getSyncState,
  listPendingMutations,
  markMutationFailed,
  markMutationProcessed,
  updateSyncState,
} from '../../sync/src';
import { defaultHexagonPreferences } from './defaults';
import {
  mergeHexagonPreferences,
  normalizeHexagonPreferences,
} from './validation';
import type {
  HexagonPreferences,
  HexagonPreferencesPatch,
  HexagonPreferencesValues,
  PreferenceOutboxMutation,
  PreferenceSyncOperation,
  PreferenceSyncState,
} from './types';

interface PreferenceWithVersionRow extends PreferenceRow {
  last_synced_operation_id: string | null;
}

interface PendingOutboxRow {
  outboxId: string;
  userId: string;
  operationId: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
}

interface PreferencePayload {
  userId: string;
  updatedAt: string;
  preferences: HexagonPreferencesValues;
}

const PREFERENCES_ENTITY_TYPE = 'preferences';

const ensureUserExists = async (database: DatabaseAdapter, userId: string, timestamp: string): Promise<void> => {
  await database.run(
    `INSERT INTO users (id, provider, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING;`,
    [userId, 'local', timestamp, timestamp]
  );
};

const mapRowToPreferences = (row: PreferenceWithVersionRow): HexagonPreferences => {
  return {
    userId: row.user_id,
    hexagonTheme: row.hexagon_theme,
    hexagonVariant: row.hexagon_variant,
    hexagonSize: Number(row.hexagon_size),
    hexagonCustomDepth: row.hexagon_custom_depth === null ? null : Number(row.hexagon_custom_depth),
    hexagonUseCustomDepth: row.hexagon_use_custom_depth === 1,
    updatedAt: row.updated_at,
    operationId: row.last_synced_operation_id,
  };
};

const toHexagonPreferenceValues = (
  preferences: Pick<HexagonPreferences, keyof HexagonPreferencesValues>
): HexagonPreferencesValues => {
  return {
    hexagonTheme: preferences.hexagonTheme,
    hexagonVariant: preferences.hexagonVariant,
    hexagonSize: preferences.hexagonSize,
    hexagonCustomDepth: preferences.hexagonCustomDepth,
    hexagonUseCustomDepth: preferences.hexagonUseCustomDepth,
  };
};

const readPreferencesRow = async (database: DatabaseAdapter, userId: string): Promise<HexagonPreferences | null> => {
  const row = await database.get<PreferenceWithVersionRow>(
    `SELECT
       p.user_id,
       p.hexagon_theme,
       p.hexagon_variant,
       p.hexagon_size,
       p.hexagon_custom_depth,
       p.hexagon_use_custom_depth,
       p.updated_at,
       s.last_synced_operation_id
     FROM preferences p
     LEFT JOIN sync_state s ON s.user_id = p.user_id AND s.entity_type = ?
     WHERE p.user_id = ?;`,
    [PREFERENCES_ENTITY_TYPE, userId]
  );

  if (!row) {
    return null;
  }

  return mapRowToPreferences(row);
};

const writePreferenceRow = async (
  database: DatabaseAdapter,
  userId: string,
  values: HexagonPreferencesValues,
  updatedAt: string
): Promise<void> => {
  await database.run(
    `INSERT INTO preferences (
      user_id,
      hexagon_theme,
      hexagon_variant,
      hexagon_size,
      hexagon_custom_depth,
      hexagon_use_custom_depth,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      hexagon_theme = excluded.hexagon_theme,
      hexagon_variant = excluded.hexagon_variant,
      hexagon_size = excluded.hexagon_size,
      hexagon_custom_depth = excluded.hexagon_custom_depth,
      hexagon_use_custom_depth = excluded.hexagon_use_custom_depth,
      updated_at = excluded.updated_at;`,
    [
      userId,
      values.hexagonTheme,
      values.hexagonVariant,
      values.hexagonSize,
      values.hexagonCustomDepth,
      values.hexagonUseCustomDepth ? 1 : 0,
      updatedAt,
    ]
  );
};

const writeSyncVersion = async (
  database: DatabaseAdapter,
  userId: string,
  operationId: string | null,
  updatedAt: string
): Promise<void> => {
  await updateSyncState(database, {
    userId,
    entityType: PREFERENCES_ENTITY_TYPE,
    lastSyncedOperationId: operationId,
    updatedAt,
  });
};

const isPreferencePayload = (payload: unknown): payload is PreferencePayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  const values = candidate.preferences;

  if (!values || typeof values !== 'object') {
    return false;
  }

  const preferenceValues = values as Record<string, unknown>;

  return typeof candidate.userId === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof preferenceValues.hexagonTheme === 'string'
    && typeof preferenceValues.hexagonVariant === 'string'
    && typeof preferenceValues.hexagonSize === 'number'
    && (typeof preferenceValues.hexagonCustomDepth === 'number' || preferenceValues.hexagonCustomDepth === null)
    && typeof preferenceValues.hexagonUseCustomDepth === 'boolean';
};

const createOutboxMutation = async (
  database: DatabaseAdapter,
  userId: string,
  operationId: string,
  updatedAt: string,
  preferences: HexagonPreferencesValues
): Promise<void> => {
  await createOutboxEntry(database, {
    userId,
    entityType: PREFERENCES_ENTITY_TYPE,
    entityId: userId,
    operationType: 'upsert',
    operationId,
    payloadJson: JSON.stringify({
      userId,
      updatedAt,
      preferences,
    }),
  });
};

/**
 * Compare two preference versions by timestamp + operation ID.
 * @param left
 * @param right
 * @returns {number}
 */
export const comparePreferenceVersions = (
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

/**
 * Read preferences for a user.
 * @param database
 * @param userId
 * @returns {Promise<HexagonPreferences | null>}
 */
export const getPreferences = async (database: DatabaseAdapter, userId: string): Promise<HexagonPreferences | null> => {
  return readPreferencesRow(database, userId);
};

/**
 * Read or initialize preferences for a user.
 * @param database
 * @param userId
 * @returns {Promise<HexagonPreferences>}
 */
export const getOrCreatePreferences = async (database: DatabaseAdapter, userId: string): Promise<HexagonPreferences> => {
  const existing = await readPreferencesRow(database, userId);

  if (existing) {
    return existing;
  }

  const timestamp = nowIso();
  const values = normalizeHexagonPreferences(defaultHexagonPreferences);

  await database.transaction(async (tx) => {
    await ensureUserExists(tx, userId, timestamp);
    await writePreferenceRow(tx, userId, values, timestamp);
    await writeSyncVersion(tx, userId, null, timestamp);
  });

  const created = await readPreferencesRow(database, userId);

  if (!created) {
    throw new Error(`Failed to initialize preferences for user ${userId}.`);
  }

  return created;
};

export interface SetPreferencesOptions {
  userId: string;
  patch: HexagonPreferencesPatch;
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/**
 * Upsert user preferences and queue a sync mutation by default.
 * @param database
 * @param options
 * @returns {Promise<HexagonPreferences>}
 */
export const setPreferences = async (
  database: DatabaseAdapter,
  options: SetPreferencesOptions
): Promise<HexagonPreferences> => {
  const shouldRecordOutbox = options.recordOutbox ?? true;
  const updatedAt = options.updatedAt ?? nowIso();

  let nextPreferences: HexagonPreferences | null = null;

  await database.transaction(async (tx) => {
    const current = await readPreferencesRow(tx, options.userId);
    const baseValues = current ? toHexagonPreferenceValues(current) : defaultHexagonPreferences;
    const mergedValues = mergeHexagonPreferences(baseValues, options.patch);
    const normalizedValues = normalizeHexagonPreferences(mergedValues);

    const nextOperationId = options.operationId === undefined
      ? (shouldRecordOutbox ? createUuid() : current?.operationId ?? null)
      : options.operationId;

    await ensureUserExists(tx, options.userId, updatedAt);
    await writePreferenceRow(tx, options.userId, normalizedValues, updatedAt);
    await writeSyncVersion(tx, options.userId, nextOperationId, updatedAt);

    if (shouldRecordOutbox && nextOperationId) {
      await createOutboxMutation(tx, options.userId, nextOperationId, updatedAt, normalizedValues);
    }

    nextPreferences = {
      userId: options.userId,
      ...normalizedValues,
      updatedAt,
      operationId: nextOperationId,
    };
  });

  if (!nextPreferences) {
    throw new Error(`Failed to set preferences for user ${options.userId}.`);
  }

  return nextPreferences;
};

/**
 * Apply a remote sync operation if it is newer than current local version.
 * @param database
 * @param operation
 * @returns {Promise<{ applied: boolean; preferences: HexagonPreferences }>}
 */
export const applyPreferenceSyncOperation = async (
  database: DatabaseAdapter,
  operation: PreferenceSyncOperation
): Promise<{ applied: boolean; preferences: HexagonPreferences }> => {
  let applied = false;
  let finalPreferences: HexagonPreferences | null = null;

  await database.transaction(async (tx) => {
    const current = await readPreferencesRow(tx, operation.userId);

    if (current) {
      const comparison = comparePreferenceVersions(
        {
          updatedAt: operation.updatedAt,
          operationId: operation.operationId,
        },
        {
          updatedAt: current.updatedAt,
          operationId: current.operationId,
        }
      );

      if (comparison <= 0) {
        finalPreferences = current;
        return;
      }
    }

    const normalizedValues = normalizeHexagonPreferences(operation.preferences);

    await ensureUserExists(tx, operation.userId, operation.updatedAt);
    await writePreferenceRow(tx, operation.userId, normalizedValues, operation.updatedAt);
    await writeSyncVersion(tx, operation.userId, operation.operationId, operation.updatedAt);

    applied = true;
    finalPreferences = {
      userId: operation.userId,
      ...normalizedValues,
      updatedAt: operation.updatedAt,
      operationId: operation.operationId,
    };
  });

  if (!finalPreferences) {
    const fallback = await getOrCreatePreferences(database, operation.userId);
    return { applied, preferences: fallback };
  }

  return {
    applied,
    preferences: finalPreferences,
  };
};

/**
 * Read all pending preference mutations from the local outbox.
 * @param database
 * @param userId
 * @param limit
 * @returns {Promise<PreferenceOutboxMutation[]>}
 */
export const listPendingPreferenceMutations = async (
  database: DatabaseAdapter,
  userId: string,
  limit = 50,
  maxAttempts?: number
): Promise<PreferenceOutboxMutation[]> => {
  const pendingMutations = await listPendingMutations(database, userId, PREFERENCES_ENTITY_TYPE, limit, maxAttempts);
  const rows: PendingOutboxRow[] = pendingMutations.map((mutation) => {
    return {
      outboxId: mutation.outboxId,
      userId: mutation.userId,
      operationId: mutation.operationId,
      payload: mutation.payload,
      createdAt: mutation.createdAt,
      attempts: mutation.attempts,
    };
  });

  const mutations: PreferenceOutboxMutation[] = [];

  for (const row of rows) {
    const parsedPayload = row.payload;

    if (!isPreferencePayload(parsedPayload)) {
      throw new Error(`Invalid preference outbox shape for row ${row.outboxId}.`);
    }

    mutations.push({
      outboxId: row.outboxId,
      userId: row.userId,
      operationId: row.operationId,
      createdAt: row.createdAt,
      updatedAt: parsedPayload.updatedAt,
      attempts: Number(row.attempts),
      preferences: normalizeHexagonPreferences(parsedPayload.preferences),
    });
  }

  return mutations;
};

/**
 * Mark an outbox mutation as processed.
 * @param database
 * @param outboxId
 */
export const markPreferenceMutationProcessed = async (database: DatabaseAdapter, outboxId: string): Promise<void> => {
  await markMutationProcessed(database, outboxId);
};

/**
 * Mark an outbox mutation as failed and increment retry attempts.
 * @param database
 * @param outboxId
 * @param errorMessage
 */
export const markPreferenceMutationFailed = async (
  database: DatabaseAdapter,
  outboxId: string,
  errorMessage: string
): Promise<void> => {
  await markMutationFailed(database, outboxId, errorMessage);
};

/**
 * Read sync metadata for preferences.
 * @param database
 * @param userId
 * @returns {Promise<PreferenceSyncState | null>}
 */
export const getPreferenceSyncState = async (
  database: DatabaseAdapter,
  userId: string
): Promise<PreferenceSyncState | null> => {
  const row = await getSyncState(database, userId, PREFERENCES_ENTITY_TYPE);

  if (!row) {
    return null;
  }

  return {
    userId: row.userId,
    lastPulledAt: row.lastPulledAt,
    lastPushedAt: row.lastPushedAt,
    remoteCursor: row.remoteCursor,
    lastSyncedOperationId: row.lastSyncedOperationId,
    updatedAt: row.updatedAt,
  };
};

export interface UpdatePreferenceSyncStateOptions {
  userId: string;
  lastPulledAt?: string | null;
  lastPushedAt?: string | null;
  remoteCursor?: string | null;
  lastSyncedOperationId?: string | null;
  updatedAt?: string;
}

/**
 * Upsert preference sync metadata.
 * @param database
 * @param options
 * @returns {Promise<PreferenceSyncState>}
 */
export const updatePreferenceSyncState = async (
  database: DatabaseAdapter,
  options: UpdatePreferenceSyncStateOptions
): Promise<PreferenceSyncState> => {
  const nextState = await updateSyncState(database, {
    userId: options.userId,
    entityType: PREFERENCES_ENTITY_TYPE,
    lastPulledAt: options.lastPulledAt,
    lastPushedAt: options.lastPushedAt,
    remoteCursor: options.remoteCursor,
    lastSyncedOperationId: options.lastSyncedOperationId,
    updatedAt: options.updatedAt,
  });

  return {
    userId: nextState.userId,
    lastPulledAt: nextState.lastPulledAt,
    lastPushedAt: nextState.lastPushedAt,
    remoteCursor: nextState.remoteCursor,
    lastSyncedOperationId: nextState.lastSyncedOperationId,
    updatedAt: nextState.updatedAt,
  };
};

export { toHexagonPreferenceValues };
