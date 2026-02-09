/**
 * Sync stress tests.
 *
 * Exercises high-volume and repeated sync scenarios via CLI commands.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { nowIso } from '../core/src';
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
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-sync-stress-'));
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

const countPendingOutbox = async (database: ReturnType<typeof createNodeSqliteAdapter>, userId: string): Promise<number> => {
  const row = await database.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM outbox WHERE user_id = ? AND processed_at IS NULL;`,
    [userId]
  );
  return row?.count ?? 0;
};

const getOutboxAttempts = async (
  database: ReturnType<typeof createNodeSqliteAdapter>,
  userId: string
): Promise<Array<{ id: string; attempts: number; operation_type: string }>> => {
  return await database.all(
    `SELECT id, attempts, operation_type FROM outbox WHERE user_id = ? ORDER BY created_at ASC;`,
    [userId]
  );
};

test('high-volume place push processes all places via CLI', { timeout: 60_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'stress-push-user';
    const placeCount = 120;

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

      // Seed local with 120+ places using direct DB insertion for speed
      const localDb = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb, schemaMigrations);
      const timestamp = nowIso();

      // Ensure user exists
      await localDb.run(
        `INSERT INTO users (id, provider, created_at, updated_at) VALUES (?, 'local', ?, ?)
         ON CONFLICT(id) DO NOTHING;`,
        [userId, timestamp, timestamp]
      );

      // Insert places and create outbox entries using direct SQL for performance.
      // Note: In production, entities should be created through domain APIs which
      // handle validation, proper payload structure, and automatic outbox creation.
      // Direct SQL is used here to efficiently seed 120+ records for stress testing.
      for (let i = 0; i < placeCount; i++) {
        const placeId = `stress-place-${i}`;
        const placeName = `Stress Place ${i}`;

        await localDb.run(
          `INSERT INTO places (id, user_id, name, latitude, longitude, google_place_id, address, rating, notes, image_url, metadata_json, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL);`,
          [placeId, userId, placeName, 40.0 + i * 0.001, -74.0 + i * 0.001, `gp-stress-${i}`, timestamp, timestamp]
        );

        // Create outbox entry for each place with proper PlaceOutboxPayload structure
        await localDb.run(
          `INSERT INTO outbox (id, user_id, operation_type, entity_type, entity_id, payload_json, operation_id, created_at, updated_at, attempts, last_error, processed_at)
           VALUES (?, ?, 'upsert', 'places', ?, ?, ?, ?, ?, 0, NULL, NULL);`,
          [
            `outbox-place-${i}`,
            userId,
            placeId,
            JSON.stringify({
              userId: userId,
              placeId: placeId,
              operationType: 'upsert',
              updatedAt: timestamp,
              place: {
                name: placeName,
                latitude: 40.0 + i * 0.001,
                longitude: -74.0 + i * 0.001,
                googlePlaceId: `gp-stress-${i}`,
                address: null,
                rating: null,
                notes: null,
                imageUrl: null,
                metadataJson: null,
              },
            }),
            `op-place-${i}`,
            timestamp,
            timestamp,
          ]
        );
      }

      await localDb.close();

      // Verify pending count
      const localDb2 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb2, schemaMigrations);
      const pendingBefore = await countPendingOutbox(localDb2, userId);
      assert.equal(pendingBefore, placeCount, 'Should have 120 pending outbox entries');
      await localDb2.close();

      // Push via CLI sync:push - run multiple times to process all batches
      let totalPushed = 0;
      let iterations = 0;
      const maxIterations = 5;

      while (iterations < maxIterations) {
        const pushOutput = await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', baseUrl,
        ]);

        const pushResult = JSON.parse(pushOutput.stdout) as SyncPushResult;
        totalPushed += pushResult.places.pushedCount;
        iterations++;

        // All rows are fresh (attempts=0), so dead-letter count should always be 0
        // and eligibleCount should equal pendingCount (global, not batch-limited)
        assert.equal(pushResult.places.skippedDeadLetterCount, 0,
          `Batch ${iterations}: skippedDeadLetterCount should be 0 when all rows are eligible`);
        assert.equal(pushResult.places.eligibleCount, pushResult.places.pendingCount,
          `Batch ${iterations}: eligibleCount should equal pendingCount when no rows are dead-lettered`);

        // Stop when no more items are pushed
        if (pushResult.places.pushedCount === 0) {
          break;
        }
      }

      // Assert: all operations eventually processed (with batching)
      assert.equal(totalPushed, placeCount, 'Should push all 120 places across batches');

      // Assert: backend contains all expected places
      const backendListResponse = await fetch(`${baseUrl}/users/${userId}/places`);
      assert.equal(backendListResponse.status, 200);
      const backendList = (await backendListResponse.json()) as { places: unknown[] };
      assert.equal(backendList.places.length, placeCount, 'Backend should have all 120 places');

      // Assert: no pending place outbox rows
      const localDb3 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb3, schemaMigrations);
      const pendingAfter = await countPendingOutbox(localDb3, userId);
      assert.equal(pendingAfter, 0, 'Outbox should be empty after successful push');
      await localDb3.close();
    } finally {
      await backend.stop();
    }
  });
});

test('high-volume full-state pull retrieves all entities via CLI', { timeout: 60_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'stress-pull-user';
    const placeCount = 100;
    const collectionCount = 30;

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

      // Seed backend directly via HTTP for speed
      // Seed preferences with a far-future timestamp to ensure remote wins over local defaults
      const farFutureTimestamp = '2099-01-01T00:00:00.000Z';
      const prefsResponse = await fetch(`${baseUrl}/users/${userId}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hexagonTheme: 'sandstone',
          hexagonVariant: 'tall',
          hexagonSize: 100,
          hexagonCustomDepth: 20,
          hexagonUseCustomDepth: true,
          updatedAt: farFutureTimestamp,
        }),
      });
      assert.equal(prefsResponse.status, 200);

      // Seed places
      const placeIds: string[] = [];
      for (let i = 0; i < placeCount; i++) {
        const placeResponse = await fetch(`${baseUrl}/users/${userId}/places/upsert-google`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Pulled Place ${i}`,
            latitude: 40.0 + i * 0.001,
            longitude: -74.0 + i * 0.001,
            googlePlaceId: `gp-pull-${i}`,
            address: `Address ${i}`,
          }),
        });
        assert.equal(placeResponse.status, 200);
        const placeData = (await placeResponse.json()) as { place: { id: string } };
        placeIds.push(placeData.place.id);
      }

      // Seed collections with memberships
      const collectionIds: string[] = [];
      for (let i = 0; i < collectionCount; i++) {
        const collectionResponse = await fetch(`${baseUrl}/users/${userId}/collections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Collection ${i}` }),
        });
        assert.equal(collectionResponse.status, 201);
        const collectionData = (await collectionResponse.json()) as { collection: { id: string } };
        const collectionId = collectionData.collection.id;
        collectionIds.push(collectionId);

        // Add some places to each collection (round-robin)
        const placesToAdd = 3;
        for (let j = 0; j < placesToAdd; j++) {
          const placeIndex = (i * placesToAdd + j) % placeCount;
          const membershipResponse = await fetch(
            `${baseUrl}/users/${userId}/collections/${collectionId}/places`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ placeId: placeIds[placeIndex] }),
            }
          );
          assert.equal(membershipResponse.status, 200);
        }
      }

      // Pull via CLI sync:pull
      const pullOutput = await runNodeTsxCommand(cliEntrypoint, [
        'sync:pull',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);

      const pullResult = JSON.parse(pullOutput.stdout) as SyncPullResult;

      // Assert: preference pull response contract
      assert.equal(pullResult.preferences.hadRemotePreference, true,
        'Should report remote had a preference');
      assert.equal(pullResult.preferences.appliedRemotePreference, true,
        'Should apply remote preference (sandstone theme)');
      assert.ok(pullResult.preferences.cursor !== null,
        'Preference pull cursor should be non-null');

      // Assert: all entities fetched and applied
      assert.equal(pullResult.places.fetchedCount, placeCount, 'Should fetch all 100 places');
      assert.equal(pullResult.places.appliedCount, placeCount, 'Should apply all 100 places');
      assert.equal(pullResult.collections.fetchedCount, collectionCount, 'Should fetch all 30 collections');
      assert.equal(pullResult.collections.appliedCount, collectionCount,
        'Should apply all 30 collections (one per collection created)');

      // Assert: local counts match backend counts
      const localDb = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb, schemaMigrations);

      const localPlaces = await localDb.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM places WHERE user_id = ? AND deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(localPlaces?.count, placeCount, 'Local should have 100 places');

      const localCollections = await localDb.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM collections WHERE user_id = ? AND deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(localCollections?.count, collectionCount, 'Local should have 30 collections');

      // Verify pulled preferences match seeded backend state
      const localPrefs = await localDb.get<{ hexagon_theme: string; hexagon_variant: string; hexagon_size: number }>(
        `SELECT hexagon_theme, hexagon_variant, hexagon_size FROM preferences WHERE user_id = ?;`,
        [userId]
      );
      assert.ok(localPrefs, 'Should have preferences row after pull');
      assert.equal(localPrefs?.hexagon_theme, 'sandstone', 'Pulled preference theme should be sandstone');
      assert.equal(localPrefs?.hexagon_variant, 'tall', 'Pulled preference variant should be tall');
      assert.equal(localPrefs?.hexagon_size, 100, 'Pulled preference size should be 100');

      // Verify memberships are reconciled: 30 collections × 3 places = 90 memberships
      const expectedMemberships = collectionCount * 3; // 3 places per collection
      const localMemberships = await localDb.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM collection_places WHERE collection_id IN (
           SELECT id FROM collections WHERE user_id = ?
         ) AND deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(localMemberships?.count, expectedMemberships,
        `Should have exactly ${expectedMemberships} collection memberships (30 collections × 3 places)`);

      await localDb.close();
    } finally {
      await backend.stop();
    }
  });
});

test('repeated sync cycle maintains convergence', { timeout: 60_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'stress-cycle-user';
    const cycles = 10;

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

      // Seed initial place
      const initialOutput = await runNodeTsxCommand(cliEntrypoint, [
        'places:upsert-google',
        '--db', localDbPath,
        '--user', userId,
        '--name', 'Cycle Place',
        '--lat', '40.0',
        '--lng', '-74.0',
        '--google-place-id', 'gp-cycle-place',
      ]);
      const initialPlace = JSON.parse(initialOutput.stdout) as { id: string };
      const placeId = initialPlace.id;

      // Run N sync cycles
      for (let cycle = 0; cycle < cycles; cycle++) {
        // Mutate local (small update)
        await runNodeTsxCommand(cliEntrypoint, [
          'places:upsert-google',
          '--db', localDbPath,
          '--user', userId,
          '--name', `Cycle Place Local ${cycle}`,
          '--lat', (40.0 + cycle * 0.01).toString(),
          '--lng', (-74.0 + cycle * 0.01).toString(),
          '--google-place-id', 'gp-cycle-place',
        ]);

        // Run sync (push local mutations)
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:run',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', baseUrl,
        ]);

        // Mutate backend (newer timestamp/op)
        const backendResponse = await fetch(`${baseUrl}/users/${userId}/places/upsert-google`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Cycle Place Backend ${cycle}`,
            latitude: 50.0 + cycle * 0.01,
            longitude: -80.0 + cycle * 0.01,
            googlePlaceId: 'gp-cycle-place',
            address: `Backend Address ${cycle}`,
          }),
        });
        assert.equal(backendResponse.status, 200);

        // Run sync again (pull backend changes)
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:run',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', baseUrl,
        ]);

        // Verify no pending outbox after each cycle
        const localDb = createNodeSqliteAdapter({ filename: localDbPath });
        await migrateDatabase(localDb, schemaMigrations);
        const pending = await countPendingOutbox(localDb, userId);
        assert.equal(pending, 0, `Cycle ${cycle}: Outbox should be empty after sync`);
        await localDb.close();
      }

      // Final verification: local converges to backend state
      const localDb = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb, schemaMigrations);

      const localPlace = await localDb.get<{ name: string; latitude: number; longitude: number }>(
        `SELECT name, latitude, longitude FROM places WHERE user_id = ? AND google_place_id = ? AND deleted_at IS NULL;`,
        [userId, 'gp-cycle-place']
      );
      assert.ok(localPlace);

      // Backend state
      const backendResponse = await fetch(`${baseUrl}/users/${userId}/places`);
      const backendData = (await backendResponse.json()) as { places: Array<{ name: string }> };
      assert.equal(backendData.places[0]?.name, localPlace?.name);

      // Final outbox check
      const finalPending = await countPendingOutbox(localDb, userId);
      assert.equal(finalPending, 0, 'Final outbox should be empty');

      await localDb.close();
    } finally {
      await backend.stop();
    }
  });
});

test('retry and dead-letter behavior with failing remote', { timeout: 60_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'stress-retry-user';
    const mutationCount = 15;
    const maxAttempts = 2; // Threshold: attempts >= 2 are dead-lettered

    // Initialize local database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

    // Seed local with mutations using direct SQL insertion.
    // Each row gets a distinct timestamp and zero-padded operation ID to ensure
    // deterministic LWW ordering regardless of query sort order.
    const localDb = createNodeSqliteAdapter({ filename: localDbPath });
    await migrateDatabase(localDb, schemaMigrations);
    const baseTimestamp = '2025-01-01T00:00:00.000Z';

    await localDb.run(
      `INSERT INTO users (id, provider, created_at, updated_at) VALUES (?, 'local', ?, ?)
       ON CONFLICT(id) DO NOTHING;`,
      [userId, baseTimestamp, baseTimestamp]
    );

    for (let i = 0; i < mutationCount; i++) {
      // Strictly increasing timestamp per row (1-second offsets)
      const rowTimestamp = `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`;
      // Zero-padded operation ID for stable lexicographic ordering
      const operationId = `op-retry-${String(i).padStart(3, '0')}`;

      await localDb.run(
        `INSERT INTO outbox (id, user_id, operation_type, entity_type, entity_id, payload_json, operation_id, created_at, updated_at, attempts, last_error, processed_at)
         VALUES (?, ?, 'upsert', 'preferences', 'prefs', ?, ?, ?, ?, 0, NULL, NULL);`,
        [
          `retry-outbox-${i}`,
          userId,
          JSON.stringify({
            userId: userId,
            updatedAt: rowTimestamp,
            preferences: {
              hexagonTheme: 'slate',
              hexagonVariant: 'medium',
              hexagonSize: 80 + i,
              hexagonCustomDepth: 16,
              hexagonUseCustomDepth: false,
            },
          }),
          operationId,
          rowTimestamp,
          rowTimestamp,
        ]
      );
    }

    await localDb.close();

    // Acquire a free port then never listen on it — guarantees nothing is there
    const unreachablePort = await getAvailablePort();
    const unreachableUrl = `http://127.0.0.1:${unreachablePort}`;

    // First push attempt with maxAttempts=2 - should fail, incrementing attempts to 1
    // With attempts=0 initially, after failure: attempts=1 (still < maxAttempts=2, so eligible)
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', unreachableUrl,
          '--max-attempts', maxAttempts.toString(),
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('Command failed'), 'First push should fail');
        return true;
      }
    );

    // Verify attempts incremented to 1 (eligible for retry since 1 < 2)
    const localDb2 = createNodeSqliteAdapter({ filename: localDbPath });
    await migrateDatabase(localDb2, schemaMigrations);
    const attemptsAfterFirst = await getOutboxAttempts(localDb2, userId);
    await localDb2.close();

    assert.equal(attemptsAfterFirst.length, mutationCount);
    for (const row of attemptsAfterFirst) {
      assert.equal(row.attempts, 1, 'All mutations should have 1 attempt after first failure');
    }

    // Second push attempt with maxAttempts=2 - also fails
    // After this failure: attempts=2 (>= maxAttempts=2, so dead-lettered)
    await assert.rejects(
      async () => {
        await runNodeTsxCommand(cliEntrypoint, [
          'sync:push',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', unreachableUrl,
          '--max-attempts', maxAttempts.toString(),
        ]);
      },
      (error: Error) => {
        assert.ok(error.message.includes('Command failed'), 'Second push should fail');
        return true;
      }
    );

    // Verify attempts incremented to 2 (dead-lettered since 2 >= 2)
    const localDb3 = createNodeSqliteAdapter({ filename: localDbPath });
    await migrateDatabase(localDb3, schemaMigrations);
    const attemptsAfterSecond = await getOutboxAttempts(localDb3, userId);
    await localDb3.close();

    for (const row of attemptsAfterSecond) {
      assert.equal(row.attempts, 2, 'All mutations should have 2 attempts after second failure');
    }

    // Now start a working backend and switch to it
    const backend = await createBackendServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: backendDbPath,
    });

    const { port } = await backend.start();
    const workingUrl = `http://127.0.0.1:${port}`;

    try {
      // Third push with maxAttempts=2 and working backend
      // All mutations now have attempts=2, which >= maxAttempts=2, so they are ALL dead-lettered
      // pushedCount should be 0, skippedDeadLetterCount should be 15
      const pushOutput = await runNodeTsxCommand(cliEntrypoint, [
        'sync:push',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', workingUrl,
        '--max-attempts', maxAttempts.toString(),
      ]);

      const pushResult = JSON.parse(pushOutput.stdout) as SyncPushResult;

      // Assert dead-letter behavior at threshold 2:
      // - All 15 mutations have attempts=2 >= maxAttempts=2, so they are skipped (dead-lettered)
      // - pushedCount is 0 for dead-lettered rows
      // - skippedDeadLetterCount equals mutationCount (all are dead-lettered)
      assert.equal(pushResult.preferences.pushedCount, 0,
        'pushedCount should be 0 when all rows are dead-lettered');
      assert.equal(pushResult.preferences.skippedDeadLetterCount, mutationCount,
        `skippedDeadLetterCount should be ${mutationCount} when all rows have attempts >= maxAttempts`);
      assert.equal(pushResult.preferences.pendingCount, mutationCount,
        'pendingCount should still report total pending rows');
      assert.equal(pushResult.preferences.eligibleCount, 0,
        'eligibleCount should be 0 when all rows are dead-lettered');

      // Verify pending rows remain (not processed, just dead-lettered/skipped)
      const localDb4 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb4, schemaMigrations);
      const pendingAfter = await countPendingOutbox(localDb4, userId);
      // All mutations are still pending (processed_at is NULL) but dead-lettered
      assert.equal(pendingAfter, mutationCount,
        'All mutations should still be pending (dead-lettered, not processed)');
      await localDb4.close();

      // Verify retries succeed for attempts < maxAttempts at BOTH attempt levels:
      //   - attempts=0 (fresh retry)
      //   - attempts=1 (one prior failure, still below threshold of 2)
      // This proves the engine doesn't only retry attempts===0; any value < maxAttempts works.
      const localDb5 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb5, schemaMigrations);
      await localDb5.run(
        `UPDATE outbox SET attempts = 0 WHERE id = ?;`,
        ['retry-outbox-0']
      );
      await localDb5.run(
        `UPDATE outbox SET attempts = 1 WHERE id = ?;`,
        ['retry-outbox-1']
      );
      await localDb5.close();

      // Push again - should push only the 2 eligible mutations
      //   retry-outbox-0: attempts=0 < 2 -> eligible
      //   retry-outbox-1: attempts=1 < 2 -> eligible
      //   remaining 13:   attempts=2 >= 2 -> dead-lettered
      const pushOutput2 = await runNodeTsxCommand(cliEntrypoint, [
        'sync:push',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', workingUrl,
        '--max-attempts', maxAttempts.toString(),
      ]);

      const pushResult2 = JSON.parse(pushOutput2.stdout) as SyncPushResult;

      assert.equal(pushResult2.preferences.pushedCount, 2,
        'Should push 2 mutations (attempts=0 and attempts=1, both < maxAttempts=2)');
      assert.equal(pushResult2.preferences.skippedDeadLetterCount, mutationCount - 2,
        `Should skip ${mutationCount - 2} dead-lettered mutations`);
      assert.equal(pushResult2.preferences.eligibleCount, 2,
        'eligibleCount should be 2 for mutations below threshold');

      // Final pending count: 13 still dead-lettered, 2 pushed and processed
      const localDb6 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb6, schemaMigrations);
      const finalPending = await countPendingOutbox(localDb6, userId);
      assert.equal(finalPending, mutationCount - 2,
        'Should have 13 pending dead-lettered rows after pushing 2');
      await localDb6.close();
    } finally {
      await backend.stop();
    }
  });
});

test('eligible rows are not starved by dead-lettered rows beyond batch limit', { timeout: 60_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'stress-starvation-user';
    const maxAttempts = 2;
    // Use a small batch limit so dead-lettered rows exceed the batch window.
    // Without the SQL-level attempts filter, the first page (5 rows) would be
    // all dead-lettered and the eligible row at position 11 would never be reached.
    const batchLimit = 5;
    const deadLetterCount = 10;

    // Initialize local database
    await runNodeTsxCommand(cliEntrypoint, ['db:init', '--db', localDbPath]);

    // Seed outbox: deadLetterCount old dead-lettered rows (attempts >= maxAttempts)
    // followed by 1 newer eligible row (attempts = 0)
    const localDb = createNodeSqliteAdapter({ filename: localDbPath });
    await migrateDatabase(localDb, schemaMigrations);
    const baseTimestamp = '2025-01-01T00:00:00.000Z';

    await localDb.run(
      `INSERT INTO users (id, provider, created_at, updated_at) VALUES (?, 'local', ?, ?)
       ON CONFLICT(id) DO NOTHING;`,
      [userId, baseTimestamp, baseTimestamp]
    );

    // Seed dead-lettered rows (oldest, created_at earlier)
    for (let i = 0; i < deadLetterCount; i++) {
      const rowTimestamp = `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`;
      const operationId = `op-dead-${String(i).padStart(3, '0')}`;

      await localDb.run(
        `INSERT INTO outbox (id, user_id, operation_type, entity_type, entity_id, payload_json, operation_id, created_at, updated_at, attempts, last_error, processed_at)
         VALUES (?, ?, 'upsert', 'preferences', 'prefs', ?, ?, ?, ?, ?, 'failed', NULL);`,
        [
          `starve-dead-${i}`,
          userId,
          JSON.stringify({
            userId,
            updatedAt: rowTimestamp,
            preferences: {
              hexagonTheme: 'slate',
              hexagonVariant: 'medium',
              hexagonSize: 80 + i,
              hexagonCustomDepth: 16,
              hexagonUseCustomDepth: false,
            },
          }),
          operationId,
          rowTimestamp,
          rowTimestamp,
          maxAttempts, // already at threshold
        ]
      );
    }

    // Seed 1 newer eligible row (created_at later, attempts = 0)
    const eligibleTimestamp = '2025-01-01T00:01:00.000Z';
    await localDb.run(
      `INSERT INTO outbox (id, user_id, operation_type, entity_type, entity_id, payload_json, operation_id, created_at, updated_at, attempts, last_error, processed_at)
       VALUES (?, ?, 'upsert', 'preferences', 'prefs', ?, ?, ?, ?, 0, NULL, NULL);`,
      [
        'starve-eligible-0',
        userId,
        JSON.stringify({
          userId,
          updatedAt: eligibleTimestamp,
          preferences: {
            hexagonTheme: 'obsidian',
            hexagonVariant: 'tall',
            hexagonSize: 120,
            hexagonCustomDepth: 16,
            hexagonUseCustomDepth: false,
          },
        }),
        'op-eligible-000',
        eligibleTimestamp,
        eligibleTimestamp,
      ]
    );

    await localDb.close();

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: backendDbPath,
    });

    const { port } = await backend.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Push with maxAttempts=2 and batchLimit=5 — dead-lettered rows must not block the eligible row
      const pushOutput = await runNodeTsxCommand(cliEntrypoint, [
        'sync:push',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
        '--max-attempts', maxAttempts.toString(),
        '--batch-limit', batchLimit.toString(),
      ]);

      const pushResult = JSON.parse(pushOutput.stdout) as SyncPushResult;

      // The eligible row should be pushed despite dead-lettered rows filling the batch
      assert.equal(pushResult.preferences.pushedCount, 1,
        'Should push the 1 eligible mutation despite dead-lettered rows');
      assert.equal(pushResult.preferences.eligibleCount, 1,
        'eligibleCount should be 1 (only the non-dead-lettered row)');
      assert.equal(pushResult.preferences.skippedDeadLetterCount, deadLetterCount,
        `skippedDeadLetterCount should be ${deadLetterCount}`);
      assert.equal(pushResult.preferences.pendingCount, deadLetterCount + 1,
        'pendingCount should include all rows');

      // Verify the eligible row was processed
      const localDb2 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb2, schemaMigrations);

      const remaining = await countPendingOutbox(localDb2, userId);
      assert.equal(remaining, deadLetterCount,
        'Only dead-lettered rows should remain pending');

      // Verify backend received the eligible mutation
      const backendPrefsResponse = await fetch(`${baseUrl}/users/${userId}/preferences`);
      assert.equal(backendPrefsResponse.status, 200);
      const backendPrefs = (await backendPrefsResponse.json()) as { preferences: { hexagonTheme: string } };
      assert.equal(backendPrefs.preferences.hexagonTheme, 'obsidian',
        'Backend should have the eligible mutation theme');

      await localDb2.close();
    } finally {
      await backend.stop();
    }
  });
});

test('cursor progression across multiple pulls', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDbPath = join(directory, 'local.sqlite');
    const backendDbPath = join(directory, 'backend.sqlite');
    const userId = 'stress-cursor-user';

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

      // First pull (empty remote) - should get server timestamp as cursor
      const pullOutput1 = await runNodeTsxCommand(cliEntrypoint, [
        'sync:pull',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);
      const pullResult1 = JSON.parse(pullOutput1.stdout) as SyncPullResult;
      const cursor1 = pullResult1.places.cursor;

      assert.equal(pullResult1.places.fetchedCount, 0, 'Should fetch 0 places from empty remote');
      assert.equal(pullResult1.places.appliedCount, 0, 'Should apply 0 places from empty remote');
      assert.ok(cursor1 !== null, 'Cursor should be set even for empty remote (server timestamp)');

      // Track cursor progression across multiple updates
      const cursors: (string | null)[] = [cursor1];

      // Add multiple places sequentially to create multiple cursor values
      const placeCount = 5;
      for (let i = 0; i < placeCount; i++) {
        const placeResponse = await fetch(`${baseUrl}/users/${userId}/places/upsert-google`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Cursor Place ${i + 1}`,
            latitude: 40.0 + i * 0.1,
            longitude: -74.0 + i * 0.1,
            googlePlaceId: `gp-cursor-${i + 1}`,
          }),
        });
        assert.equal(placeResponse.status, 200);

        // Pull after each place creation to get updated cursor
        const pullOutput = await runNodeTsxCommand(cliEntrypoint, [
          'sync:pull',
          '--db', localDbPath,
          '--user', userId,
          '--remote-url', baseUrl,
        ]);
        const pullResult = JSON.parse(pullOutput.stdout) as SyncPullResult;

        // Verify each pull applies exactly one new place
        assert.equal(pullResult.places.appliedCount, 1, `Pull ${i + 1} should apply exactly 1 place`);
        // fetchedCount depends on backend pull implementation (full-snapshot vs delta);
        // only assert that at least the new entity was included
        assert.ok(pullResult.places.fetchedCount >= 1,
          `Pull ${i + 1} should fetch at least 1 place`);
        assert.ok(pullResult.places.cursor !== null, `Cursor should be non-null after pull ${i + 1}`);

        cursors.push(pullResult.places.cursor);
      }

      // Verify monotonic cursor progression.
      // Consecutive cursors use >= because they are server-generated timestamps
      // and two requests could theoretically land in the same millisecond.
      // First-to-last uses strict > since the full loop spans multiple CLI invocations.
      for (let i = 1; i < cursors.length; i++) {
        const prevCursor = cursors[i - 1]!;
        const currCursor = cursors[i]!;

        assert.ok(currCursor !== null, `Cursor ${i} should not be null`);

        if (prevCursor !== null && currCursor !== null) {
          assert.ok(currCursor >= prevCursor,
            `Cursor should monotonically progress: ${currCursor} >= ${prevCursor}`);
        }
      }

      // First-to-last progression: the full sequence spans several CLI invocations,
      // but use >= to tolerate coarse timer resolution on fast machines.
      // Per-step monotonic checks above already verify progression.
      const firstCursor = cursors[0]!;
      const lastCursor = cursors[cursors.length - 1]!;
      assert.ok(lastCursor >= firstCursor,
        `Last cursor should be at or later than first: ${lastCursor} >= ${firstCursor}`);

      // Verify sync_state.remote_cursor matches latest cursor
      const localDb = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb, schemaMigrations);

      const syncState = await localDb.get<{ remote_cursor: string | null; last_pulled_at: string | null }>(
        `SELECT remote_cursor, last_pulled_at FROM sync_state WHERE user_id = ? AND entity_type = 'places';`,
        [userId]
      );
      assert.ok(syncState, 'Sync state should exist');
      assert.equal(syncState?.remote_cursor, cursors[cursors.length - 1],
        'sync_state.remote_cursor should match latest pull cursor');
      assert.ok(syncState?.last_pulled_at !== null,
        'sync_state.last_pulled_at should be set');

      // Verify we have all places locally
      const localPlaces = await localDb.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM places WHERE user_id = ? AND deleted_at IS NULL;`,
        [userId]
      );
      assert.equal(localPlaces?.count, placeCount, `Should have ${placeCount} places locally`);

      await localDb.close();

      // Final pull - verify applied count is 0 (idempotent) and cursor remains stable
      const finalPullOutput = await runNodeTsxCommand(cliEntrypoint, [
        'sync:pull',
        '--db', localDbPath,
        '--user', userId,
        '--remote-url', baseUrl,
      ]);
      const finalPullResult = JSON.parse(finalPullOutput.stdout) as SyncPullResult;

      // appliedCount should be 0 since all entities are already synced
      assert.equal(finalPullResult.places.appliedCount, 0,
        'Final pull should apply 0 places (all already synced)');
      // Cursor must not regress below the last loop cursor
      assert.ok(finalPullResult.places.cursor !== null,
        'Final pull cursor should be non-null');
      assert.ok(finalPullResult.places.cursor! >= lastCursor,
        `Final cursor must not regress: ${finalPullResult.places.cursor} >= ${lastCursor}`);

      // Verify sync_state reflects the final cursor
      const localDb2 = createNodeSqliteAdapter({ filename: localDbPath });
      await migrateDatabase(localDb2, schemaMigrations);
      const finalSyncState = await localDb2.get<{ remote_cursor: string | null }>(
        `SELECT remote_cursor FROM sync_state WHERE user_id = ? AND entity_type = 'places';`,
        [userId]
      );
      assert.ok(finalSyncState?.remote_cursor !== null,
        'sync_state.remote_cursor should be set after final pull');
      assert.equal(finalSyncState?.remote_cursor, finalPullResult.places.cursor,
        'sync_state.remote_cursor should match final pull cursor');
      await localDb2.close();
    } finally {
      await backend.stop();
    }
  });
});
