/**
 * Backend auth middleware and session lifecycle integration tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAuthHttpClient } from '../auth/src';
import { createBackendServer } from '../apps/backend/src/server';
import { createTestAuthSession, createTestIdentityToken } from './helpers/auth';

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
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-backend-auth-'));

  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const withAuthorization = (token: string, init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers ?? undefined);
  headers.set('Authorization', `Bearer ${token}`);

  return {
    ...init,
    headers,
  };
};

test('auth middleware rejects unauthenticated protected routes', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });

    await backend.start();

    try {
      const response = await fetch(`${baseUrl}/users/missing-auth/preferences`);
      assert.equal(response.status, 401);

      const payload = (await response.json()) as { error: string };
      assert.match(payload.error, /Authorization header is required/i);
    } finally {
      await backend.stop();
    }
  });
});

test('authenticated CRUD and sync routes succeed with user isolation', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });

    await backend.start();

    const userId = 'auth-success-user';
    const authSession = await createTestAuthSession(baseUrl, userId);

    try {
      const upsertResponse = await authSession.fetch(`${baseUrl}/users/${userId}/places/upsert-google`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Auth CRUD Place',
          latitude: 10,
          longitude: 20,
          googlePlaceId: 'gp-auth-crud-1',
        }),
      });
      assert.equal(upsertResponse.status, 200);

      const syncResponse = await authSession.fetch(`${baseUrl}/sync/places/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          operations: [
            {
              entityId: 'auth-sync-place-2',
              operationId: 'op-auth-sync-2',
              operationType: 'upsert',
              updatedAt: '2026-02-12T08:00:00.000Z',
              payload: {
                userId,
                placeId: 'auth-sync-place-2',
                place: {
                  name: 'Auth Synced Place',
                  latitude: 30,
                  longitude: 40,
                  googlePlaceId: 'gp-auth-sync-2',
                  address: null,
                  rating: null,
                  notes: null,
                  imageUrl: null,
                  metadataJson: null,
                },
              },
            },
          ],
        }),
      });
      assert.equal(syncResponse.status, 200);

      const listResponse = await authSession.fetch(`${baseUrl}/users/${userId}/places`);
      assert.equal(listResponse.status, 200);
      const listPayload = (await listResponse.json()) as { places: Array<{ name: string }> };
      assert.equal(listPayload.places.length, 2);

      const forbiddenResponse = await authSession.fetch(`${baseUrl}/users/other-user/places`);
      assert.equal(forbiddenResponse.status, 403);
    } finally {
      await authSession.revoke();
      await backend.stop();
    }
  });
});

test('refresh rotates tokens and revoke invalidates session access', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });

    await backend.start();

    const authClient = createAuthHttpClient({ baseUrl });

    try {
      const created = await authClient.createSession({
        provider: 'test',
        providerUserId: 'auth-refresh-user',
        email: null,
        name: 'Auth Refresh User',
        avatarUrl: null,
        identityToken: createTestIdentityToken('auth-refresh-user'),
      });

      const firstRefreshToken = created.session.tokens.refreshToken;
      const refreshed = await authClient.refreshSession({ refreshToken: firstRefreshToken });

      assert.notEqual(refreshed.session.tokens.refreshToken, firstRefreshToken);
      assert.notEqual(refreshed.session.tokens.accessToken, created.session.tokens.accessToken);

      await assert.rejects(
        async () => authClient.refreshSession({ refreshToken: firstRefreshToken }),
        /HTTP 401/
      );

      const allowedBeforeRevoke = await fetch(
        `${baseUrl}/users/auth-refresh-user/preferences`,
        withAuthorization(refreshed.session.tokens.accessToken)
      );
      assert.equal(allowedBeforeRevoke.status, 200);

      const revokeResponse = await authClient.revokeSession({
        refreshToken: refreshed.session.tokens.refreshToken,
      });
      assert.equal(revokeResponse.revoked, true);

      const blockedAfterRevoke = await fetch(
        `${baseUrl}/users/auth-refresh-user/preferences`,
        withAuthorization(refreshed.session.tokens.accessToken)
      );
      assert.equal(blockedAfterRevoke.status, 401);

      await assert.rejects(
        async () => authClient.refreshSession({ refreshToken: refreshed.session.tokens.refreshToken }),
        /HTTP 401/
      );
    } finally {
      await backend.stop();
    }
  });
});

test('auth session creation requires identity proof', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });

    await backend.start();

    const authClient = createAuthHttpClient({ baseUrl });

    try {
      await assert.rejects(
        async () => {
          await authClient.createSession({
            provider: 'test',
            providerUserId: 'missing-proof-user',
            email: null,
            name: 'Missing Proof User',
            avatarUrl: null,
          });
        },
        /identityToken is required/
      );
    } finally {
      await backend.stop();
    }
  });
});

test('parallel refresh requests with one token rotate session atomically', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const backendDatabasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backend = await createBackendServer({
      host: '127.0.0.1',
      port,
      databasePath: backendDatabasePath,
    });

    await backend.start();

    const authClient = createAuthHttpClient({ baseUrl });

    try {
      const created = await authClient.createSession({
        provider: 'test',
        providerUserId: 'parallel-refresh-user',
        email: null,
        name: 'Parallel Refresh User',
        avatarUrl: null,
        identityToken: createTestIdentityToken('parallel-refresh-user'),
      });

      const firstRefreshToken = created.session.tokens.refreshToken;
      const [firstResult, secondResult] = await Promise.allSettled([
        authClient.refreshSession({ refreshToken: firstRefreshToken }),
        authClient.refreshSession({ refreshToken: firstRefreshToken }),
      ]);

      const fulfilled = [firstResult, secondResult].filter((result) => result.status === 'fulfilled');
      const rejected = [firstResult, secondResult].filter((result) => result.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one refresh request should succeed.');
      assert.equal(rejected.length, 1, 'Exactly one refresh request should fail.');

      const successfulRefresh = fulfilled[0];
      const failedRefresh = rejected[0];

      assert.ok(successfulRefresh && successfulRefresh.status === 'fulfilled');
      assert.ok(failedRefresh && failedRefresh.status === 'rejected');

      if (!successfulRefresh || successfulRefresh.status !== 'fulfilled') {
        throw new Error('Expected one fulfilled refresh result.');
      }

      if (!failedRefresh || failedRefresh.status !== 'rejected') {
        throw new Error('Expected one rejected refresh result.');
      }

      assert.match(String(failedRefresh.reason), /HTTP 401/);

      const refreshed = successfulRefresh.value;

      const response = await fetch(
        `${baseUrl}/users/parallel-refresh-user/preferences`,
        withAuthorization(refreshed.session.tokens.accessToken)
      );
      assert.equal(response.status, 200);
    } finally {
      await backend.stop();
    }
  });
});
