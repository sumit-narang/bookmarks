/**
 * CLI sync commands integration tests.
 *
 * Tests sync:push, sync:pull, and sync:run via actual CLI invocation.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createBackendServer } from '../apps/backend/src/server';
import { createNodeSqliteAdapter, migrateDatabase } from '../db/src';
import { schemaMigrations } from '../schema/src';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const cliEntrypoint = resolve(repositoryRoot, 'apps', 'cli', 'src', 'index.ts');

interface CommandOutput {
  stdout: string;
  stderr: string;
}

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-cli-sync-'));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runNodeTsxCommand = async (
  entrypoint: string,
  args: readonly string[],
  environment: Record<string, string> = {}
): Promise<CommandOutput> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (error) => { rejectPromise(error); });

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
        if (error) { rejectPromise(error); return; }
        resolvePromise(address.port);
      });
    });
    server.on('error', (error) => { rejectPromise(error); });
  });
};

interface SyncPushResult {
  preferences: {
    pendingCount: number;
    eligibleCount: number;
    pushedCount: number;
    skippedDeadLetterCount: number;
  };
  places: {
    pendingCount: number;
    eligibleCount: number;
    pushedCount: number;
    skippedDeadLetterCount: number;
  };
  collections: {
    pendingCount: number;
    eligibleCount: number;
    pushedCount: number;
    skippedDeadLetterCount: number;
  };
}

interface SyncPullResult {
  preferences: {
    hadRemotePreference: boolean;
    appliedRemotePreference: boolean;
    cursor: string | null;
  };
  places: {
    fetchedCount: number;
    appliedCount: number;
    cursor: string | null;
  };
  collections: {
    fetchedCount: number;
    appliedCount: number;
    cursor: string | null;
  };
}

interface SyncRunResult {
  push: SyncPushResult;
  pull: SyncPullResult;
}

const countPendingOutbox = async (database: ReturnType<typeof createNodeSqliteAdapter>, userId: string): Promise<number> => {
  const row = await database.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM outbox WHERE user_id = ? AND processed_at IS NULL;`,
    [userId]
  );
  return row?.count ?? 0;
};

test('sync:push pushes all entity types to backend', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'cli-sync-push-user';

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: backendDbPath,
    });

    const { port } = await backend.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Initialize local database
      await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

      // Seed local data: preferences
      await runNodeTsxCommand(cliEntrypoint, [
        'preferences:set',
        '--db', localDbPath,
        '--user', userId,
        '--theme', 'slate',
        '--variant', 'tall',
        '--size', '100',
      ]);

      // Seed local data: places
      const placeOutput = await runNodeTsxCommand(cliEntrypoint, [
        'places:upsert-google',
        '--db', localDbPath,
        '--user', userId,
        '--name', 'CLI Push Place',
        '--lat', '40.7128',
        '--lng', '-74.0060',
        '--google-place-id', 'gp-cli-push-place',
        '--address', '123 Broadway',
      ]);
      const placeResult = JSON.parse(placeOutput.stdout) as { id: string };
      const placeId = placeResult.id;

      // Seed local data: collection
      const collectionOutput = await runNodeTsxCommand(cliEntrypoint, [
        'collections:create',
        '--db', localDbPath,
        '--user', userId,
        '--collection-name', 'CLI Test Collection',
      ]);
      const collectionResult = JSON.parse(collectionOutput.stdout) as { id: string };
      const collectionId = collectionResult.id;

      // Add place to collection
      await runNodeTsxCommand(cliEntrypoint, [
        'collections:add-place',
        '--db', localDbPath,
        '--user', userId,
        '--collection-id', collectionId,
        '--place-id', placeId,
      ]);

      // Verify local outbox has pending mutations before push
      const localDb = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb, schemaMigrations);
      const pendingBefore = await countPendingOutbox(localDb, userId);
      assert.ok(pendingBefore > 0, 'Should have pending outbox entries before push');
      await localDb.close();

      // Run sync:push
      const pushOutput = await runNodeTsxCommand(cliEntrypoint, [
        'sync:push',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);

      const pushResult = JSON.parse(pushOutput.stdout) as SyncPushResult;

      // Assert: output has all entity type keys
      assert.ok(pushResult.preferences, 'Push result should have preferences');
      assert.ok(pushResult.places, 'Push result should have places');
      assert.ok(pushResult.collections, 'Push result should have collections');

      // Assert: backend has corresponding state
      const backendPrefsResponse = await fetch(`${baseUrl}/users/${userId}/preferences`);
      assert.equal(backendPrefsResponse.status, 200);
      const backendPrefs = (await backendPrefsResponse.json()) as { preferences: { hexagonTheme: string } };
      assert.equal(backendPrefs.preferences.hexagonTheme, 'slate');

      const backendPlacesResponse = await fetch(`${baseUrl}/users/${userId}/places`);
      assert.equal(backendPlacesResponse.status, 200);
      const backendPlaces = (await backendPlacesResponse.json()) as { places: Array<{ name: string }> };
      assert.equal(backendPlaces.places.length, 1);
      assert.equal(backendPlaces.places[0]?.name, 'CLI Push Place');

      const backendCollectionsResponse = await fetch(`${baseUrl}/users/${userId}/collections`);
      assert.equal(backendCollectionsResponse.status, 200);
      const backendCollections = (await backendCollectionsResponse.json()) as { collections: Array<{ id: string; name: string }> };
      assert.equal(backendCollections.collections.length, 1);
      assert.equal(backendCollections.collections[0]?.name, 'CLI Test Collection');

      // Assert: backend has membership (place in collection)
      const backendCollectionId = backendCollections.collections[0]?.id;
      const backendMembershipResponse = await fetch(`${baseUrl}/users/${userId}/collections/${backendCollectionId}/places`);
      assert.equal(backendMembershipResponse.status, 200);
      const backendMembership = (await backendMembershipResponse.json()) as { places: unknown[] };
      assert.equal(backendMembership.places.length, 1, 'Backend should have place in collection after push');

      // Assert: local outbox is empty (processed_at IS NULL = 0)
      const localDbAfter = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDbAfter, schemaMigrations);
      const pendingAfter = await countPendingOutbox(localDbAfter, userId);
      assert.equal(pendingAfter, 0, 'Outbox should be empty after successful push');
      await localDbAfter.close();
    } finally {
      await backend.stop();
    }
  });
});

test('sync:pull pulls all entity types from backend', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'cli-sync-pull-user';

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: backendDbPath,
    });

    const { port } = await backend.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Initialize local database (creates default preferences)
      await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

      // Seed backend state: preferences via HTTP with deterministic far-future timestamp
      // Using 2099 ensures this will always be later than any local defaults
      const farFutureTimestamp = '2099-01-01T00:00:00.000Z';
      const prefsResponse = await fetch(`${baseUrl}/users/${userId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hexagonTheme: 'obsidian',
          hexagonVariant: 'short',
          hexagonSize: 60,
          hexagonCustomDepth: 16,
          hexagonUseCustomDepth: false,
          updatedAt: farFutureTimestamp,
        }),
      });
      assert.equal(prefsResponse.status, 200);

      // Seed backend state: place via HTTP
      const placeResponse = await fetch(`${baseUrl}/users/${userId}/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'CLI Pulled Place',
          latitude: 51.5074,
          longitude: -0.1278,
          googlePlaceId: 'gp-cli-pulled-place',
          address: 'London Bridge',
        }),
      });
      assert.equal(placeResponse.status, 200);
      const placeData = (await placeResponse.json()) as { place: { id: string } };
      const placeId = placeData.place.id;

      // Seed backend state: collection via HTTP
      const collectionResponse = await fetch(`${baseUrl}/users/${userId}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CLI Pulled Collection' }),
      });
      assert.equal(collectionResponse.status, 201);
      const collectionData = (await collectionResponse.json()) as { collection: { id: string } };
      const collectionId = collectionData.collection.id;

      // Add place to collection
      const membershipResponse = await fetch(`${baseUrl}/users/${userId}/collections/${collectionId}/places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId }),
      });
      assert.equal(membershipResponse.status, 200);

      // Run sync:pull
      const pullOutput = await runNodeTsxCommand(cliEntrypoint, [
        'sync:pull',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);

      const pullResult = JSON.parse(pullOutput.stdout) as SyncPullResult;

      // Assert: output has all entity type keys with correct shape
      assert.ok(pullResult.preferences, 'Pull result should have preferences');
      assert.ok(pullResult.places, 'Pull result should have places');
      assert.ok(pullResult.collections, 'Pull result should have collections');

      // Assert: preference pull response contract
      assert.equal(pullResult.preferences.hadRemotePreference, true,
        'Should report that remote had a preference');
      assert.equal(pullResult.preferences.appliedRemotePreference, true,
        'Should report that remote preference was applied (far-future timestamp wins)');
      assert.ok(pullResult.preferences.cursor !== null,
        'Preference pull cursor should be non-null');

      // Assert: local DB contains pulled data
      const localDb = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb, schemaMigrations);

      const localPrefs = await localDb.get<{ hexagon_theme: string }>(
        `SELECT hexagon_theme FROM preferences WHERE user_id = ?;`,
        [userId]
      );
      // After sync:pull, local should have the pulled preferences (obsidian theme)
      assert.ok(localPrefs, 'Should have preferences row after sync');
      assert.equal(localPrefs?.hexagon_theme, 'obsidian',
        'Local preferences should match the pulled remote preferences');

      const localPlaces = await localDb.all<{ name: string }>(
        `SELECT name FROM places WHERE user_id = ? AND deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(localPlaces.length, 1);
      assert.equal(localPlaces[0]?.name, 'CLI Pulled Place');

      const localCollections = await localDb.all<{ name: string }>(
        `SELECT name FROM collections WHERE user_id = ? AND deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(localCollections.length, 1);
      assert.equal(localCollections[0]?.name, 'CLI Pulled Collection');

      // Assert: membership is reconciled - place should be in collection
      const membershipCount = await localDb.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM collection_places cp
         JOIN collections c ON cp.collection_id = c.id
         WHERE c.user_id = ? AND cp.deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(membershipCount?.count, 1, 'Collection membership should be reconciled');

      // Assert: sync_state rows exist for all 3 entity types
      const syncStates = await localDb.all<{ entity_type: string }>(
        `SELECT entity_type FROM sync_state WHERE user_id = ?;`,
        [userId]
      );
      const entityTypes = syncStates.map(s => s.entity_type);
      assert.ok(entityTypes.includes('preferences'), 'Should have preferences sync_state');
      assert.ok(entityTypes.includes('places'), 'Should have places sync_state');
      assert.ok(entityTypes.includes('collections'), 'Should have collections sync_state');

      await localDb.close();
    } finally {
      await backend.stop();
    }
  });
});

test('sync:run executes push then pull sequence', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'cli-sync-run-user';

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: backendDbPath,
    });

    const { port } = await backend.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Initialize local database
      await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

      // Seed local with initial data
      await runNodeTsxCommand(cliEntrypoint, [
        'places:upsert-google',
        '--db', localDbPath,
        '--user', userId,
        '--name', 'Initial Place',
        '--lat', '35.0',
        '--lng', '-100.0',
        '--google-place-id', 'gp-initial-place',
      ]);

      // First sync:run - should push local outbox
      const runOutput1 = await runNodeTsxCommand(cliEntrypoint, [
        'sync:run',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);

      const runResult1 = JSON.parse(runOutput1.stdout) as SyncRunResult;
      assert.equal(runResult1.push.places.pushedCount, 1, 'First run should push the place');

      // Verify outbox is empty after first run
      const localDb1 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb1, schemaMigrations);
      const pendingAfterFirst = await countPendingOutbox(localDb1, userId);
      assert.equal(pendingAfterFirst, 0, 'Outbox should be empty after first sync:run');
      await localDb1.close();

      // Mutate backend directly to create newer state
      const updatedPlaceResponse = await fetch(`${baseUrl}/users/${userId}/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated From Backend',
          latitude: 36.0,
          longitude: -101.0,
          googlePlaceId: 'gp-initial-place',
          address: 'Updated Address',
        }),
      });
      assert.equal(updatedPlaceResponse.status, 200);

      // Second sync:run - should pull backend newer state
      const runOutput2 = await runNodeTsxCommand(cliEntrypoint, [
        'sync:run',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);

      const runResult2 = JSON.parse(runOutput2.stdout) as SyncRunResult;
      assert.equal(runResult2.pull.places.appliedCount, 1, 'Second run should pull the updated place');

      // Assert: final local values match backend newer values
      const localDb2 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb2, schemaMigrations);

      const localPlace = await localDb2.get<{ name: string; address: string | null }>(
        `SELECT name, address FROM places WHERE user_id = ? AND google_place_id = ? AND deleted_at IS NULL;`,
        [userId, 'gp-initial-place']
      );
      assert.ok(localPlace);
      assert.equal(localPlace?.name, 'Updated From Backend');
      assert.equal(localPlace?.address, 'Updated Address');

      // Assert: pending outbox is still empty
      const pendingAfterSecond = await countPendingOutbox(localDb2, userId);
      assert.equal(pendingAfterSecond, 0, 'Outbox should remain empty after second sync:run');

      await localDb2.close();
    } finally {
      await backend.stop();
    }
  });
});

test('sync:push fails with unreachable remote-url', { timeout: 10_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    // Acquire a free port then never listen on it — guarantees nothing is there
    const unreachablePort = await getAvailablePort();
    const unreachableUrl = `http://127.0.0.1:${unreachablePort}`;
    const userId = 'cli-sync-error-user';

    // Initialize local database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

    // Seed with some data
    await runNodeTsxCommand(cliEntrypoint, [
      'places:upsert-google',
      '--db', localDbPath,
      '--user', userId,
      '--name', 'Error Test Place',
      '--lat', '40.0',
      '--lng', '-74.0',
      '--google-place-id', 'gp-error-place',
    ]);

    // Attempt sync:push with unreachable URL - should fail
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', unreachableUrl,
        ]);
      },
      (error: Error) => {
        // Command should fail with non-zero exit code
        assert.ok(error.message.includes('Command failed with code'), 'Should fail with non-zero exit code');
        // Error message should be present
        assert.ok(error.message.length > 0, 'Error should have message');
        return true;
      }
    );
  });
});

test('sync:push rejects invalid --max-attempts values', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const userId = 'cli-max-attempts-validation-user';

    // Initialize local database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

    // --max-attempts 0 should fail (must be positive integer)
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', 'http://127.0.0.1:1',
          '--max-attempts', '0',
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('positive integer'),
          'Should reject --max-attempts 0 with positive integer message');
        return true;
      }
    );

    // --max-attempts -1 should fail
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', 'http://127.0.0.1:1',
          '--max-attempts', '-1',
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('positive integer'),
          'Should reject --max-attempts -1 with positive integer message');
        return true;
      }
    );

    // --max-attempts 1.5 should fail (not an integer)
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', 'http://127.0.0.1:1',
          '--max-attempts', '1.5',
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('positive integer'),
          'Should reject --max-attempts 1.5 with positive integer message');
        return true;
      }
    );
  });
});

test('sync:push rejects invalid --batch-limit values', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const userId = 'cli-batch-limit-validation-user';

    // Initialize local database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

    // --batch-limit 0 should fail (must be positive integer)
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', 'http://127.0.0.1:1',
          '--batch-limit', '0',
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('positive integer'),
          'Should reject --batch-limit 0 with positive integer message');
        return true;
      }
    );

    // --batch-limit -1 should fail
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', 'http://127.0.0.1:1',
          '--batch-limit', '-1',
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('positive integer'),
          'Should reject --batch-limit -1 with positive integer message');
        return true;
      }
    );

    // --batch-limit 2.5 should fail (not an integer)
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', 'http://127.0.0.1:1',
          '--batch-limit', '2.5',
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('positive integer'),
          'Should reject --batch-limit 2.5 with positive integer message');
        return true;
      }
    );
  });
});
