/**
 * Local persistence lifecycle helpers.
 * Handles wipe operations for sign-out flows.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_STORAGE_KEY_PREFIX = '@bookmarks_';

interface StorageAdapter {
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: string[]): Promise<void>;
}

export interface WipeLocalDataOptions {
  wipeDatabase?: boolean;
  wipeDatabaseFn?: () => Promise<void>;
}

const wipeDatabaseByDefault = async (): Promise<void> => {
  const databaseModule = await import('./database');
  await databaseModule.wipeMobileDatabase();
};

/**
 * Wipe all app-scoped local data on sign out.
 * @param storage - Async storage adapter
 * @param options - Optional wipe behavior overrides
 */
export const wipeLocalDataOnSignOut = async (
  storage: StorageAdapter = AsyncStorage,
  options: WipeLocalDataOptions = {}
): Promise<void> => {
  const shouldWipeDatabase = options.wipeDatabase ?? false;
  const wipeDatabase = options.wipeDatabaseFn ?? wipeDatabaseByDefault;

  try {
    const allKeys = await storage.getAllKeys();
    const appKeys = allKeys.filter((key) => key.startsWith(APP_STORAGE_KEY_PREFIX));

    if (appKeys.length > 0) {
      await storage.multiRemove(appKeys);
    }

    if (shouldWipeDatabase) {
      await wipeDatabase();
    }
  } catch (error) {
    console.error('Error wiping local data on sign out:', error);
    throw error;
  }
};
