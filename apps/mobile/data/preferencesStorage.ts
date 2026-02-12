/**
 * SQLite-backed helpers for hexagon customizer preferences.
 */

import {
  defaultHexagonPreferences,
  getOrCreatePreferences,
  setPreferences,
} from '../../../preferences/src';
import { getDatabase } from './database';
import { getActiveUserId } from './runtimeSession';
import type { HexagonPreferenceValues } from './types';

const toPreferenceValues = (
  preferences: {
    hexagonTheme: string;
    hexagonVariant: string;
    hexagonSize: number;
    hexagonCustomDepth: number | null;
    hexagonUseCustomDepth: boolean;
  }
): HexagonPreferenceValues => {
  return {
    hexagonTheme: preferences.hexagonTheme,
    hexagonVariant: preferences.hexagonVariant,
    hexagonSize: preferences.hexagonSize,
    hexagonCustomDepth: preferences.hexagonCustomDepth,
    hexagonUseCustomDepth: preferences.hexagonUseCustomDepth,
  };
};

/**
 * Load stored hexagon preferences.
 * @returns {Promise<HexagonPreferenceValues>}
 */
export const loadHexagonPreferences = async (): Promise<HexagonPreferenceValues> => {
  try {
    const database = await getDatabase();
    const userId = getActiveUserId();
    const preferences = await getOrCreatePreferences(database, userId);
    return toPreferenceValues(preferences);
  } catch (error) {
    console.error('Error loading hexagon preferences:', error);
    return { ...defaultHexagonPreferences };
  }
};

/**
 * Persist hexagon preferences.
 * @param preferences
 * @returns {Promise<HexagonPreferenceValues>}
 */
export const saveHexagonPreferences = async (
  preferences: HexagonPreferenceValues
): Promise<HexagonPreferenceValues> => {
  try {
    const database = await getDatabase();
    const userId = getActiveUserId();

    const nextPreferences = await setPreferences(database, {
      userId,
      patch: {
        hexagonTheme: preferences.hexagonTheme,
        hexagonVariant: preferences.hexagonVariant,
        hexagonSize: preferences.hexagonSize,
        hexagonCustomDepth: preferences.hexagonCustomDepth,
        hexagonUseCustomDepth: preferences.hexagonUseCustomDepth,
      },
    });

    return toPreferenceValues(nextPreferences);
  } catch (error) {
    console.error('Error saving hexagon preferences:', error);
    return {
      ...defaultHexagonPreferences,
      ...preferences,
    };
  }
};

/**
 * Expose defaults for initial UI state.
 * @returns {HexagonPreferenceValues}
 */
export const getDefaultHexagonPreferences = (): HexagonPreferenceValues => {
  return { ...defaultHexagonPreferences };
};
