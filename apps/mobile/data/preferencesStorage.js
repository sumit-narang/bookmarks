/**
 * AsyncStorage helpers for hexagon customizer preferences.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const HEXAGON_PREFERENCES_KEY = '@bookmarks_hexagon_preferences';

const defaultHexagonPreferences = {
  hexagonTheme: 'stone',
  hexagonVariant: 'medium',
  hexagonSize: 80,
  hexagonCustomDepth: 16,
  hexagonUseCustomDepth: false,
};

const normalizeHexagonPreferences = (value) => {
  if (!value || typeof value !== 'object') {
    return { ...defaultHexagonPreferences };
  }

  return {
    hexagonTheme: typeof value.hexagonTheme === 'string'
      ? value.hexagonTheme
      : defaultHexagonPreferences.hexagonTheme,
    hexagonVariant: typeof value.hexagonVariant === 'string'
      ? value.hexagonVariant
      : defaultHexagonPreferences.hexagonVariant,
    hexagonSize: typeof value.hexagonSize === 'number'
      ? value.hexagonSize
      : defaultHexagonPreferences.hexagonSize,
    hexagonCustomDepth:
      typeof value.hexagonCustomDepth === 'number' || value.hexagonCustomDepth === null
        ? value.hexagonCustomDepth
        : defaultHexagonPreferences.hexagonCustomDepth,
    hexagonUseCustomDepth: typeof value.hexagonUseCustomDepth === 'boolean'
      ? value.hexagonUseCustomDepth
      : defaultHexagonPreferences.hexagonUseCustomDepth,
  };
};

/**
 * Load stored hexagon preferences.
 * @param {Object} storage - Async storage adapter
 * @returns {Promise<Object>} normalized preferences
 */
export const loadHexagonPreferences = async (storage = AsyncStorage) => {
  try {
    const raw = await storage.getItem(HEXAGON_PREFERENCES_KEY);

    if (!raw) {
      return { ...defaultHexagonPreferences };
    }

    const parsed = JSON.parse(raw);
    return normalizeHexagonPreferences(parsed);
  } catch (error) {
    console.error('Error loading hexagon preferences:', error);
    return { ...defaultHexagonPreferences };
  }
};

/**
 * Persist hexagon preferences.
 * @param {Object} preferences
 * @param {Object} storage - Async storage adapter
 * @returns {Promise<Object>} normalized preferences
 */
export const saveHexagonPreferences = async (preferences, storage = AsyncStorage) => {
  const normalized = normalizeHexagonPreferences(preferences);

  try {
    await storage.setItem(HEXAGON_PREFERENCES_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    console.error('Error saving hexagon preferences:', error);
    return normalized;
  }
};

/**
 * Expose defaults for initial UI state.
 * @returns {Object}
 */
export const getDefaultHexagonPreferences = () => {
  return { ...defaultHexagonPreferences };
};
