/**
 * Places sync integration tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBackendServer } from '../apps/backend/src/server';
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import {
  createPlacesHttpClient,
  listPendingPlaceMutations,
  listPlaces,
  pullPlaceUpdates,
  pushPlaceOutbox,
  removePlace,
  syncPlaces,
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
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-places-sync-'));

  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('places outbox records upsert and delete mutations locally', async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDatabasePath = join(directory, 'local.sqlite');
    const localDatabase = createNodeSqliteAdapter({ filename: localDatabasePath });

    try {
      await migrateDatabase(localDatabase, schemaMigrations);

      const place = await upsertPlace(localDatabase, {
        userId: 'places-sync-user',
        input: {
          name: 'Outbox Place',
          latitude: 40.0,
          longitude: -74.0,
          googlePlaceId: 'gp-outbox-place',
        },
      });

      await removePlace(localDatabase, 'places-sync-user', place.id);

      const pending = await listPendingPlaceMutations(localDatabase, 'places-sync-user');
      assert.equal(pending.length, 2);
      assert.equal(pending[0]?.operationType, 'upsert');
      assert.equal(pending[1]?.operationType, 'delete');
    } finally {
      await localDatabase.close();
    }
  });
});

test('pushPlaceOutbox sends local place changes to backend', { timeout: 30_000 }, async () => {
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

      authSession = await createTestAuthSession(baseUrl, 'places-sync-user');

      await upsertPlace(localDatabase, {
        userId: 'places-sync-user',
        input: {
          name: 'Push Me',
          latitude: 34.05,
          longitude: -118.25,
          googlePlaceId: 'gp-push-place',
        },
        updatedAt: '2026-02-07T01:00:00.000Z',
        operationId: 'op-place-push-1',
        recordOutbox: true,
      });

      const remote = createPlacesHttpClient(authSession.httpClientOptions);
      const pushResult = await pushPlaceOutbox({
        database: localDatabase,
        userId: 'places-sync-user',
        remote,
      });

      assert.equal(pushResult.pendingCount, 1);
      assert.equal(pushResult.pushedCount, 1);

      const backendListResponse = await authSession.fetch(`${baseUrl}/users/places-sync-user/places`);
      assert.equal(backendListResponse.status, 200);

      const backendListPayload = (await backendListResponse.json()) as {
        places: Array<{ name: string; googlePlaceId: string }>;
      };
      assert.equal(backendListPayload.places.length, 1);
      assert.equal(backendListPayload.places[0]?.name, 'Push Me');
      assert.equal(backendListPayload.places[0]?.googlePlaceId, 'gp-push-place');

      const pendingAfterPush = await listPendingPlaceMutations(localDatabase, 'places-sync-user');
      assert.equal(pendingAfterPush.length, 0);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
      await localDatabase.close();
    }
  });
});

test('pullPlaceUpdates applies remote place changes locally', { timeout: 30_000 }, async () => {
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

      authSession = await createTestAuthSession(baseUrl, 'places-sync-user');

      const upsertRemoteResponse = await authSession.fetch(`${baseUrl}/users/places-sync-user/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Remote Place',
          latitude: 51.5,
          longitude: -0.1,
          googlePlaceId: 'gp-remote-place',
          address: 'London',
        }),
      });

      assert.equal(upsertRemoteResponse.status, 200);

      const remote = createPlacesHttpClient(authSession.httpClientOptions);
      const pullResult = await pullPlaceUpdates({
        database: localDatabase,
        userId: 'places-sync-user',
        remote,
      });

      assert.equal(pullResult.fetchedCount, 1);
      assert.equal(pullResult.appliedCount, 1);

      const localPlaces = await listPlaces(localDatabase, 'places-sync-user');
      assert.equal(localPlaces.length, 1);
      assert.equal(localPlaces[0]?.name, 'Remote Place');
      assert.equal(localPlaces[0]?.googlePlaceId, 'gp-remote-place');
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
      await localDatabase.close();
    }
  });
});

test('syncPlaces round-trip applies backend edits after push', { timeout: 30_000 }, async () => {
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

      authSession = await createTestAuthSession(baseUrl, 'places-sync-user');

      await upsertPlace(localDatabase, {
        userId: 'places-sync-user',
        input: {
          name: 'Local Draft',
          latitude: 48.8566,
          longitude: 2.3522,
          googlePlaceId: 'gp-roundtrip-place',
        },
        updatedAt: '2026-02-07T01:00:00.000Z',
        operationId: 'op-place-roundtrip-1',
        recordOutbox: true,
      });

      const remote = createPlacesHttpClient(authSession.httpClientOptions);

      const firstSync = await syncPlaces({
        database: localDatabase,
        userId: 'places-sync-user',
        remote,
      });

      assert.equal(firstSync.push.pushedCount, 1);

      const backendEditResponse = await authSession.fetch(`${baseUrl}/users/places-sync-user/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Server Edited',
          latitude: 48.8566,
          longitude: 2.3522,
          googlePlaceId: 'gp-roundtrip-place',
          address: 'Paris',
        }),
      });

      assert.equal(backendEditResponse.status, 200);

      const secondSync = await syncPlaces({
        database: localDatabase,
        userId: 'places-sync-user',
        remote,
      });

      assert.equal(secondSync.pull.appliedCount, 1);

      const localPlaces = await listPlaces(localDatabase, 'places-sync-user');
      assert.equal(localPlaces.length, 1);
      assert.equal(localPlaces[0]?.name, 'Server Edited');
      assert.equal(localPlaces[0]?.address, 'Paris');
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
      await localDatabase.close();
    }
  });
});
