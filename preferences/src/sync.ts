/**
 * Preference sync orchestration (push pending outbox + pull remote state).
 */

import { nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import {
  comparePreferenceVersions,
  getOrCreatePreferences,
  getPreferenceSyncState,
  listPendingPreferenceMutations,
  markPreferenceMutationFailed,
  markPreferenceMutationProcessed,
  setPreferences,
  updatePreferenceSyncState,
} from './repository';
import type {
  PreferenceSyncOperation,
  PreferenceSyncPullResponse,
  PreferenceSyncPushResponse,
} from './types';

export interface PreferenceSyncRemote {
  pushPreferenceOperations(userId: string, operations: PreferenceSyncOperation[]): Promise<PreferenceSyncPushResponse>;
  pullPreferences(userId: string, cursor: string | null): Promise<PreferenceSyncPullResponse>;
}

export interface PushPreferenceOutboxOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: PreferenceSyncRemote;
  limit?: number;
}

export interface PullPreferenceUpdatesOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: PreferenceSyncRemote;
}

export interface SyncPreferencesOptions {
  database: DatabaseAdapter;
  userId: string;
  remote: PreferenceSyncRemote;
  limit?: number;
}

export interface PushPreferenceOutboxResult {
  pendingCount: number;
  pushedCount: number;
}

export interface PullPreferenceUpdatesResult {
  hadRemotePreference: boolean;
  appliedRemotePreference: boolean;
  cursor: string | null;
}

export interface SyncPreferencesResult {
  push: PushPreferenceOutboxResult;
  pull: PullPreferenceUpdatesResult;
}

/**
 * Push pending local preference mutations to remote backend.
 * @param options
 * @returns {Promise<PushPreferenceOutboxResult>}
 */
export const pushPreferenceOutbox = async (
  options: PushPreferenceOutboxOptions
): Promise<PushPreferenceOutboxResult> => {
  const pending = await listPendingPreferenceMutations(options.database, options.userId, options.limit ?? 50);

  if (pending.length === 0) {
    return {
      pendingCount: 0,
      pushedCount: 0,
    };
  }

  const operations: PreferenceSyncOperation[] = pending.map((mutation) => {
    return {
      userId: mutation.userId,
      operationId: mutation.operationId,
      updatedAt: mutation.updatedAt,
      preferences: mutation.preferences,
    };
  });

  try {
    const response = await options.remote.pushPreferenceOperations(options.userId, operations);
    const appliedSet = new Set(response.appliedOperationIds);
    const marksAllApplied = appliedSet.size === 0;

    let pushedCount = 0;

    for (const mutation of pending) {
      if (marksAllApplied || appliedSet.has(mutation.operationId)) {
        await markPreferenceMutationProcessed(options.database, mutation.outboxId);
        pushedCount += 1;
      }
    }

    await updatePreferenceSyncState(options.database, {
      userId: options.userId,
      lastPushedAt: response.serverTimestamp,
      lastSyncedOperationId: response.latestOperationId,
      updatedAt: response.serverTimestamp,
    });

    return {
      pendingCount: pending.length,
      pushedCount,
    };
  } catch (error) {
    const message = (error as Error).message;

    for (const mutation of pending) {
      await markPreferenceMutationFailed(options.database, mutation.outboxId, message);
    }

    throw error;
  }
};

/**
 * Pull remote preference state and apply if newer than local.
 * @param options
 * @returns {Promise<PullPreferenceUpdatesResult>}
 */
export const pullPreferenceUpdates = async (
  options: PullPreferenceUpdatesOptions
): Promise<PullPreferenceUpdatesResult> => {
  const syncState = await getPreferenceSyncState(options.database, options.userId);
  const cursor = syncState?.remoteCursor ?? null;
  const response = await options.remote.pullPreferences(options.userId, cursor);
  const localPreferences = await getOrCreatePreferences(options.database, options.userId);

  let appliedRemotePreference = false;

  if (response.preference) {
    const isRemoteNewer = comparePreferenceVersions(
      {
        updatedAt: response.preference.updatedAt,
        operationId: response.preference.operationId,
      },
      {
        updatedAt: localPreferences.updatedAt,
        operationId: localPreferences.operationId,
      }
    ) > 0;

    if (isRemoteNewer) {
      await setPreferences(options.database, {
        userId: options.userId,
        patch: {
          hexagonTheme: response.preference.hexagonTheme,
          hexagonVariant: response.preference.hexagonVariant,
          hexagonSize: response.preference.hexagonSize,
          hexagonCustomDepth: response.preference.hexagonCustomDepth,
          hexagonUseCustomDepth: response.preference.hexagonUseCustomDepth,
        },
        updatedAt: response.preference.updatedAt,
        operationId: response.preference.operationId,
        recordOutbox: false,
      });

      appliedRemotePreference = true;
    }
  }

  const pullTimestamp = nowIso();
  const nextCursor = response.cursor ?? cursor;

  await updatePreferenceSyncState(options.database, {
    userId: options.userId,
    lastPulledAt: pullTimestamp,
    remoteCursor: nextCursor,
    lastSyncedOperationId: response.preference?.operationId ?? syncState?.lastSyncedOperationId ?? null,
    updatedAt: pullTimestamp,
  });

  return {
    hadRemotePreference: response.preference !== null,
    appliedRemotePreference,
    cursor: nextCursor,
  };
};

/**
 * Run push then pull for preferences.
 * @param options
 * @returns {Promise<SyncPreferencesResult>}
 */
export const syncPreferences = async (options: SyncPreferencesOptions): Promise<SyncPreferencesResult> => {
  const pushResult = await pushPreferenceOutbox(options);
  const pullResult = await pullPreferenceUpdates(options);

  return {
    push: pushResult,
    pull: pullResult,
  };
};
