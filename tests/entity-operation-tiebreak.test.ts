/**
 * Equal-timestamp conflict resolution tests for place and collection sync operations.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyCollectionSyncOperation,
  createCollection,
  getCollection,
} from '../collections/src';
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import {
  applyPlaceSyncOperation,
  getPlace,
  upsertPlace,
} from '../places/src';
import { schemaMigrations } from '../schema/src';

const withTemporaryDatabase = async (run: (databasePath: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'bookmarks-operation-tiebreak-'));
  const databasePath = join(root, 'integration.sqlite');

  try {
    await run(databasePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('place sync picks higher operationId when updatedAt timestamps are equal', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      const userId = 'tie-break-user';
      const placeId = 'tie-break-place';
      const timestamp = '2026-02-14T10:00:00.000Z';

      await upsertPlace(database, {
        userId,
        placeId,
        input: {
          name: 'Local Place',
          latitude: 10,
          longitude: 20,
          googlePlaceId: 'gp-tie-break-place',
        },
        updatedAt: timestamp,
        operationId: 'op-a',
        recordOutbox: false,
      });

      const higherOperation = await applyPlaceSyncOperation(database, {
        userId,
        placeId,
        operationId: 'op-z',
        operationType: 'upsert',
        updatedAt: timestamp,
        place: {
          name: 'Remote Winner',
          latitude: 11,
          longitude: 21,
          googlePlaceId: 'gp-tie-break-place',
        },
      });

      assert.equal(higherOperation.applied, true);

      const afterHigherOperation = await getPlace(database, userId, placeId);
      assert.equal(afterHigherOperation?.name, 'Remote Winner');

      const lowerOperation = await applyPlaceSyncOperation(database, {
        userId,
        placeId,
        operationId: 'op-b',
        operationType: 'upsert',
        updatedAt: timestamp,
        place: {
          name: 'Remote Loser',
          latitude: 12,
          longitude: 22,
          googlePlaceId: 'gp-tie-break-place',
        },
      });

      assert.equal(lowerOperation.applied, false);

      const afterLowerOperation = await getPlace(database, userId, placeId);
      assert.equal(afterLowerOperation?.name, 'Remote Winner');
    } finally {
      await database.close();
    }
  });
});

test('collection sync picks higher operationId when updatedAt timestamps are equal', async () => {
  await withTemporaryDatabase(async (databasePath) => {
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      const userId = 'tie-break-user';
      const collectionId = 'tie-break-collection';
      const timestamp = '2026-02-14T11:00:00.000Z';

      await createCollection(database, {
        userId,
        collectionId,
        input: {
          name: 'Local Collection',
          coverImage: null,
        },
        updatedAt: timestamp,
        operationId: 'op-a',
        recordOutbox: false,
      });

      const higherOperation = await applyCollectionSyncOperation(database, {
        userId,
        collectionId,
        operationId: 'op-z',
        operationType: 'update',
        updatedAt: timestamp,
        collection: {
          name: 'Remote Winner Collection',
          coverImage: null,
        },
        placeId: null,
      });

      assert.equal(higherOperation.applied, true);

      const afterHigherOperation = await getCollection(database, userId, collectionId);
      assert.equal(afterHigherOperation?.name, 'Remote Winner Collection');

      const lowerOperation = await applyCollectionSyncOperation(database, {
        userId,
        collectionId,
        operationId: 'op-b',
        operationType: 'update',
        updatedAt: timestamp,
        collection: {
          name: 'Remote Loser Collection',
          coverImage: null,
        },
        placeId: null,
      });

      assert.equal(lowerOperation.applied, false);

      const afterLowerOperation = await getCollection(database, userId, collectionId);
      assert.equal(afterLowerOperation?.name, 'Remote Winner Collection');
    } finally {
      await database.close();
    }
  });
});
