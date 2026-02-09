/**
 * Shared outbox + sync_state helpers.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { OutboxRow, SyncStateRow } from '../../schema/src';
import type {
  PendingSyncMutation,
  SyncState,
  UpdateSyncStateOptions,
} from './types';

interface CreateOutboxEntryOptions {
  userId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  operationId: string;
  payloadJson: string;
}

const ensureUserExists = async (database: DatabaseAdapter, userId: string, timestamp: string): Promise<void> => {
  await database.run(
    `INSERT INTO users (id, provider, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING;`,
    [userId, 'local', timestamp, timestamp]
  );
};

/**
 * Create a new outbox entry for an entity mutation.
 * @param database
 * @param options
 * @returns {Promise<string>} created outbox row ID
 */
export const createOutboxEntry = async (
  database: DatabaseAdapter,
  options: CreateOutboxEntryOptions
): Promise<string> => {
  const timestamp = nowIso();
  const outboxId = createUuid();

  await ensureUserExists(database, options.userId, timestamp);

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
      outboxId,
      options.userId,
      options.operationType,
      options.entityType,
      options.entityId,
      options.payloadJson,
      options.operationId,
      timestamp,
      timestamp,
    ]
  );

  return outboxId;
};

/**
 * Count all pending outbox entries for a specific user and entity type.
 * Unlike listPendingMutations, this is not limited and returns an accurate total.
 * When maxAttempts is provided, only rows with attempts < maxAttempts are counted.
 * @param database
 * @param userId
 * @param entityType
 * @param maxAttempts - optional ceiling; rows with attempts >= this are excluded
 * @returns {Promise<number>}
 */
export const countPendingMutations = async (
  database: DatabaseAdapter,
  userId: string,
  entityType: string,
  maxAttempts?: number
): Promise<number> => {
  const hasAttemptsFilter = maxAttempts !== undefined;
  const sql = `SELECT COUNT(*) as count FROM outbox
     WHERE user_id = ?
       AND entity_type = ?
       AND processed_at IS NULL
       ${hasAttemptsFilter ? 'AND attempts < ?' : ''};`;

  const params: (string | number)[] = hasAttemptsFilter
    ? [userId, entityType, maxAttempts!]
    : [userId, entityType];

  const row = await database.get<{ count: number }>(sql, params);

  return row?.count ?? 0;
};

/**
 * Read pending outbox entries for a specific user and entity type.
 * When maxAttempts is provided, only rows with attempts < maxAttempts are
 * returned so dead-lettered rows cannot starve newer eligible mutations
 * beyond the batch limit.
 * @param database
 * @param userId
 * @param entityType
 * @param limit
 * @param maxAttempts - optional ceiling; rows with attempts >= this are excluded
 * @returns {Promise<PendingSyncMutation[]>}
 */
export const listPendingMutations = async (
  database: DatabaseAdapter,
  userId: string,
  entityType: string,
  limit = 50,
  maxAttempts?: number
): Promise<PendingSyncMutation[]> => {
  const hasAttemptsFilter = maxAttempts !== undefined;
  const sql = `SELECT
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
     FROM outbox
     WHERE user_id = ?
       AND entity_type = ?
       AND processed_at IS NULL
       ${hasAttemptsFilter ? 'AND attempts < ?' : ''}
     ORDER BY created_at ASC
     LIMIT ?;`;

  const params: (string | number)[] = hasAttemptsFilter
    ? [userId, entityType, maxAttempts!, limit]
    : [userId, entityType, limit];

  const rows = await database.all<OutboxRow>(sql, params);

  const mutations: PendingSyncMutation[] = [];

  for (const row of rows) {
    let payload: unknown;

    try {
      payload = JSON.parse(row.payload_json);
    } catch (error) {
      throw new Error(`Invalid outbox payload for row ${row.id}: ${(error as Error).message}`);
    }

    mutations.push({
      outboxId: row.id,
      userId: row.user_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operationType: row.operation_type,
      operationId: row.operation_id,
      payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attempts: Number(row.attempts),
      lastError: row.last_error,
    });
  }

  return mutations;
};

/**
 * Mark an outbox entry as processed.
 * @param database
 * @param outboxId
 */
export const markMutationProcessed = async (database: DatabaseAdapter, outboxId: string): Promise<void> => {
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
 * Mark an outbox entry as failed and increment attempts.
 * @param database
 * @param outboxId
 * @param errorMessage
 */
export const markMutationFailed = async (
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
 * Read sync metadata for a specific user/entity pair.
 * @param database
 * @param userId
 * @param entityType
 * @returns {Promise<SyncState | null>}
 */
export const getSyncState = async (
  database: DatabaseAdapter,
  userId: string,
  entityType: string
): Promise<SyncState | null> => {
  const row = await database.get<SyncStateRow>(
    `SELECT
       user_id,
       entity_type,
       last_pulled_at,
       last_pushed_at,
       remote_cursor,
       last_synced_operation_id,
       updated_at
     FROM sync_state
     WHERE user_id = ?
       AND entity_type = ?;`,
    [userId, entityType]
  );

  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    entityType: row.entity_type,
    lastPulledAt: row.last_pulled_at,
    lastPushedAt: row.last_pushed_at,
    remoteCursor: row.remote_cursor,
    lastSyncedOperationId: row.last_synced_operation_id,
    updatedAt: row.updated_at,
  };
};

/**
 * Upsert sync metadata for a specific user/entity pair.
 * @param database
 * @param options
 * @returns {Promise<SyncState>}
 */
export const updateSyncState = async (
  database: DatabaseAdapter,
  options: UpdateSyncStateOptions
): Promise<SyncState> => {
  const existing = await getSyncState(database, options.userId, options.entityType);

  const nextState: SyncState = {
    userId: options.userId,
    entityType: options.entityType,
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
        entity_type,
        last_pulled_at,
        last_pushed_at,
        remote_cursor,
        last_synced_operation_id,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, entity_type) DO UPDATE SET
        last_pulled_at = excluded.last_pulled_at,
        last_pushed_at = excluded.last_pushed_at,
        remote_cursor = excluded.remote_cursor,
        last_synced_operation_id = excluded.last_synced_operation_id,
        updated_at = excluded.updated_at;`,
      [
        nextState.userId,
        nextState.entityType,
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
