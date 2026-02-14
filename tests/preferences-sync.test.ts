/**
 * Preferences integration tests (local + backend sync).
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
  createPreferencesHttpClient,
  getOrCreatePreferences,
  getPreferences,
  listPendingPreferenceMutations,
  setPreferences,
  syncPreferences,
} from '../preferences/src';
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
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-preferences-'));

  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('local preferences initialize defaults and queue outbox updates', async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'local.sqlite');
    const database = createNodeSqliteAdapter({ filename: databasePath });

    try {
      await migrateDatabase(database, schemaMigrations);

      const initial = await getOrCreatePreferences(database, 'user-local');

      assert.equal(initial.hexagonTheme, 'stone');
      assert.equal(initial.hexagonVariant, 'medium');
      assert.equal(initial.hexagonSize, 80);
      assert.equal(initial.hexagonCustomDepth, 16);
      assert.equal(initial.hexagonUseCustomDepth, false);

      await setPreferences(database, {
        userId: 'user-local',
        patch: {
          hexagonTheme: 'slate',
          hexagonSize: 96,
        },
        updatedAt: '2026-02-07T05:00:00.000Z',
        operationId: 'op-local-1',
        recordOutbox: true,
      });

      const pending = await listPendingPreferenceMutations(database, 'user-local');

      assert.equal(pending.length, 1);

      const firstPending = pending[0];
      assert.ok(firstPending);
      assert.equal(firstPending.operationId, 'op-local-1');
      assert.equal(firstPending.preferences.hexagonTheme, 'slate');
      assert.equal(firstPending.preferences.hexagonSize, 96);
    } finally {
      await database.close();
    }
  });
});

test('syncPreferences pushes local changes and pulls newer remote state', { timeout: 30_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const localDatabasePath = join(directory, 'local.sqlite');
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const localDatabase = createNodeSqliteAdapter({ filename: localDatabasePath });

    const port = await getAvailablePort();
    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });
    let backendStarted = false;
    let authSession: Awaited<ReturnType<typeof createTestAuthSession>> | null = null;

    try {
      await migrateDatabase(localDatabase, schemaMigrations);

      await setPreferences(localDatabase, {
        userId: 'user-sync',
        patch: {
          hexagonTheme: 'basalt',
          hexagonVariant: 'tall',
          hexagonSize: 88,
        },
        updatedAt: '2026-02-07T06:00:00.000Z',
        operationId: 'op-local-sync-1',
        recordOutbox: true,
      });

      await backend.start();
      backendStarted = true;

      authSession = await createTestAuthSession(`http://127.0.0.1:${port}`, 'user-sync');
      const remote = createPreferencesHttpClient(authSession.httpClientOptions);

      const firstSync = await syncPreferences({
        database: localDatabase,
        userId: 'user-sync',
        remote,
      });

      assert.equal(firstSync.push.pendingCount, 1);
      assert.equal(firstSync.push.pushedCount, 1);

      const backendPreferencesAfterPush = await remote.getPreferences('user-sync');
      assert.equal(backendPreferencesAfterPush.hexagonTheme, 'basalt');
      assert.equal(backendPreferencesAfterPush.hexagonVariant, 'tall');
      assert.equal(backendPreferencesAfterPush.hexagonSize, 88);

      const pendingAfterPush = await listPendingPreferenceMutations(localDatabase, 'user-sync');
      assert.equal(pendingAfterPush.length, 0);

      await remote.setPreferences(
        'user-sync',
        {
          hexagonTheme: 'obsidian',
          hexagonUseCustomDepth: true,
          hexagonCustomDepth: 32,
        },
        {
          updatedAt: '2026-02-07T06:00:05.000Z',
          operationId: 'op-remote-sync-2',
        }
      );

      const secondSync = await syncPreferences({
        database: localDatabase,
        userId: 'user-sync',
        remote,
      });

      assert.equal(secondSync.pull.hadRemotePreference, true);
      assert.equal(secondSync.pull.appliedRemotePreference, true);

      const localPreferencesAfterPull = await getPreferences(localDatabase, 'user-sync');

      assert.ok(localPreferencesAfterPull);
      assert.equal(localPreferencesAfterPull.hexagonTheme, 'obsidian');
      assert.equal(localPreferencesAfterPull.hexagonUseCustomDepth, true);
      assert.equal(localPreferencesAfterPull.hexagonCustomDepth, 32);
      assert.equal(localPreferencesAfterPull.operationId, 'op-remote-sync-2');
    } finally {
      if (authSession) {
        await authSession.revoke();
      }

      if (backendStarted) {
        await backend.stop();
      }

      await localDatabase.close();
    }
  });
});
