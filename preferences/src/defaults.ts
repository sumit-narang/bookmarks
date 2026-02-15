/**
 * Default values and allowed enums for hexagon preferences.
 */

import type { HexagonPreferencesValues } from './types';

export const allowedHexagonThemes = ['stone', 'basalt', 'slate', 'sandstone', 'obsidian'] as const;

export const allowedHexagonVariants = ['short', 'medium', 'tall', 'extraTall'] as const;

export const defaultHexagonPreferences: HexagonPreferencesValues = {
  hexagonTheme: 'stone',
  hexagonVariant: 'medium',
  hexagonSize: 80,
  hexagonCustomDepth: 16,
  hexagonUseCustomDepth: false,
};
