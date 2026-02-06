/**
 * Mobile sign-out local wipe tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

interface MemoryStorage {
  getAllKeys(): Promise<string[]>;
  multiRemove(keys: string[]): Promise<void>;
  getSnapshot(): Record<string, string>;
}

const createMemoryStorage = (initialData: Record<string, string>): MemoryStorage => {
  const values = new Map(Object.entries(initialData));

  return {
    async getAllKeys() {
      return Array.from(values.keys());
    },
    async multiRemove(keys) {
      for (const key of keys) {
        values.delete(key);
      }
    },
    getSnapshot() {
      return Object.fromEntries(values.entries());
    },
  };
};

test('wipeLocalDataOnSignOut removes all app-scoped keys and keeps external keys', async () => {
  const localPersistenceModulePath = '../apps/mobile/data/localPersistence.js';
  const localPersistenceModule = (await import(localPersistenceModulePath)) as {
    wipeLocalDataOnSignOut: (storage?: { getAllKeys(): Promise<string[]>; multiRemove(keys: string[]): Promise<void> }) => Promise<void>;
  };

  const storage = createMemoryStorage({
    '@bookmarks_user': '{"id":"user-a"}',
    '@bookmarks_places': '[{"id":"place-1"}]',
    '@bookmarks_collections': '[{"id":"collection-1"}]',
    '@another_app_token': 'keep-me',
  });

  await localPersistenceModule.wipeLocalDataOnSignOut(storage);

  assert.deepEqual(storage.getSnapshot(), {
    '@another_app_token': 'keep-me',
  });
});
