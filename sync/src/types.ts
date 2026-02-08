/**
 * Shared entity-agnostic sync contracts.
 */

import type { DatabaseAdapter } from '../../db/src';

export interface SyncOperation {
  entityType: string;
  entityId: string;
  operationId: string;
  operationType: string;
  updatedAt: string;
  payload: unknown;
}

export interface SyncPullEntity {
  entityId: string;
  updatedAt: string;
  operationId: string;
  data: unknown;
}

export interface SyncPushResponse {
  appliedOperationIds: string[];
  latestOperationId: string | null;
  serverTimestamp: string;
}

export interface SyncPullResponse {
  entities: SyncPullEntity[];
  cursor: string | null;
}

export interface SyncRemote {
  pushOperations(userId: string, entityType: string, operations: SyncOperation[]): Promise<SyncPushResponse>;
  pullEntities(userId: string, entityType: string, cursor: string | null): Promise<SyncPullResponse>;
}

export interface SyncState {
  userId: string;
  entityType: string;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  remoteCursor: string | null;
  lastSyncedOperationId: string | null;
  updatedAt: string;
}

export interface UpdateSyncStateOptions {
  userId: string;
  entityType: string;
  lastPulledAt?: string | null;
  lastPushedAt?: string | null;
  remoteCursor?: string | null;
  lastSyncedOperationId?: string | null;
  updatedAt?: string;
}

export interface PendingSyncMutation {
  outboxId: string;
  userId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  operationId: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface SyncEngineOptions {
  maxAttempts?: number;
  batchLimit?: number;
}

export interface PushOutboxOptions extends SyncEngineOptions {
  database: DatabaseAdapter;
  userId: string;
  entityType: string;
  remote: SyncRemote;
}

export interface PullUpdatesOptions {
  database: DatabaseAdapter;
  userId: string;
  entityType: string;
  remote: SyncRemote;
  applyRemoteEntity(entity: SyncPullEntity): Promise<{ applied: boolean } | void>;
}

export interface RunSyncOptions extends SyncEngineOptions {
  database: DatabaseAdapter;
  userId: string;
  entityType: string;
  remote: SyncRemote;
  applyRemoteEntity(entity: SyncPullEntity): Promise<{ applied: boolean } | void>;
}

export interface PushOutboxResult {
  pendingCount: number;
  eligibleCount: number;
  pushedCount: number;
  skippedDeadLetterCount: number;
}

export interface PullUpdatesResult {
  fetchedCount: number;
  appliedCount: number;
  cursor: string | null;
}

export interface RunSyncResult {
  push: PushOutboxResult;
  pull: PullUpdatesResult;
}
