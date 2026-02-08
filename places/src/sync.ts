/**
 * Place sync orchestration (shared engine wrapper).
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
import { applyPlaceSyncOperation } from './repository';
import type { PlaceInput, PlaceSyncOperation } from './types';

const PLACES_ENTITY_TYPE = 'places';

const parsePullEntityOperation = (entity: SyncPullEntity, userId: string): PlaceSyncOperation => {
  if (!entity.data || typeof entity.data !== 'object') {
    throw new Error(`Invalid place pull entity payload for ${entity.entityId}.`);
  }

  const payload = entity.data as Record<string, unknown>;

  if (payload.operationType !== 'upsert' && payload.operationType !== 'delete') {
    throw new Error(`Invalid place operationType for ${entity.entityId}.`);
  }

  const payloadUserId = typeof payload.userId === 'string' ? payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error(`Place pull entity ${entity.entityId} user mismatch.`);
  }

  const payloadPlaceId = typeof payload.placeId === 'string' ? payload.placeId : entity.entityId;
  const payloadUpdatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : entity.updatedAt;

  if (payload.operationType === 'upsert') {
    if (!payload.place || typeof payload.place !== 'object') {
      throw new Error(`Place upsert pull entity ${entity.entityId} is missing place data.`);
    }

    return {
      userId: payloadUserId,
      placeId: payloadPlaceId,
      operationId: entity.operationId,
      operationType: 'upsert',
      updatedAt: payloadUpdatedAt,
      place: payload.place as PlaceInput,
    };
  }

  return {
    userId: payloadUserId,
    placeId: payloadPlaceId,
    operationId: entity.operationId,
    operationType: 'delete',
    updatedAt: payloadUpdatedAt,
    place: null,
  };
};

export interface PushPlaceOutboxOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: SyncRemote;
  maxAttempts?: number;
  batchLimit?: number;
}

export interface PullPlaceUpdatesOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: SyncRemote;
}

export interface SyncPlacesOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: SyncRemote;
  maxAttempts?: number;
  batchLimit?: number;
}

/**
 * Push pending local place mutations to remote backend.
 * @param options
 * @returns {Promise<PushOutboxResult>}
 */
export const pushPlaceOutbox = async (options: PushPlaceOutboxOptions): Promise<PushOutboxResult> => {
  return pushOutbox({
    database: options.database,
    userId: options.userId,
    entityType: PLACES_ENTITY_TYPE,
    remote: options.remote,
    maxAttempts: options.maxAttempts,
    batchLimit: options.batchLimit,
  });
};

/**
 * Pull remote place state and apply via local repository LWW checks.
 * @param options
 * @returns {Promise<PullUpdatesResult>}
 */
export const pullPlaceUpdates = async (options: PullPlaceUpdatesOptions): Promise<PullUpdatesResult> => {
  return pullUpdates({
    database: options.database,
    userId: options.userId,
    entityType: PLACES_ENTITY_TYPE,
    remote: options.remote,
    applyRemoteEntity: async (entity) => {
      const operation = parsePullEntityOperation(entity, options.userId);
      const result = await applyPlaceSyncOperation(options.database, operation);

      return {
        applied: result.applied,
      };
    },
  });
};

/**
 * Run push then pull for places.
 * @param options
 * @returns {Promise<RunSyncResult>}
 */
export const syncPlaces = async (options: SyncPlacesOptions): Promise<RunSyncResult> => {
  return runSync({
    database: options.database,
    userId: options.userId,
    entityType: PLACES_ENTITY_TYPE,
    remote: options.remote,
    maxAttempts: options.maxAttempts,
    batchLimit: options.batchLimit,
    applyRemoteEntity: async (entity) => {
      const operation = parsePullEntityOperation(entity, options.userId);
      const result = await applyPlaceSyncOperation(options.database, operation);

      return {
        applied: result.applied,
      };
    },
  });
};

export type { PushOutboxResult as PushPlaceOutboxResult, PullUpdatesResult as PullPlaceUpdatesResult, RunSyncResult as SyncPlacesResult };
