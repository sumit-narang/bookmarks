/**
 * Shared push/pull sync orchestration.
 */

import { nowIso } from '../../core/src';
import {
  countPendingMutations,
  getSyncState,
  listPendingMutations,
  markMutationFailed,
  markMutationProcessed,
  updateSyncState,
} from './outbox';
import type {
  PullUpdatesOptions,
  PullUpdatesResult,
  PushOutboxOptions,
  PushOutboxResult,
  RunSyncOptions,
  RunSyncResult,
  SyncOperation,
  SyncPullEntity,
} from './types';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_LIMIT = 50;

const compareEntityVersions = (
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

const getLatestPulledEntity = (entities: SyncPullEntity[]): SyncPullEntity | null => {
  let latest: SyncPullEntity | null = null;

  for (const entity of entities) {
    if (!latest) {
      latest = entity;
      continue;
    }

    if (
      compareEntityVersions(
        {
          updatedAt: entity.updatedAt,
          operationId: entity.operationId,
        },
        {
          updatedAt: latest.updatedAt,
          operationId: latest.operationId,
        }
      ) > 0
    ) {
      latest = entity;
    }
  }

  return latest;
};

const extractMutationUpdatedAt = (payload: unknown, outboxId: string): string => {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Outbox payload for row ${outboxId} must be an object with updatedAt.`);
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.updatedAt !== 'string') {
    throw new Error(`Outbox payload for row ${outboxId} is missing updatedAt.`);
  }

  return candidate.updatedAt;
};

/**
 * Push pending outbox mutations for one entity type.
 * @param options
 * @returns {Promise<PushOutboxResult>}
 */
export const pushOutbox = async (options: PushOutboxOptions): Promise<PushOutboxResult> => {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;

  // Count all pending rows (unlimited) and eligible rows (unlimited) for accurate
  // reporting, then fetch the batch-limited eligible rows for actual push.
  // skippedDeadLetterCount uses unlimited counts so it is correct even when
  // eligible rows exceed batchLimit.
  const totalPending = await countPendingMutations(options.database, options.userId, options.entityType);
  const totalEligible = await countPendingMutations(options.database, options.userId, options.entityType, maxAttempts);
  const eligibleMutations = await listPendingMutations(options.database, options.userId, options.entityType, batchLimit, maxAttempts);
  const deadLetterCount = totalPending - totalEligible;

  if (eligibleMutations.length === 0) {
    return {
      pendingCount: totalPending,
      eligibleCount: 0,
      pushedCount: 0,
      skippedDeadLetterCount: deadLetterCount,
    };
  }

  const operations: SyncOperation[] = eligibleMutations.map((mutation) => {
    return {
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      operationId: mutation.operationId,
      operationType: mutation.operationType,
      updatedAt: extractMutationUpdatedAt(mutation.payload, mutation.outboxId),
      payload: mutation.payload,
    };
  });

  try {
    const response = await options.remote.pushOperations(options.userId, options.entityType, operations);
    const appliedSet = new Set(response.appliedOperationIds);
    const marksAllApplied = appliedSet.size === 0;
    let pushedCount = 0;

    for (const mutation of eligibleMutations) {
      if (marksAllApplied || appliedSet.has(mutation.operationId)) {
        await markMutationProcessed(options.database, mutation.outboxId);
        pushedCount += 1;
      }
    }

    await updateSyncState(options.database, {
      userId: options.userId,
      entityType: options.entityType,
      lastPushedAt: response.serverTimestamp,
      lastSyncedOperationId: response.latestOperationId,
      updatedAt: response.serverTimestamp,
    });

    return {
      pendingCount: totalPending,
      eligibleCount: totalEligible,
      pushedCount,
      skippedDeadLetterCount: deadLetterCount,
    };
  } catch (error) {
    const message = (error as Error).message;

    for (const mutation of eligibleMutations) {
      await markMutationFailed(options.database, mutation.outboxId, message);
    }

    throw error;
  }
};

/**
 * Pull remote entity state for one entity type.
 * @param options
 * @returns {Promise<PullUpdatesResult>}
 */
export const pullUpdates = async (options: PullUpdatesOptions): Promise<PullUpdatesResult> => {
  const syncState = await getSyncState(options.database, options.userId, options.entityType);
  const cursor = syncState?.remoteCursor ?? null;
  const response = await options.remote.pullEntities(options.userId, options.entityType, cursor);

  let appliedCount = 0;

  for (const entity of response.entities) {
    const result = await options.applyRemoteEntity(entity);

    if (result && result.applied) {
      appliedCount += 1;
    }
  }

  const latestPulledEntity = getLatestPulledEntity(response.entities);
  const pullTimestamp = nowIso();
  const nextCursor = response.cursor ?? cursor;

  await updateSyncState(options.database, {
    userId: options.userId,
    entityType: options.entityType,
    lastPulledAt: pullTimestamp,
    remoteCursor: nextCursor,
    lastSyncedOperationId: latestPulledEntity?.operationId ?? syncState?.lastSyncedOperationId ?? null,
    updatedAt: pullTimestamp,
  });

  return {
    fetchedCount: response.entities.length,
    appliedCount,
    cursor: nextCursor,
  };
};

/**
 * Run push then pull for one entity type.
 * @param options
 * @returns {Promise<RunSyncResult>}
 */
export const runSync = async (options: RunSyncOptions): Promise<RunSyncResult> => {
  const pushResult = await pushOutbox({
    database: options.database,
    userId: options.userId,
    entityType: options.entityType,
    remote: options.remote,
    maxAttempts: options.maxAttempts,
    batchLimit: options.batchLimit,
  });

  const pullResult = await pullUpdates({
    database: options.database,
    userId: options.userId,
    entityType: options.entityType,
    remote: options.remote,
    applyRemoteEntity: options.applyRemoteEntity,
  });

  return {
    push: pushResult,
    pull: pullResult,
  };
};
