/**
 * Collection sync orchestration (shared engine wrapper).
 */

import type { DatabaseAdapter } from '../../db/src';
import {
  pullUpdates,
  pushOutbox,
  runSync,
  type PullUpdatesResult,
  type PushOutboxResult,
  type RunSyncResult,
  type SyncPullEntity,
  type SyncRemote,
} from '../../sync/src';
import { applyCollectionSyncOperation } from './repository';
import type { CollectionInput, CollectionSyncOperation } from './types';

const COLLECTIONS_ENTITY_TYPE = 'collections';

const parsePullEntityOperation = (entity: SyncPullEntity, userId: string): CollectionSyncOperation => {
  if (!entity.data || typeof entity.data !== 'object') {
    throw new Error(`Invalid collection pull entity payload for ${entity.entityId}.`);
  }

  const payload = entity.data as Record<string, unknown>;

  if (
    payload.operationType !== 'create'
    && payload.operationType !== 'update'
    && payload.operationType !== 'delete'
    && payload.operationType !== 'add-place'
    && payload.operationType !== 'remove-place'
    && payload.operationType !== 'upsert'
  ) {
    throw new Error(`Invalid collection operationType for ${entity.entityId}.`);
  }

  const payloadUserId = typeof payload.userId === 'string' ? payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error(`Collection pull entity ${entity.entityId} user mismatch.`);
  }

  const payloadCollectionId = typeof payload.collectionId === 'string' ? payload.collectionId : entity.entityId;
  const payloadUpdatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : entity.updatedAt;
  const payloadPlaceId = typeof payload.placeId === 'string' ? payload.placeId : null;

  let payloadCollection: CollectionInput | null = null;

  if (payload.collection !== null && payload.collection !== undefined) {
    if (!payload.collection || typeof payload.collection !== 'object') {
      throw new Error(`Collection pull entity ${entity.entityId} has invalid collection payload.`);
    }

    payloadCollection = payload.collection as CollectionInput;
  }

  let payloadPlaceIds: string[] | undefined;

  if (payload.placeIds !== undefined) {
    if (!Array.isArray(payload.placeIds)) {
      throw new Error(`Collection pull entity ${entity.entityId} has invalid placeIds payload.`);
    }

    payloadPlaceIds = payload.placeIds.map((placeId) => {
      if (typeof placeId !== 'string') {
        throw new Error(`Collection pull entity ${entity.entityId} includes non-string placeIds entry.`);
      }

      return placeId;
    });
  }

  return {
    userId: payloadUserId,
    collectionId: payloadCollectionId,
    operationId: entity.operationId,
    operationType: payload.operationType,
    updatedAt: payloadUpdatedAt,
    collection: payloadCollection,
    placeId: payloadPlaceId,
    placeIds: payloadPlaceIds,
  };
};

export interface PushCollectionOutboxOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: SyncRemote;
  maxAttempts?: number;
  batchLimit?: number;
}

export interface PullCollectionUpdatesOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: SyncRemote;
}

export interface SyncCollectionsOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: SyncRemote;
  maxAttempts?: number;
  batchLimit?: number;
}

/**
 * Push pending local collection mutations to remote backend.
 * @param options
 * @returns {Promise<PushOutboxResult>}
 */
export const pushCollectionOutbox = async (options: PushCollectionOutboxOptions): Promise<PushOutboxResult> => {
  return pushOutbox({
    database: options.database,
    userId: options.userId,
    entityType: COLLECTIONS_ENTITY_TYPE,
    remote: options.remote,
    maxAttempts: options.maxAttempts,
    batchLimit: options.batchLimit,
  });
};

/**
 * Pull remote collection state and apply via local repository LWW checks.
 * @param options
 * @returns {Promise<PullUpdatesResult>}
 */
export const pullCollectionUpdates = async (
  options: PullCollectionUpdatesOptions
): Promise<PullUpdatesResult> => {
  return pullUpdates({
    database: options.database,
    userId: options.userId,
    entityType: COLLECTIONS_ENTITY_TYPE,
    remote: options.remote,
    applyRemoteEntity: async (entity) => {
      const operation = parsePullEntityOperation(entity, options.userId);
      const result = await applyCollectionSyncOperation(options.database, operation);

      return {
        applied: result.applied,
      };
    },
  });
};

/**
 * Run push then pull for collections.
 * @param options
 * @returns {Promise<RunSyncResult>}
 */
export const syncCollections = async (options: SyncCollectionsOptions): Promise<RunSyncResult> => {
  return runSync({
    database: options.database,
    userId: options.userId,
    entityType: COLLECTIONS_ENTITY_TYPE,
    remote: options.remote,
    maxAttempts: options.maxAttempts,
    batchLimit: options.batchLimit,
    applyRemoteEntity: async (entity) => {
      const operation = parsePullEntityOperation(entity, options.userId);
      const result = await applyCollectionSyncOperation(options.database, operation);

      return {
        applied: result.applied,
      };
    },
  });
};

export type {
  PushOutboxResult as PushCollectionOutboxResult,
  PullUpdatesResult as PullCollectionUpdatesResult,
  RunSyncResult as SyncCollectionsResult,
};
