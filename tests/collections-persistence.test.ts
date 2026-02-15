/**
 * Collections persistence integration tests.
 *
 * Covers local repository behavior: create, list, get, update, remove,
 * membership operations (add-place, remove-place, list-places),
 * derived placeCount, and interaction with places isSaved status.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createBackendServer } from '../apps/backend/src/server';
import {
  addPlaceToCollection,
  createCollection,
  getCollection,
  listCollectionPlaces,
  listCollections,
  removeCollection,
  removePlaceFromCollection,
  updateCollection,
} from '../collections/src';
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import type { DatabaseAdapter } from '../db/src';
import { getPlace, listPlaces, upsertPlace } from '../places/src';
import { schemaMigrations } from '../schema/src';
import { createTestAuthSession } from './helpers/auth';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const cliEntrypoint = resolve(repositoryRoot, 'apps', 'cli', 'src', 'index.ts');

const withTemporaryDatabase = async (
  run: (database: DatabaseAdapter, databasePath: string) => Promise<void>
): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'bookmarks-collections-'));
  const databasePath = join(root, 'test.sqlite');
  const database = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(database, schemaMigrations);
    await run(database, databasePath);
  } finally {
    await database.close();
    rmSync(root, { recursive: true, force: true });
  }
};

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-collections-runtime-'));

  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

interface CommandOutput {
  stdout: string;
  stderr: string;
}

const runNodeTsxCommand = async (
  entrypoint: string,
  args: readonly string[],
  environment: Record<string, string> = {}
): Promise<CommandOutput> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(
        new Error(
          `Command failed with code ${code}: ${entrypoint} ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
};

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

// ── Local repository tests: Collection CRUD ─────────────────────────────

test('createCollection creates a new collection with placeCount=0', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Favorites' },
    });

    assert.ok(collection.id);
    assert.equal(collection.userId, 'user-a');
    assert.equal(collection.name, 'Favorites');
    assert.equal(collection.coverImage, null);
    assert.equal(collection.placeCount, 0);
    assert.equal(collection.deletedAt, null);
  });
});

test('createCollection with coverImage', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Travel', coverImage: 'https://example.com/cover.jpg' },
    });

    assert.equal(collection.name, 'Travel');
    assert.equal(collection.coverImage, 'https://example.com/cover.jpg');
  });
});

test('listCollections returns collections ordered by created_at desc', async () => {
  await withTemporaryDatabase(async (database) => {
    await createCollection(database, {
      userId: 'user-a',
      input: { name: 'First' },
    });

    // Small delay so created_at differs
    await new Promise((r) => setTimeout(r, 10));

    await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Second' },
    });

    const collections = await listCollections(database, 'user-a');
    assert.equal(collections.length, 2);

    const first = collections[0];
    const second = collections[1];
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.name, 'Second');
    assert.equal(second.name, 'First');
  });
});

test('listCollections excludes deleted collections', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'To Delete' },
    });

    await removeCollection(database, 'user-a', collection.id);

    const collections = await listCollections(database, 'user-a');
    assert.equal(collections.length, 0);
  });
});

test('listCollections returns empty for different user', async () => {
  await withTemporaryDatabase(async (database) => {
    await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Only A' },
    });

    const collections = await listCollections(database, 'user-b');
    assert.equal(collections.length, 0);
  });
});

test('getCollection returns null for non-existent collection', async () => {
  await withTemporaryDatabase(async (database) => {
    const result = await getCollection(database, 'user-a', 'non-existent-id');
    assert.equal(result, null);
  });
});

test('updateCollection changes name and coverImage', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Original' },
    });

    const updated = await updateCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      input: { name: 'Renamed', coverImage: 'https://example.com/new.jpg' },
    });

    assert.equal(updated.id, collection.id);
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.coverImage, 'https://example.com/new.jpg');
  });
});

test('updateCollection throws for non-existent collection', async () => {
  await withTemporaryDatabase(async (database) => {
    await assert.rejects(
      () => updateCollection(database, {
        userId: 'user-a',
        collectionId: 'non-existent',
        input: { name: 'Nope' },
      }),
      { message: /not found/ }
    );
  });
});

test('removeCollection soft-deletes and is idempotent', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Temp' },
    });

    const firstRemove = await removeCollection(database, 'user-a', collection.id);
    assert.equal(firstRemove, true);

    // Second remove returns false (already deleted)
    const secondRemove = await removeCollection(database, 'user-a', collection.id);
    assert.equal(secondRemove, false);
  });
});

test('empty collections are preserved (not auto-deleted)', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Empty Collection' },
    });

    const fetched = await getCollection(database, 'user-a', collection.id);
    assert.ok(fetched);
    assert.equal(fetched.placeCount, 0);
    assert.equal(fetched.name, 'Empty Collection');

    // Collection persists in the list
    const collections = await listCollections(database, 'user-a');
    assert.equal(collections.length, 1);
  });
});

// ── Membership operations ───────────────────────────────────────────────

test('addPlaceToCollection creates membership and increments placeCount', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'My Places' },
    });

    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Cafe', latitude: 40.0, longitude: -74.0 },
    });

    const added = await addPlaceToCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    assert.equal(added, true);

    const fetched = await getCollection(database, 'user-a', collection.id);
    assert.ok(fetched);
    assert.equal(fetched.placeCount, 1);
  });
});

test('addPlaceToCollection returns false for duplicate membership', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Dupes' },
    });

    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Park', latitude: 41.0, longitude: -75.0 },
    });

    await addPlaceToCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    // Adding the same place again is a no-op
    const secondAdd = await addPlaceToCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    assert.equal(secondAdd, false);

    // placeCount is still 1
    const fetched = await getCollection(database, 'user-a', collection.id);
    assert.ok(fetched);
    assert.equal(fetched.placeCount, 1);
  });
});

test('addPlaceToCollection throws for non-existent collection', async () => {
  await withTemporaryDatabase(async (database) => {
    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Lonely', latitude: 1.0, longitude: 2.0 },
    });

    await assert.rejects(
      () => addPlaceToCollection(database, {
        userId: 'user-a',
        collectionId: 'no-such-collection',
        placeId: place.id,
      }),
      { message: /Collection.*not found/ }
    );
  });
});

test('addPlaceToCollection throws for non-existent place', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Empty' },
    });

    await assert.rejects(
      () => addPlaceToCollection(database, {
        userId: 'user-a',
        collectionId: collection.id,
        placeId: 'no-such-place',
      }),
      { message: /Place.*not found/ }
    );
  });
});

test('addPlaceToCollection restores soft-deleted membership', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Restore Test' },
    });

    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Cafe', latitude: 40.0, longitude: -74.0 },
    });

    await addPlaceToCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    await removePlaceFromCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    // placeCount should be 0 after removal
    const afterRemove = await getCollection(database, 'user-a', collection.id);
    assert.ok(afterRemove);
    assert.equal(afterRemove.placeCount, 0);

    // Re-add restores the membership
    const restored = await addPlaceToCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    assert.equal(restored, true);

    const afterRestore = await getCollection(database, 'user-a', collection.id);
    assert.ok(afterRestore);
    assert.equal(afterRestore.placeCount, 1);
  });
});

test('removePlaceFromCollection returns false for non-existent membership', async () => {
  await withTemporaryDatabase(async (database) => {
    const removed = await removePlaceFromCollection(database, {
      userId: 'user-a',
      collectionId: 'no-collection',
      placeId: 'no-place',
    });

    assert.equal(removed, false);
  });
});

test('listCollectionPlaces returns places ordered by position', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Ordered' },
    });

    const placeA = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Place A', latitude: 1.0, longitude: 1.0 },
    });

    const placeB = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Place B', latitude: 2.0, longitude: 2.0 },
    });

    const placeC = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Place C', latitude: 3.0, longitude: 3.0 },
    });

    // Add in order: A, B, C
    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: placeA.id });
    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: placeB.id });
    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: placeC.id });

    const places = await listCollectionPlaces(database, {
      userId: 'user-a',
      collectionId: collection.id,
    });

    assert.equal(places.length, 3);
    assert.equal(places[0]?.name, 'Place A');
    assert.equal(places[1]?.name, 'Place B');
    assert.equal(places[2]?.name, 'Place C');
  });
});

test('listCollectionPlaces excludes soft-deleted memberships', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Filtered' },
    });

    const placeA = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Keep', latitude: 1.0, longitude: 1.0 },
    });

    const placeB = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Remove', latitude: 2.0, longitude: 2.0 },
    });

    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: placeA.id });
    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: placeB.id });

    await removePlaceFromCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: placeB.id,
    });

    const places = await listCollectionPlaces(database, {
      userId: 'user-a',
      collectionId: collection.id,
    });

    assert.equal(places.length, 1);
    assert.equal(places[0]?.name, 'Keep');
  });
});

test('listCollectionPlaces throws for non-existent collection', async () => {
  await withTemporaryDatabase(async (database) => {
    await assert.rejects(
      () => listCollectionPlaces(database, {
        userId: 'user-a',
        collectionId: 'no-such',
      }),
      { message: /Collection.*not found/ }
    );
  });
});

// ── Derived placeCount ──────────────────────────────────────────────────

test('placeCount is derived correctly with multiple places', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Counting' },
    });

    const place1 = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'P1', latitude: 1.0, longitude: 1.0 },
    });

    const place2 = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'P2', latitude: 2.0, longitude: 2.0 },
    });

    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: place1.id });
    await addPlaceToCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: place2.id });

    const fetched = await getCollection(database, 'user-a', collection.id);
    assert.ok(fetched);
    assert.equal(fetched.placeCount, 2);

    // Also verify in list
    const collections = await listCollections(database, 'user-a');
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.placeCount, 2);

    // Remove one place
    await removePlaceFromCollection(database, { userId: 'user-a', collectionId: collection.id, placeId: place1.id });

    const afterRemove = await getCollection(database, 'user-a', collection.id);
    assert.ok(afterRemove);
    assert.equal(afterRemove.placeCount, 1);
  });
});

// ── isSaved interaction ─────────────────────────────────────────────────

test('isSaved on PlaceRecord reflects collection membership via collections module', async () => {
  await withTemporaryDatabase(async (database) => {
    const collection = await createCollection(database, {
      userId: 'user-a',
      input: { name: 'Saved Check' },
    });

    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Test Place', latitude: 10.0, longitude: 20.0 },
    });

    assert.equal(place.isSaved, false);

    // Add place to collection
    await addPlaceToCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    const afterAdd = await getPlace(database, 'user-a', place.id);
    assert.ok(afterAdd);
    assert.equal(afterAdd.isSaved, true);

    // Remove place from collection
    await removePlaceFromCollection(database, {
      userId: 'user-a',
      collectionId: collection.id,
      placeId: place.id,
    });

    const afterRemove = await getPlace(database, 'user-a', place.id);
    assert.ok(afterRemove);
    assert.equal(afterRemove.isSaved, false);
  });
});

// ── Validation ──────────────────────────────────────────────────────────

test('collection validation rejects empty name', async () => {
  await withTemporaryDatabase(async (database) => {
    await assert.rejects(
      () => createCollection(database, {
        userId: 'user-a',
        input: { name: '  ' },
      }),
      { message: /Collection name is required/ }
    );
  });
});

// ── Backend HTTP route tests ────────────────────────────────────────────

test('backend collection routes: create, list, get, update, delete', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath,
    });
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    await backend.start();

    try {
      authSession = await createTestAuthSession(baseUrl, 'user-http');

      // Create a collection
      const createResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'HTTP Favorites', coverImage: 'https://example.com/cover.jpg' }),
      });

      assert.equal(createResponse.status, 201);

      const createPayload = (await createResponse.json()) as { collection: { id: string; name: string; placeCount: number; coverImage: string } };
      assert.equal(createPayload.collection.name, 'HTTP Favorites');
      assert.equal(createPayload.collection.placeCount, 0);
      assert.equal(createPayload.collection.coverImage, 'https://example.com/cover.jpg');

      const collectionId = createPayload.collection.id;

      // List collections
      const listResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections`);
      assert.equal(listResponse.status, 200);

      const listPayload = (await listResponse.json()) as { collections: Array<{ id: string }> };
      assert.equal(listPayload.collections.length, 1);
      assert.equal(listPayload.collections[0]?.id, collectionId);

      // Get single collection
      const getResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}`);
      assert.equal(getResponse.status, 200);

      const getPayload = (await getResponse.json()) as { collection: { id: string; name: string } };
      assert.equal(getPayload.collection.id, collectionId);
      assert.equal(getPayload.collection.name, 'HTTP Favorites');

      // Update collection
      const updateResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'HTTP Favorites Updated' }),
      });

      assert.equal(updateResponse.status, 200);

      const updatePayload = (await updateResponse.json()) as { collection: { name: string } };
      assert.equal(updatePayload.collection.name, 'HTTP Favorites Updated');

      // Delete collection
      const deleteResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}`, {
        method: 'DELETE',
      });

      assert.equal(deleteResponse.status, 200);

      const deletePayload = (await deleteResponse.json()) as { removed: boolean };
      assert.equal(deletePayload.removed, true);

      // Collection no longer listed
      const listAfterDelete = await authSession.fetch(`${baseUrl}/users/user-http/collections`);
      const listAfterDeletePayload = (await listAfterDelete.json()) as { collections: Array<{ id: string }> };
      assert.equal(listAfterDeletePayload.collections.length, 0);

      // Get returns 404
      const getAfterDelete = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}`);
      assert.equal(getAfterDelete.status, 404);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
    }
  });
});

test('backend collection membership routes: add-place, list-places, remove-place', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath,
    });
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    await backend.start();

    try {
      authSession = await createTestAuthSession(baseUrl, 'user-http');

      // Create a collection
      const createColResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Membership Test' }),
      });

      const createColPayload = (await createColResponse.json()) as { collection: { id: string } };
      const collectionId = createColPayload.collection.id;

      // Create a place
      const upsertResponse = await authSession.fetch(`${baseUrl}/users/user-http/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Cafe',
          latitude: 34.05,
          longitude: -118.25,
          googlePlaceId: 'gp-membership-test',
        }),
      });

      const upsertPayload = (await upsertResponse.json()) as { place: { id: string; isSaved: boolean } };
      const placeId = upsertPayload.place.id;
      assert.equal(upsertPayload.place.isSaved, false);

      // Add place to collection
      const addResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}/places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId }),
      });

      assert.equal(addResponse.status, 200);

      const addPayload = (await addResponse.json()) as { added: boolean };
      assert.equal(addPayload.added, true);

      // List places in collection
      const listPlacesResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}/places`);
      assert.equal(listPlacesResponse.status, 200);

      const listPlacesPayload = (await listPlacesResponse.json()) as { places: Array<{ id: string; name: string; isSaved: boolean }> };
      assert.equal(listPlacesPayload.places.length, 1);
      assert.equal(listPlacesPayload.places[0]?.id, placeId);
      assert.equal(listPlacesPayload.places[0]?.isSaved, true);

      // Verify isSaved on the place directly
      const getPlaceResponse = await authSession.fetch(`${baseUrl}/users/user-http/places/${placeId}`);
      const getPlacePayload = (await getPlaceResponse.json()) as { place: { isSaved: boolean } };
      assert.equal(getPlacePayload.place.isSaved, true);

      // Verify collection placeCount
      const getColResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}`);
      const getColPayload = (await getColResponse.json()) as { collection: { placeCount: number } };
      assert.equal(getColPayload.collection.placeCount, 1);

      // Remove place from collection
      const removeResponse = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}/places/${placeId}`, {
        method: 'DELETE',
      });

      assert.equal(removeResponse.status, 200);

      const removePayload = (await removeResponse.json()) as { removed: boolean };
      assert.equal(removePayload.removed, true);

      // List places in collection is now empty
      const listAfterRemove = await authSession.fetch(`${baseUrl}/users/user-http/collections/${collectionId}/places`);
      const listAfterRemovePayload = (await listAfterRemove.json()) as { places: Array<{ id: string }> };
      assert.equal(listAfterRemovePayload.places.length, 0);

      // isSaved on place is now false
      const getPlaceAfter = await authSession.fetch(`${baseUrl}/users/user-http/places/${placeId}`);
      const getPlaceAfterPayload = (await getPlaceAfter.json()) as { place: { isSaved: boolean } };
      assert.equal(getPlaceAfterPayload.place.isSaved, false);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
    }
  });
});

test('backend returns 400 for invalid collection input', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath,
    });
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    await backend.start();

    try {
      authSession = await createTestAuthSession(baseUrl, 'user-val');

      const response = await authSession.fetch(`${baseUrl}/users/user-val/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notName: 'bad' }),
      });

      assert.equal(response.status, 400);

      const payload = (await response.json()) as { error: string };
      assert.ok(payload.error);
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      await backend.stop();
    }
  });
});

// ── CLI command tests ───────────────────────────────────────────────────

test('CLI collections workflow: create, list, add-place, list-places, remove', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'cli.sqlite');

    // Initialize database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', databasePath]);

    // Create a collection
    const createOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:create',
      '--db', databasePath,
      '--user', 'cli-user',
      '--collection-name', 'CLI Favorites',
    ]);

    const createResult = JSON.parse(createOutput.stdout) as { id: string; name: string; placeCount: number };
    assert.equal(createResult.name, 'CLI Favorites');
    assert.equal(createResult.placeCount, 0);
    assert.ok(createResult.id);

    const collectionId = createResult.id;

    // List collections
    const listOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:list',
      '--db', databasePath,
      '--user', 'cli-user',
    ]);

    const listResult = JSON.parse(listOutput.stdout) as Array<{ id: string; name: string }>;
    assert.equal(listResult.length, 1);
    assert.equal(listResult[0]?.name, 'CLI Favorites');

    // Create a place to add
    const placeOutput = await runNodeTsxCommand(cliEntrypoint, [
      'places:upsert-google',
      '--db', databasePath,
      '--user', 'cli-user',
      '--name', 'CLI Cafe',
      '--lat', '37.7749',
      '--lng', '-122.4194',
      '--google-place-id', 'gp-cli-col-test',
    ]);

    const placeResult = JSON.parse(placeOutput.stdout) as { id: string };
    const placeId = placeResult.id;

    // Add place to collection
    const addOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:add-place',
      '--db', databasePath,
      '--user', 'cli-user',
      '--collection-id', collectionId,
      '--place-id', placeId,
    ]);

    const addResult = JSON.parse(addOutput.stdout) as { added: boolean };
    assert.equal(addResult.added, true);

    // List places in collection
    const listPlacesOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:list-places',
      '--db', databasePath,
      '--user', 'cli-user',
      '--collection-id', collectionId,
    ]);

    const listPlacesResult = JSON.parse(listPlacesOutput.stdout) as Array<{ id: string; name: string }>;
    assert.equal(listPlacesResult.length, 1);
    assert.equal(listPlacesResult[0]?.name, 'CLI Cafe');

    // Get collection — placeCount should be 1
    const getOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:get',
      '--db', databasePath,
      '--user', 'cli-user',
      '--collection-id', collectionId,
    ]);

    const getResult = JSON.parse(getOutput.stdout) as { placeCount: number };
    assert.equal(getResult.placeCount, 1);

    // Remove place from collection
    const removePlaceOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:remove-place',
      '--db', databasePath,
      '--user', 'cli-user',
      '--collection-id', collectionId,
      '--place-id', placeId,
    ]);

    const removePlaceResult = JSON.parse(removePlaceOutput.stdout) as { removed: boolean };
    assert.equal(removePlaceResult.removed, true);

    // Remove collection
    const removeOutput = await runNodeTsxCommand(cliEntrypoint, [
      'collections:remove',
      '--db', databasePath,
      '--user', 'cli-user',
      '--collection-id', collectionId,
    ]);

    const removeResult = JSON.parse(removeOutput.stdout) as { removed: boolean };
    assert.equal(removeResult.removed, true);

    // List should be empty
    const listAfterRemove = await runNodeTsxCommand(cliEntrypoint, [
      'collections:list',
      '--db', databasePath,
      '--user', 'cli-user',
    ]);

    const listAfterResult = JSON.parse(listAfterRemove.stdout) as Array<{ id: string }>;
    assert.equal(listAfterResult.length, 0);
  });
});
