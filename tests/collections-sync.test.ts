/**
 * Collections sync integration tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBackendServer } from '../apps/backend/src/server';
import {
  addPlaceToCollection,
  createCollection,
  createCollectionsHttpClient,
  listCollectionPlaces,
  listCollections,
  listPendingCollectionMutations,
  pullCollectionUpdates,
  removeCollection,
  removePlaceFromCollection,
  pushCollectionOutbox,
  syncCollections,
  updateCollection,
} from '../collections/src';
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import {
  createPlacesHttpClient,
  pullPlaceUpdates,
  pushPlaceOutbox,
  upsertPlace,
} from '../places/src';
import { schemaMigrations } from '../schema/src';
import { createTestAuthSession } from './helpers/auth';

const getAvailablePort = async (): Promise<number> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close();
        rejectPromise(new Error('Failed to allocate an ephemeral port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(address.port);
      });
    });

    server.on('error', (error) => {
      rejectPromise(error);
    });
  });
};

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-collections-sync-'));

  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('collections outbox records create/update/delete and membership mutations', async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDatabasePath = join(directory, 'local.sqlite');
    const localDatabase = createNodeSqliteAdapter({ filename: localDatabasePath });

    try {
      await migrateDatabase(localDatabase, schemaMigrations);

      const place = await upsertPlace(localDatabase, {
        userId: 'collections-sync-user',
        input: {
          name: 'Collection Place',
          latitude: 10,
          longitude: 20,
          googlePlaceId: 'gp-collection-place',
        },
      });

      const collection = await createCollection(localDatabase, {
        userId: 'collections-sync-user',
        input: { name: 'Outbox Collection' },
      });

      await updateCollection(localDatabase, {
        userId: 'collections-sync-user',
        collectionId: collection.id,
        input: { name: 'Outbox Collection Updated' },
      });

      await addPlaceToCollection(localDatabase, {
        userId: 'collections-sync-user',
        collectionId: collection.id,
        placeId: place.id,
      });

      await removePlaceFromCollection(localDatabase, {
        userId: 'collections-sync-user',
        collectionId: collection.id,
        placeId: place.id,
      });

      await removeCollection(localDatabase, 'collections-sync-user', collection.id);

      const pending = await listPendingCollectionMutations(localDatabase, 'collections-sync-user');
      assert.equal(pending.length, 5);
      assert.deepEqual(
        pending.map((mutation) => mutation.operationType),
        ['create', 'update', 'add-place', 'remove-place', 'delete']
      );
    } finally {
      await localDatabase.close();
    }
  });
});

test('pushCollectionOutbox sends local collection changes to backend', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDatabasePath = join(directory, 'local.sqlite');
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const localDatabase = createNodeSqliteAdapter({ filename: localDatabasePath });

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    await backend.start();

    try {
      await migrateDatabase(localDatabase, schemaMigrations);

      authSession = await createTestAuthSession(baseUrl, 'collections-sync-user');

      const place = await upsertPlace(localDatabase, {
        userId: 'collections-sync-user',
        input: {
          name: 'Push Collection Place',
          latitude: 11,
          longitude: 22,
          googlePlaceId: 'gp-push-collection-place',
        },
        updatedAt: '2026-02-07T01:00:00.000Z',
        operationId: 'op-place-collection-push-1',
        recordOutbox: true,
      });

      const collection = await createCollection(localDatabase, {
        userId: 'collections-sync-user',
        input: { name: 'Push Collection' },
        updatedAt: '2026-02-07T01:00:01.000Z',
        operationId: 'op-collection-push-1',
        recordOutbox: true,
      });

      await addPlaceToCollection(localDatabase, {
        userId: 'collections-sync-user',
        collectionId: collection.id,
        placeId: place.id,
        updatedAt: '2026-02-07T01:00:02.000Z',
        operationId: 'op-collection-push-2',
        recordOutbox: true,
      });

      const placesRemote = createPlacesHttpClient(authSession.httpClientOptions);
      const collectionsRemote = createCollectionsHttpClient(authSession.httpClientOptions);

      await pushPlaceOutbox({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: placesRemote,
      });

      const pushResult = await pushCollectionOutbox({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: collectionsRemote,
      });

      assert.equal(pushResult.pendingCount, 2);
      assert.equal(pushResult.pushedCount, 2);

      const backendCollectionsResponse = await authSession.fetch(`${baseUrl}/users/collections-sync-user/collections`);
      assert.equal(backendCollectionsResponse.status, 200);
      const backendCollectionsPayload = (await backendCollectionsResponse.json()) as {
        collections: Array<{ id: string; name: string; placeCount: number }>;
      };

      assert.equal(backendCollectionsPayload.collections.length, 1);
      assert.equal(backendCollectionsPayload.collections[0]?.name, 'Push Collection');
      assert.equal(backendCollectionsPayload.collections[0]?.placeCount, 1);

      const backendListPlacesResponse = await authSession.fetch(
        `${baseUrl}/users/collections-sync-user/collections/${collection.id}/places`
      );
      assert.equal(backendListPlacesResponse.status, 200);
      const backendListPlacesPayload = (await backendListPlacesResponse.json()) as {
        places: Array<{ id: string; name: string }>;
      };

      assert.equal(backendListPlacesPayload.places.length, 1);
      assert.equal(backendListPlacesPayload.places[0]?.id, place.id);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
      await localDatabase.close();
    }
  });
});

test('pullCollectionUpdates applies remote collection state locally', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDatabasePath = join(directory, 'local.sqlite');
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const localDatabase = createNodeSqliteAdapter({ filename: localDatabasePath });

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    await backend.start();

    try {
      await migrateDatabase(localDatabase, schemaMigrations);

      authSession = await createTestAuthSession(baseUrl, 'collections-sync-user');

      const createPlaceResponse = await authSession.fetch(`${baseUrl}/users/collections-sync-user/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Remote Collection Place',
          latitude: 12,
          longitude: 34,
          googlePlaceId: 'gp-remote-collection-place',
        }),
      });
      assert.equal(createPlaceResponse.status, 200);
      const createPlacePayload = (await createPlaceResponse.json()) as { place: { id: string } };
      const placeId = createPlacePayload.place.id;

      const createCollectionResponse = await authSession.fetch(`${baseUrl}/users/collections-sync-user/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Remote Collection' }),
      });
      assert.equal(createCollectionResponse.status, 201);
      const createCollectionPayload = (await createCollectionResponse.json()) as { collection: { id: string } };
      const collectionId = createCollectionPayload.collection.id;

      const addPlaceResponse = await authSession.fetch(`${baseUrl}/users/collections-sync-user/collections/${collectionId}/places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId }),
      });
      assert.equal(addPlaceResponse.status, 200);

      const placesRemote = createPlacesHttpClient(authSession.httpClientOptions);
      const collectionsRemote = createCollectionsHttpClient(authSession.httpClientOptions);

      await pullPlaceUpdates({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: placesRemote,
      });

      const pullResult = await pullCollectionUpdates({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: collectionsRemote,
      });

      assert.equal(pullResult.fetchedCount, 1);
      assert.equal(pullResult.appliedCount, 1);

      const collections = await listCollections(localDatabase, 'collections-sync-user');
      assert.equal(collections.length, 1);
      assert.equal(collections[0]?.name, 'Remote Collection');
      assert.equal(collections[0]?.placeCount, 1);

      const placesInCollection = await listCollectionPlaces(localDatabase, {
        userId: 'collections-sync-user',
        collectionId,
      });
      assert.equal(placesInCollection.length, 1);
      assert.equal(placesInCollection[0]?.id, placeId);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
      await localDatabase.close();
    }
  });
});

test('syncCollections round-trip applies backend membership edits', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDatabasePath = join(directory, 'local.sqlite');
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const localDatabase = createNodeSqliteAdapter({ filename: localDatabasePath });

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    await backend.start();

    try {
      await migrateDatabase(localDatabase, schemaMigrations);

      authSession = await createTestAuthSession(baseUrl, 'collections-sync-user');

      const place = await upsertPlace(localDatabase, {
        userId: 'collections-sync-user',
        input: {
          name: 'Round Trip Place',
          latitude: 20,
          longitude: 30,
          googlePlaceId: 'gp-roundtrip-collection-place',
        },
        updatedAt: '2026-02-07T02:00:00.000Z',
        operationId: 'op-collection-roundtrip-place-1',
        recordOutbox: true,
      });

      const collection = await createCollection(localDatabase, {
        userId: 'collections-sync-user',
        input: { name: 'Round Trip Collection' },
        updatedAt: '2026-02-07T02:00:01.000Z',
        operationId: 'op-collection-roundtrip-1',
        recordOutbox: true,
      });

      await addPlaceToCollection(localDatabase, {
        userId: 'collections-sync-user',
        collectionId: collection.id,
        placeId: place.id,
        updatedAt: '2026-02-07T02:00:02.000Z',
        operationId: 'op-collection-roundtrip-2',
        recordOutbox: true,
      });

      const placesRemote = createPlacesHttpClient(authSession.httpClientOptions);
      const collectionsRemote = createCollectionsHttpClient(authSession.httpClientOptions);

      await pushPlaceOutbox({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: placesRemote,
      });

      const firstSync = await syncCollections({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: collectionsRemote,
      });

      assert.equal(firstSync.push.pushedCount, 2);

      const backendUpdateResponse = await authSession.fetch(
        `${baseUrl}/users/collections-sync-user/collections/${collection.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Backend Renamed Collection' }),
        }
      );
      assert.equal(backendUpdateResponse.status, 200);

      const backendRemoveMembershipResponse = await authSession.fetch(
        `${baseUrl}/users/collections-sync-user/collections/${collection.id}/places/${place.id}`,
        { method: 'DELETE' }
      );
      assert.equal(backendRemoveMembershipResponse.status, 200);

      await pullPlaceUpdates({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: placesRemote,
      });

      const secondSync = await syncCollections({
        database: localDatabase,
        userId: 'collections-sync-user',
        remote: collectionsRemote,
      });

      assert.equal(secondSync.pull.appliedCount, 1);

      const localCollections = await listCollections(localDatabase, 'collections-sync-user');
      assert.equal(localCollections.length, 1);
      assert.equal(localCollections[0]?.name, 'Backend Renamed Collection');
      assert.equal(localCollections[0]?.placeCount, 0);

      const localCollectionPlaces = await listCollectionPlaces(localDatabase, {
        userId: 'collections-sync-user',
        collectionId: collection.id,
      });
      assert.equal(localCollectionPlaces.length, 0);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
      await localDatabase.close();
    }
  });
});
