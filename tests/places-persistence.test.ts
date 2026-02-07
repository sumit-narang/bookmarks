/**
 * Places persistence integration tests.
 *
 * Covers local repository behavior: upsert, list, get, remove,
 * google_place_id dedup, and derived isSaved status from collection membership.
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
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import type { DatabaseAdapter } from '../db/src';
import {
  getPlace,
  listPlaces,
  removePlace,
  upsertPlace,
} from '../places/src';
import { schemaMigrations } from '../schema/src';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const cliEntrypoint = resolve(repositoryRoot, 'apps', 'cli', 'src', 'index.ts');

const withTemporaryDatabase = async (
  run: (database: DatabaseAdapter, databasePath: string) => Promise<void>
): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'bookmarks-places-'));
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
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-places-runtime-'));

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

const waitForBackendHealth = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient connection errors while process is still booting.
    }

    await delay(100);
  }

  throw new Error(`Backend was not healthy within ${timeoutMs}ms (${baseUrl}/health).`);
};

// ── Local repository tests ──────────────────────────────────────────────

test('upsertPlace creates a new place and returns it with isSaved=false', async () => {
  await withTemporaryDatabase(async (database) => {
    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: {
        name: 'Central Park',
        latitude: 40.785091,
        longitude: -73.968285,
        googlePlaceId: 'gp-central-park',
      },
    });

    assert.ok(place.id);
    assert.equal(place.userId, 'user-a');
    assert.equal(place.name, 'Central Park');
    assert.equal(place.latitude, 40.785091);
    assert.equal(place.longitude, -73.968285);
    assert.equal(place.googlePlaceId, 'gp-central-park');
    assert.equal(place.isSaved, false);
    assert.equal(place.deletedAt, null);
  });
});

test('upsertPlace deduplicates by google_place_id for same user', async () => {
  await withTemporaryDatabase(async (database) => {
    const first = await upsertPlace(database, {
      userId: 'user-a',
      input: {
        name: 'Original Name',
        latitude: 40.0,
        longitude: -74.0,
        googlePlaceId: 'gp-dedup-test',
      },
    });

    const second = await upsertPlace(database, {
      userId: 'user-a',
      input: {
        name: 'Updated Name',
        latitude: 41.0,
        longitude: -75.0,
        googlePlaceId: 'gp-dedup-test',
      },
    });

    // Same row was updated — same ID
    assert.equal(second.id, first.id);
    assert.equal(second.name, 'Updated Name');
    assert.equal(second.latitude, 41.0);
    assert.equal(second.longitude, -75.0);

    // Only one place for this user
    const places = await listPlaces(database, 'user-a');
    assert.equal(places.length, 1);
  });
});

test('upsertPlace creates separate rows for different users with same google_place_id', async () => {
  await withTemporaryDatabase(async (database) => {
    const placeA = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Cafe', latitude: 1.0, longitude: 2.0, googlePlaceId: 'gp-shared' },
    });

    const placeB = await upsertPlace(database, {
      userId: 'user-b',
      input: { name: 'Cafe', latitude: 1.0, longitude: 2.0, googlePlaceId: 'gp-shared' },
    });

    assert.notEqual(placeA.id, placeB.id);
    assert.equal(placeA.userId, 'user-a');
    assert.equal(placeB.userId, 'user-b');
  });
});

test('upsertPlace without googlePlaceId always inserts new rows', async () => {
  await withTemporaryDatabase(async (database) => {
    const first = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Place A', latitude: 10.0, longitude: 20.0 },
    });

    const second = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Place B', latitude: 30.0, longitude: 40.0 },
    });

    assert.notEqual(first.id, second.id);

    const places = await listPlaces(database, 'user-a');
    assert.equal(places.length, 2);
  });
});

test('listPlaces returns places ordered by created_at desc', async () => {
  await withTemporaryDatabase(async (database) => {
    await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'First', latitude: 1.0, longitude: 1.0, googlePlaceId: 'gp-first' },
    });

    // Small delay so created_at differs
    await new Promise((r) => setTimeout(r, 10));

    await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Second', latitude: 2.0, longitude: 2.0, googlePlaceId: 'gp-second' },
    });

    const places = await listPlaces(database, 'user-a');
    assert.equal(places.length, 2);

    const firstPlace = places[0];
    const secondPlace = places[1];
    assert.ok(firstPlace);
    assert.ok(secondPlace);
    assert.equal(firstPlace.name, 'Second');
    assert.equal(secondPlace.name, 'First');
  });
});

test('listPlaces excludes deleted places', async () => {
  await withTemporaryDatabase(async (database) => {
    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'To Delete', latitude: 5.0, longitude: 5.0 },
    });

    await removePlace(database, 'user-a', place.id);

    const places = await listPlaces(database, 'user-a');
    assert.equal(places.length, 0);
  });
});

test('getPlace returns null for non-existent place', async () => {
  await withTemporaryDatabase(async (database) => {
    const result = await getPlace(database, 'user-a', 'non-existent-id');
    assert.equal(result, null);
  });
});

test('removePlace returns false for non-existent place', async () => {
  await withTemporaryDatabase(async (database) => {
    const removed = await removePlace(database, 'user-a', 'non-existent-id');
    assert.equal(removed, false);
  });
});

test('removePlace soft-deletes and is idempotent', async () => {
  await withTemporaryDatabase(async (database) => {
    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Temp Place', latitude: 7.0, longitude: 8.0 },
    });

    const firstRemove = await removePlace(database, 'user-a', place.id);
    assert.equal(firstRemove, true);

    // Second remove returns false (already deleted)
    const secondRemove = await removePlace(database, 'user-a', place.id);
    assert.equal(secondRemove, false);
  });
});

// ── Derived isSaved tests ───────────────────────────────────────────────

test('isSaved is true when place has a collection membership', async () => {
  await withTemporaryDatabase(async (database) => {
    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Saved Place', latitude: 10.0, longitude: 20.0 },
    });

    assert.equal(place.isSaved, false);

    // Create a collection and add the place to it
    const timestamp = new Date().toISOString();

    await database.run(
      `INSERT INTO collections (id, user_id, name, cover_image, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL, ?, ?, NULL);`,
      ['col-1', 'user-a', 'Favorites', timestamp, timestamp]
    );

    await database.run(
      `INSERT INTO collection_places (collection_id, place_id, position, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL);`,
      ['col-1', place.id, 0, timestamp, timestamp]
    );

    const fetched = await getPlace(database, 'user-a', place.id);
    assert.ok(fetched);
    assert.equal(fetched.isSaved, true);

    // Verify list also returns isSaved=true
    const places = await listPlaces(database, 'user-a');
    const listedPlace = places[0];
    assert.ok(listedPlace);
    assert.equal(listedPlace.isSaved, true);
  });
});

test('isSaved becomes false after collection membership is soft-deleted', async () => {
  await withTemporaryDatabase(async (database) => {
    const place = await upsertPlace(database, {
      userId: 'user-a',
      input: { name: 'Unsaved Later', latitude: 15.0, longitude: 25.0 },
    });

    const timestamp = new Date().toISOString();

    await database.run(
      `INSERT INTO collections (id, user_id, name, cover_image, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL, ?, ?, NULL);`,
      ['col-2', 'user-a', 'Travel', timestamp, timestamp]
    );

    await database.run(
      `INSERT INTO collection_places (collection_id, place_id, position, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL);`,
      ['col-2', place.id, 0, timestamp, timestamp]
    );

    const beforeSoftDelete = await getPlace(database, 'user-a', place.id);
    assert.ok(beforeSoftDelete);
    assert.equal(beforeSoftDelete.isSaved, true);

    // Soft-delete the membership
    await database.run(
      `UPDATE collection_places SET deleted_at = ? WHERE collection_id = ? AND place_id = ?;`,
      [new Date().toISOString(), 'col-2', place.id]
    );

    const afterSoftDelete = await getPlace(database, 'user-a', place.id);
    assert.ok(afterSoftDelete);
    assert.equal(afterSoftDelete.isSaved, false);
  });
});

test('place validation rejects invalid coordinates', async () => {
  await withTemporaryDatabase(async (database) => {
    await assert.rejects(
      () => upsertPlace(database, {
        userId: 'user-a',
        input: { name: 'Bad Lat', latitude: 999, longitude: 0 },
      }),
      { message: /latitude must be between/ }
    );

    await assert.rejects(
      () => upsertPlace(database, {
        userId: 'user-a',
        input: { name: 'Bad Lng', latitude: 0, longitude: -999 },
      }),
      { message: /longitude must be between/ }
    );
  });
});

test('place validation rejects empty name', async () => {
  await withTemporaryDatabase(async (database) => {
    await assert.rejects(
      () => upsertPlace(database, {
        userId: 'user-a',
        input: { name: '  ', latitude: 10, longitude: 20 },
      }),
      { message: /Place name is required/ }
    );
  });
});

// ── Backend HTTP route tests ────────────────────────────────────────────

test('backend place routes: upsert, list, get, delete', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath,
    });

    await backend.start();

    try {
      // Upsert a place
      const upsertResponse = await fetch(`${baseUrl}/users/user-http/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'HTTP Cafe',
          latitude: 34.05,
          longitude: -118.25,
          googlePlaceId: 'gp-http-cafe',
          address: '123 Main St',
        }),
      });

      assert.equal(upsertResponse.status, 200);

      const upsertPayload = (await upsertResponse.json()) as { place: { id: string; name: string; isSaved: boolean } };
      assert.equal(upsertPayload.place.name, 'HTTP Cafe');
      assert.equal(upsertPayload.place.isSaved, false);

      const placeId = upsertPayload.place.id;

      // List places
      const listResponse = await fetch(`${baseUrl}/users/user-http/places`);
      assert.equal(listResponse.status, 200);

      const listPayload = (await listResponse.json()) as { places: Array<{ id: string }> };
      assert.equal(listPayload.places.length, 1);

      const listedPlace = listPayload.places[0];
      assert.ok(listedPlace);
      assert.equal(listedPlace.id, placeId);

      // Get single place
      const getResponse = await fetch(`${baseUrl}/users/user-http/places/${placeId}`);
      assert.equal(getResponse.status, 200);

      const getPayload = (await getResponse.json()) as { place: { id: string; name: string } };
      assert.equal(getPayload.place.id, placeId);
      assert.equal(getPayload.place.name, 'HTTP Cafe');

      // Upsert same google_place_id — should update, not create
      const upsertAgainResponse = await fetch(`${baseUrl}/users/user-http/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'HTTP Cafe Updated',
          latitude: 34.06,
          longitude: -118.26,
          googlePlaceId: 'gp-http-cafe',
        }),
      });

      assert.equal(upsertAgainResponse.status, 200);

      const upsertAgainPayload = (await upsertAgainResponse.json()) as { place: { id: string; name: string } };
      assert.equal(upsertAgainPayload.place.id, placeId);
      assert.equal(upsertAgainPayload.place.name, 'HTTP Cafe Updated');

      // Still only one place
      const listAfterUpdate = await fetch(`${baseUrl}/users/user-http/places`);
      const listAfterPayload = (await listAfterUpdate.json()) as { places: Array<{ id: string }> };
      assert.equal(listAfterPayload.places.length, 1);

      // Delete place
      const deleteResponse = await fetch(`${baseUrl}/users/user-http/places/${placeId}`, {
        method: 'DELETE',
      });

      assert.equal(deleteResponse.status, 200);

      const deletePayload = (await deleteResponse.json()) as { removed: boolean };
      assert.equal(deletePayload.removed, true);

      // Place no longer listed
      const listAfterDelete = await fetch(`${baseUrl}/users/user-http/places`);
      const listAfterDeletePayload = (await listAfterDelete.json()) as { places: Array<{ id: string }> };
      assert.equal(listAfterDeletePayload.places.length, 0);

      // Get returns 404
      const getAfterDelete = await fetch(`${baseUrl}/users/user-http/places/${placeId}`);
      assert.equal(getAfterDelete.status, 404);
    } finally {
      await backend.stop();
    }
  });
});

test('backend returns 400 for invalid place input', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath,
    });

    await backend.start();

    try {
      const response = await fetch(`${baseUrl}/users/user-val/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Coords' }),
      });

      assert.equal(response.status, 400);

      const payload = (await response.json()) as { error: string };
      assert.ok(payload.error);
    } finally {
      await backend.stop();
    }
  });
});

// ── CLI command tests ───────────────────────────────────────────────────

test('CLI places:upsert-google + places:list + places:remove workflow', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'cli.sqlite');

    // Initialize database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', databasePath]);

    // Upsert a place
    const upsertOutput = await runNodeTsxCommand(cliEntrypoint, [
      'places:upsert-google',
      '--db', databasePath,
      '--user', 'cli-user',
      '--name', 'CLI Coffee Shop',
      '--lat', '37.7749',
      '--lng', '-122.4194',
      '--google-place-id', 'gp-cli-coffee',
      '--address', '456 Market St',
    ]);

    const upsertResult = JSON.parse(upsertOutput.stdout) as { id: string; name: string; googlePlaceId: string };
    assert.equal(upsertResult.name, 'CLI Coffee Shop');
    assert.equal(upsertResult.googlePlaceId, 'gp-cli-coffee');
    assert.ok(upsertResult.id);

    // List places
    const listOutput = await runNodeTsxCommand(cliEntrypoint, [
      'places:list',
      '--db', databasePath,
      '--user', 'cli-user',
    ]);

    const listResult = JSON.parse(listOutput.stdout) as Array<{ id: string; name: string }>;
    assert.equal(listResult.length, 1);

    const listedPlace = listResult[0];
    assert.ok(listedPlace);
    assert.equal(listedPlace.name, 'CLI Coffee Shop');

    // Remove place
    const removeOutput = await runNodeTsxCommand(cliEntrypoint, [
      'places:remove',
      '--db', databasePath,
      '--user', 'cli-user',
      '--place-id', upsertResult.id,
    ]);

    const removeResult = JSON.parse(removeOutput.stdout) as { removed: boolean };
    assert.equal(removeResult.removed, true);

    // List should be empty
    const listAfterRemove = await runNodeTsxCommand(cliEntrypoint, [
      'places:list',
      '--db', databasePath,
      '--user', 'cli-user',
    ]);

    const listAfterResult = JSON.parse(listAfterRemove.stdout) as Array<{ id: string }>;
    assert.equal(listAfterResult.length, 0);
  });
});
