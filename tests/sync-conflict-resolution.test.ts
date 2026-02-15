/**
 * Shared sync engine conflict-resolution tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nowIso } from '../core/src';
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import {
  applyPreferenceSyncOperation,
  comparePreferenceVersions,
  getPreferenceSyncState,
  getPreferences,
  listPendingPreferenceMutations,
  markPreferenceMutationFailed,
  setPreferences,
  type HexagonPreferences,
  type HexagonPreferencesValues,
  type PreferenceSyncOperation,
} from '../preferences/src';
import { schemaMigrations } from '../schema/src';
import { pullUpdates, pushOutbox, type SyncOperation, type SyncPullEntity, type SyncRemote } from '../sync/src';

const defaultPreferenceValues: HexagonPreferencesValues = {
  hexagonTheme: 'stone',
  hexagonVariant: 'medium',
  hexagonSize: 80,
  hexagonCustomDepth: 16,
  hexagonUseCustomDepth: false,
};

const createPreference = (
  userId: string,
  updatedAt: string,
  operationId: string,
  overrides: Partial<HexagonPreferencesValues> = {}
): HexagonPreferences => {
  return {
    userId,
    updatedAt,
    operationId,
    ...defaultPreferenceValues,
    ...overrides,
  };
};

const parsePreferenceValues = (value: unknown): HexagonPreferencesValues => {
  if (!value || typeof value !== 'object') {
    throw new Error('Preference payload must include preferences object.');
  }

  const input = value as Record<string, unknown>;

  if (
    typeof input.hexagonTheme !== 'string'
    || typeof input.hexagonVariant !== 'string'
    || typeof input.hexagonSize !== 'number'
    || (typeof input.hexagonCustomDepth !== 'number' && input.hexagonCustomDepth !== null)
    || typeof input.hexagonUseCustomDepth !== 'boolean'
  ) {
    throw new Error('Preference payload has invalid shape.');
  }

  return {
    hexagonTheme: input.hexagonTheme,
    hexagonVariant: input.hexagonVariant,
    hexagonSize: input.hexagonSize,
    hexagonCustomDepth: input.hexagonCustomDepth,
    hexagonUseCustomDepth: input.hexagonUseCustomDepth,
  };
};

const parsePreferenceSyncOperation = (operation: SyncOperation, userId: string): PreferenceSyncOperation => {
  if (!operation.payload || typeof operation.payload !== 'object') {
    throw new Error('Sync operation payload must be an object.');
  }

  const payload = operation.payload as Record<string, unknown>;
  const payloadUserId = typeof payload.userId === 'string' ? payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error('Sync operation userId mismatch.');
  }

  return {
    userId,
    operationId: operation.operationId,
    updatedAt: operation.updatedAt,
    preferences: parsePreferenceValues(payload.preferences),
  };
};

const parsePreferencePullEntity = (entity: SyncPullEntity, userId: string): PreferenceSyncOperation => {
  if (!entity.data || typeof entity.data !== 'object') {
    throw new Error('Pull entity data must be an object.');
  }

  const payload = entity.data as Record<string, unknown>;
  const payloadUserId = typeof payload.userId === 'string' ? payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error('Pull entity userId mismatch.');
  }

  const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : entity.updatedAt;

  return {
    userId,
    operationId: entity.operationId,
    updatedAt,
    preferences: parsePreferenceValues(payload.preferences),
  };
};

interface PreferenceRemoteState {
  preference: HexagonPreferences | null;
  pushFailuresRemaining: number;
  pushCallCount: number;
  pullCursorCount: number;
}

const createPreferenceRemote = (state: PreferenceRemoteState): SyncRemote => {
  return {
    async pushOperations(userId, entityType, operations) {
      if (entityType !== 'preferences') {
        throw new Error(`Unexpected entityType: ${entityType}`);
      }

      state.pushCallCount += 1;

      if (state.pushFailuresRemaining > 0) {
        state.pushFailuresRemaining -= 1;
        throw new Error('Simulated push failure');
      }

      const parsedOperations = operations.map((operation) => parsePreferenceSyncOperation(operation, userId));
      const appliedOperationIds: string[] = [];
      let latestVersion: { updatedAt: string; operationId: string } | null = null;

      for (const operation of parsedOperations) {
        const remoteVersion = state.preference
          ? {
            updatedAt: state.preference.updatedAt,
            operationId: state.preference.operationId,
          }
          : null;

        const isNewer = remoteVersion
          ? comparePreferenceVersions(
            {
              updatedAt: operation.updatedAt,
              operationId: operation.operationId,
            },
            remoteVersion
          ) > 0
          : true;

        if (isNewer) {
          state.preference = {
            userId,
            updatedAt: operation.updatedAt,
            operationId: operation.operationId,
            ...operation.preferences,
          };
          appliedOperationIds.push(operation.operationId);
        }

        if (
          latestVersion === null
          || comparePreferenceVersions(
            {
              updatedAt: operation.updatedAt,
              operationId: operation.operationId,
            },
            latestVersion
          ) > 0
        ) {
          latestVersion = {
            updatedAt: operation.updatedAt,
            operationId: operation.operationId,
          };
        }
      }

      return {
        appliedOperationIds,
        latestOperationId: latestVersion?.operationId ?? null,
        serverTimestamp: nowIso(),
      };
    },
    async pullEntities(userId, entityType) {
      if (entityType !== 'preferences') {
        throw new Error(`Unexpected entityType: ${entityType}`);
      }

      state.pullCursorCount += 1;

      if (!state.preference) {
        return {
          entities: [],
          cursor: `cursor-${state.pullCursorCount}`,
        };
      }

      return {
        entities: [
          {
            entityId: userId,
            updatedAt: state.preference.updatedAt,
            operationId: state.preference.operationId ?? '',
            data: {
              userId,
              updatedAt: state.preference.updatedAt,
              preferences: {
                hexagonTheme: state.preference.hexagonTheme,
                hexagonVariant: state.preference.hexagonVariant,
                hexagonSize: state.preference.hexagonSize,
                hexagonCustomDepth: state.preference.hexagonCustomDepth,
                hexagonUseCustomDepth: state.preference.hexagonUseCustomDepth,
              },
            },
          },
        ],
        cursor: `cursor-${state.pullCursorCount}`,
      };
    },
  };
};

const withTemporaryDatabase = async (run: (databasePath: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'bookmarks-sync-conflicts-'));
  const databasePath = join(root, 'sync.sqlite');

  try {
    await run(databasePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('local newer than remote pull is skipped', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'obsidian' },
        updatedAt: '2026-02-07T10:00:00.000Z',
        operationId: 'op-local-newer',
        recordOutbox: false,
      });

      const remote = createPreferenceRemote({
        preference: createPreference('sync-user', '2026-02-07T09:00:00.000Z', 'op-remote-older', {
          hexagonTheme: 'slate',
        }),
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      const result = await pullUpdates({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        applyRemoteEntity: async (entity) => {
          const operation = parsePreferencePullEntity(entity, 'sync-user');
          const applied = await applyPreferenceSyncOperation(database, operation);

          return { applied: applied.applied };
        },
      });

      assert.equal(result.appliedCount, 0);

      const local = await getPreferences(database, 'sync-user');
      assert.ok(local);
      assert.equal(local.hexagonTheme, 'obsidian');
      assert.equal(local.updatedAt, '2026-02-07T10:00:00.000Z');
    } finally {
      await database.close();
    }
  });
});

test('remote newer than local pull is applied', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'stone' },
        updatedAt: '2026-02-07T10:00:00.000Z',
        operationId: 'op-local-older',
        recordOutbox: false,
      });

      const remote = createPreferenceRemote({
        preference: createPreference('sync-user', '2026-02-07T10:00:05.000Z', 'op-remote-newer', {
          hexagonTheme: 'basalt',
        }),
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      const result = await pullUpdates({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        applyRemoteEntity: async (entity) => {
          const operation = parsePreferencePullEntity(entity, 'sync-user');
          const applied = await applyPreferenceSyncOperation(database, operation);

          return { applied: applied.applied };
        },
      });

      assert.equal(result.appliedCount, 1);

      const local = await getPreferences(database, 'sync-user');
      assert.ok(local);
      assert.equal(local.hexagonTheme, 'basalt');
      assert.equal(local.operationId, 'op-remote-newer');
    } finally {
      await database.close();
    }
  });
});

test('same timestamp prefers higher operationId', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'sandstone' },
        updatedAt: '2026-02-07T11:00:00.000Z',
        operationId: 'op-a',
        recordOutbox: false,
      });

      const remote = createPreferenceRemote({
        preference: createPreference('sync-user', '2026-02-07T11:00:00.000Z', 'op-z', {
          hexagonTheme: 'obsidian',
        }),
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      const result = await pullUpdates({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        applyRemoteEntity: async (entity) => {
          const operation = parsePreferencePullEntity(entity, 'sync-user');
          const applied = await applyPreferenceSyncOperation(database, operation);

          return { applied: applied.applied };
        },
      });

      assert.equal(result.appliedCount, 1);

      const local = await getPreferences(database, 'sync-user');
      assert.ok(local);
      assert.equal(local.hexagonTheme, 'obsidian');
      assert.equal(local.operationId, 'op-z');
    } finally {
      await database.close();
    }
  });
});

test('same timestamp and operationId is a no-op', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'slate' },
        updatedAt: '2026-02-07T12:00:00.000Z',
        operationId: 'op-same',
        recordOutbox: false,
      });

      const remote = createPreferenceRemote({
        preference: createPreference('sync-user', '2026-02-07T12:00:00.000Z', 'op-same', {
          hexagonTheme: 'basalt',
        }),
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      const result = await pullUpdates({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        applyRemoteEntity: async (entity) => {
          const operation = parsePreferencePullEntity(entity, 'sync-user');
          const applied = await applyPreferenceSyncOperation(database, operation);

          return { applied: applied.applied };
        },
      });

      assert.equal(result.appliedCount, 0);

      const local = await getPreferences(database, 'sync-user');
      assert.ok(local);
      assert.equal(local.hexagonTheme, 'slate');
      assert.equal(local.operationId, 'op-same');
    } finally {
      await database.close();
    }
  });
});

test('push batch marks all pending mutations processed', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'stone' },
        updatedAt: '2026-02-07T13:00:00.000Z',
        operationId: 'op-batch-1',
        recordOutbox: true,
      });

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'basalt' },
        updatedAt: '2026-02-07T13:00:01.000Z',
        operationId: 'op-batch-2',
        recordOutbox: true,
      });

      const remoteState: PreferenceRemoteState = {
        preference: null,
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      };
      const remote = createPreferenceRemote(remoteState);

      const result = await pushOutbox({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
      });

      assert.equal(result.pendingCount, 2);
      assert.equal(result.eligibleCount, 2);
      assert.equal(result.pushedCount, 2);

      const pending = await listPendingPreferenceMutations(database, 'sync-user');
      assert.equal(pending.length, 0);
    } finally {
      await database.close();
    }
  });
});

test('push failure increments attempts', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'sandstone' },
        updatedAt: '2026-02-07T14:00:00.000Z',
        operationId: 'op-fail-1',
        recordOutbox: true,
      });

      const remote = createPreferenceRemote({
        preference: null,
        pushFailuresRemaining: 1,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      await assert.rejects(
        () => pushOutbox({
          database,
          userId: 'sync-user',
          entityType: 'preferences',
          remote,
        }),
        /Simulated push failure/
      );

      const pending = await listPendingPreferenceMutations(database, 'sync-user');
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.attempts, 1);
    } finally {
      await database.close();
    }
  });
});

test('failed mutations are retried on next push when attempts below max', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'obsidian' },
        updatedAt: '2026-02-07T15:00:00.000Z',
        operationId: 'op-retry-1',
        recordOutbox: true,
      });

      const remote = createPreferenceRemote({
        preference: null,
        pushFailuresRemaining: 1,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      await assert.rejects(
        () => pushOutbox({
          database,
          userId: 'sync-user',
          entityType: 'preferences',
          remote,
        }),
        /Simulated push failure/
      );

      const secondAttempt = await pushOutbox({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
      });

      assert.equal(secondAttempt.pushedCount, 1);

      const pending = await listPendingPreferenceMutations(database, 'sync-user');
      assert.equal(pending.length, 0);
    } finally {
      await database.close();
    }
  });
});

test('dead-letter skips mutations at or above maxAttempts', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      await setPreferences(database, {
        userId: 'sync-user',
        patch: { hexagonTheme: 'slate' },
        updatedAt: '2026-02-07T16:00:00.000Z',
        operationId: 'op-dead-letter',
        recordOutbox: true,
      });

      const pendingBefore = await listPendingPreferenceMutations(database, 'sync-user');
      assert.equal(pendingBefore.length, 1);

      const firstPending = pendingBefore[0];
      assert.ok(firstPending);

      for (let index = 0; index < 5; index += 1) {
        await markPreferenceMutationFailed(database, firstPending.outboxId, `failed-${index}`);
      }

      const remoteState: PreferenceRemoteState = {
        preference: null,
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      };
      const remote = createPreferenceRemote(remoteState);

      const result = await pushOutbox({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        maxAttempts: 5,
      });

      assert.equal(result.pendingCount, 1);
      assert.equal(result.eligibleCount, 0);
      assert.equal(result.skippedDeadLetterCount, 1);
      assert.equal(remoteState.pushCallCount, 0);
    } finally {
      await database.close();
    }
  });
});

test('cursor progresses across consecutive pulls', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      const remote = createPreferenceRemote({
        preference: null,
        pushFailuresRemaining: 0,
        pushCallCount: 0,
        pullCursorCount: 0,
      });

      const firstPull = await pullUpdates({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        applyRemoteEntity: async () => {
          return { applied: false };
        },
      });

      const secondPull = await pullUpdates({
        database,
        userId: 'sync-user',
        entityType: 'preferences',
        remote,
        applyRemoteEntity: async () => {
          return { applied: false };
        },
      });

      assert.equal(firstPull.cursor, 'cursor-1');
      assert.equal(secondPull.cursor, 'cursor-2');

      const syncState = await getPreferenceSyncState(database, 'sync-user');
      assert.ok(syncState);
      assert.equal(syncState.remoteCursor, 'cursor-2');
    } finally {
      await database.close();
    }
  });
});
