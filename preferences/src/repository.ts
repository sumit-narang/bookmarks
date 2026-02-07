/**
 * Local preference persistence and outbox helpers.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { PreferenceRow, SyncStateRow } from '../../schema/src';
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
  id: string;
  user_id: string;
  operation_id: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
  attempts: number;
}

interface PreferencePayload {
  userId: string;
  updatedAt: string;
  preferences: HexagonPreferencesValues;
}

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
     LEFT JOIN sync_state s ON s.user_id = p.user_id
     WHERE p.user_id = ?;`,
    [userId]
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
  await database.run(
    `INSERT INTO sync_state (
      user_id,
      last_pulled_at,
      last_pushed_at,
      remote_cursor,
      last_synced_operation_id,
      updated_at
    )
    VALUES (?, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      last_synced_operation_id = excluded.last_synced_operation_id,
      updated_at = excluded.updated_at;`,
    [userId, operationId, updatedAt]
  );
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
  const createdAt = nowIso();
  const payload = JSON.stringify({
    userId,
    updatedAt,
    preferences,
  });

  await database.run(
    `INSERT INTO outbox (
      id,
      user_id,
      operation_type,
      entity_type,
      entity_id,
      payload_json,
      operation_id,
      created_at,
      updated_at,
      attempts,
      last_error,
      processed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL);`,
    [
      createUuid(),
      userId,
      'upsert',
      'preferences',
      userId,
      payload,
      operationId,
      createdAt,
      createdAt,
    ]
  );
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
  limit = 50
): Promise<PreferenceOutboxMutation[]> => {
  const rows = await database.all<PendingOutboxRow>(
    `SELECT
       id,
       user_id,
       operation_id,
       payload_json,
       created_at,
       updated_at,
       attempts
     FROM outbox
     WHERE user_id = ?
       AND entity_type = 'preferences'
       AND processed_at IS NULL
     ORDER BY created_at ASC
     LIMIT ?;`,
    [userId, limit]
  );

  const mutations: PreferenceOutboxMutation[] = [];

  for (const row of rows) {
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(row.payload_json);
    } catch (error) {
      throw new Error(`Invalid preference outbox payload for row ${row.id}: ${(error as Error).message}`);
    }

    if (!isPreferencePayload(parsedPayload)) {
      throw new Error(`Invalid preference outbox shape for row ${row.id}.`);
    }

    mutations.push({
      outboxId: row.id,
      userId: row.user_id,
      operationId: row.operation_id,
      createdAt: row.created_at,
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
  const timestamp = nowIso();

  await database.run(
    `UPDATE outbox
     SET processed_at = ?,
         updated_at = ?,
         last_error = NULL
     WHERE id = ?;`,
    [timestamp, timestamp, outboxId]
  );
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
  const timestamp = nowIso();

  await database.run(
    `UPDATE outbox
     SET attempts = attempts + 1,
         last_error = ?,
         updated_at = ?
     WHERE id = ?;`,
    [errorMessage, timestamp, outboxId]
  );
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
  const row = await database.get<SyncStateRow>(
    `SELECT
       user_id,
       last_pulled_at,
       last_pushed_at,
       remote_cursor,
       last_synced_operation_id,
       updated_at
     FROM sync_state
     WHERE user_id = ?;`,
    [userId]
  );

  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    lastPulledAt: row.last_pulled_at,
    lastPushedAt: row.last_pushed_at,
    remoteCursor: row.remote_cursor,
    lastSyncedOperationId: row.last_synced_operation_id,
    updatedAt: row.updated_at,
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
  const existing = await getPreferenceSyncState(database, options.userId);

  const nextState: PreferenceSyncState = {
    userId: options.userId,
    lastPulledAt: existing?.lastPulledAt ?? null,
    lastPushedAt: existing?.lastPushedAt ?? null,
    remoteCursor: existing?.remoteCursor ?? null,
    lastSyncedOperationId: existing?.lastSyncedOperationId ?? null,
    updatedAt: options.updatedAt ?? nowIso(),
  };

  if ('lastPulledAt' in options) {
    nextState.lastPulledAt = options.lastPulledAt ?? null;
  }

  if ('lastPushedAt' in options) {
    nextState.lastPushedAt = options.lastPushedAt ?? null;
  }

  if ('remoteCursor' in options) {
    nextState.remoteCursor = options.remoteCursor ?? null;
  }

  if ('lastSyncedOperationId' in options) {
    nextState.lastSyncedOperationId = options.lastSyncedOperationId ?? null;
  }

  await database.transaction(async (tx) => {
    await ensureUserExists(tx, options.userId, nextState.updatedAt);

    await tx.run(
      `INSERT INTO sync_state (
        user_id,
        last_pulled_at,
        last_pushed_at,
        remote_cursor,
        last_synced_operation_id,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_pulled_at = excluded.last_pulled_at,
        last_pushed_at = excluded.last_pushed_at,
        remote_cursor = excluded.remote_cursor,
        last_synced_operation_id = excluded.last_synced_operation_id,
        updated_at = excluded.updated_at;`,
      [
        nextState.userId,
        nextState.lastPulledAt,
        nextState.lastPushedAt,
        nextState.remoteCursor,
        nextState.lastSyncedOperationId,
        nextState.updatedAt,
      ]
    );
  });

  return nextState;
};

export { toHexagonPreferenceValues };
