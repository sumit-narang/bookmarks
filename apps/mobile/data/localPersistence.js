/**
 * Local persistence lifecycle helpers.
 * Handles wipe operations for sign-out flows.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_STORAGE_KEY_PREFIX = '@bookmarks_';

/**
 * Wipe all app-scoped local data on sign out.
 *
 * NOTE: Slice 6 will add SQLite database file deletion here once the mobile app
 * is cut over from AsyncStorage to SQLite persistence.
 *
 * @param {Object} storage - Async storage adapter
 */
export const wipeLocalDataOnSignOut = async (storage = AsyncStorage) => {
  try {
    const allKeys = await storage.getAllKeys();
    const appKeys = allKeys.filter((key) => key.startsWith(APP_STORAGE_KEY_PREFIX));

    if (appKeys.length > 0) {
      await storage.multiRemove(appKeys);
    }
  } catch (error) {
    console.error('Error wiping local data on sign out:', error);
    throw error;
  }
};
