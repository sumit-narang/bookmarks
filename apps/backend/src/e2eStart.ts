/**
 * Android-focused backend bootstrap for mobile e2e flows.
 * Starts the real backend with test auth enabled and deterministic seed data.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertAuthUser } from '../../../auth/src';
import {
  addPlaceToCollection,
  createCollection,
} from '../../../collections/src';
import { createNodeSqliteAdapter, migrateDatabase } from '../../../db/src';
import { setPreferences } from '../../../preferences/src';
import { upsertPlace } from '../../../places/src';
import { schemaMigrations } from '../../../schema/src';
import { createBackendServer } from './server';

interface SeedUser {
  userId: string;
  email: string;
  name: string;
  seededPlaceId: string;
  seededCollectionId: string;
  latitude: number;
  longitude: number;
  placeName: string;
  collectionName: string;
  preferenceTheme: string;
}

const seededUsers: SeedUser[] = [
  {
    userId: 'e2e-user-a',
    email: 'e2e-user-a@bookmarks.test',
    name: 'E2E User A',
    seededPlaceId: 'e2e-place-a-1',
    seededCollectionId: 'e2e-collection-a-1',
    latitude: 53.3498,
    longitude: -6.2603,
    placeName: 'Seeded Place A',
    collectionName: 'Seeded Collection A',
    preferenceTheme: 'basalt',
  },
  {
    userId: 'e2e-user-b',
    email: 'e2e-user-b@bookmarks.test',
    name: 'E2E User B',
    seededPlaceId: 'e2e-place-b-1',
    seededCollectionId: 'e2e-collection-b-1',
    latitude: 40.7128,
    longitude: -74.006,
    placeName: 'Seeded Place B',
    collectionName: 'Seeded Collection B',
    preferenceTheme: 'stone',
  },
];

const seedDatabase = async (databasePath: string): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    await migrateDatabase(adapter, schemaMigrations);

    for (const user of seededUsers) {
      await upsertAuthUser(adapter, {
        provider: 'test',
        providerUserId: user.userId,
        email: user.email,
        name: user.name,
        avatarUrl: null,
        identityToken: null,
      });

      await upsertPlace(adapter, {
        userId: user.userId,
        placeId: user.seededPlaceId,
        input: {
          name: user.placeName,
          address: 'Seeded address',
          latitude: user.latitude,
          longitude: user.longitude,
          googlePlaceId: `${user.seededPlaceId}-google`,
          rating: 4.5,
          notes: 'Seeded for mobile e2e coverage',
          imageUrl: null,
          metadataJson: JSON.stringify({
            type: 'Seeded Place',
            reviewCount: 100,
            description: 'Seeded place for mobile e2e scenario coverage',
            images: [],
            isGooglePlace: false,
          }),
        },
        updatedAt: '2026-02-14T00:00:00.000Z',
        operationId: `${user.userId}-seed-place-op`,
        recordOutbox: false,
      });

      await createCollection(adapter, {
        userId: user.userId,
        collectionId: user.seededCollectionId,
        input: {
          name: user.collectionName,
          coverImage: null,
        },
        updatedAt: '2026-02-14T00:00:01.000Z',
        operationId: `${user.userId}-seed-collection-op`,
        recordOutbox: false,
      });

      await addPlaceToCollection(adapter, {
        userId: user.userId,
        collectionId: user.seededCollectionId,
        placeId: user.seededPlaceId,
        updatedAt: '2026-02-14T00:00:02.000Z',
        operationId: `${user.userId}-seed-membership-op`,
        recordOutbox: false,
      });

      await setPreferences(adapter, {
        userId: user.userId,
        patch: {
          hexagonTheme: user.preferenceTheme,
          hexagonVariant: 'medium',
          hexagonSize: 82,
          hexagonCustomDepth: 18,
          hexagonUseCustomDepth: false,
        },
        updatedAt: '2026-02-14T00:00:03.000Z',
        operationId: `${user.userId}-seed-preferences-op`,
        recordOutbox: false,
      });
    }
  } finally {
    await adapter.close();
  }
};

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const defaultE2eDatabasePath = resolve(currentDirectory, '..', '..', '..', '.bookmarks', 'backend-e2e.sqlite');

const host = process.env.BOOKMARKS_BACKEND_HOST ?? '127.0.0.1';
const port = Number(process.env.BOOKMARKS_BACKEND_PORT ?? '8787');
const databasePath = process.env.BOOKMARKS_BACKEND_DB_PATH ?? defaultE2eDatabasePath;
const shouldResetDatabase = process.env.BOOKMARKS_E2E_RESET_DB !== 'false';

const run = async (): Promise<void> => {
  mkdirSync(dirname(databasePath), { recursive: true });

  if (shouldResetDatabase && existsSync(databasePath)) {
    rmSync(databasePath);
  }

  if (!process.env.BOOKMARKS_AUTH_TOKEN_SECRET) {
    process.env.BOOKMARKS_AUTH_TOKEN_SECRET = 'bookmarks-e2e-auth-secret';
  }

  if (!process.env.BOOKMARKS_AUTH_ALLOW_INSECURE_TEST_TOKENS) {
    process.env.BOOKMARKS_AUTH_ALLOW_INSECURE_TEST_TOKENS = '1';
  }

  await seedDatabase(databasePath);

  const server = await createBackendServer({
    host,
    port,
    databasePath,
  });

  await server.start();

  console.log(`E2E backend running on http://${host}:${port}`);
  console.log(`E2E database: ${databasePath}`);
  console.log(`Seed users: ${seededUsers.map((user) => user.userId).join(', ')}`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

run().catch((error) => {
  console.error('Failed to start e2e backend:', error);
  process.exit(1);
});
