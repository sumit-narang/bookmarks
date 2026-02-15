/**
 * Preference validation helpers.
 */

import { allowedHexagonThemes, allowedHexagonVariants } from './defaults';
import type { HexagonPreferencesPatch, HexagonPreferencesValues } from './types';

const MIN_HEXAGON_SIZE = 24;
const MAX_HEXAGON_SIZE = 120;
const MIN_CUSTOM_DEPTH = 4;
const MAX_CUSTOM_DEPTH = 60;

const roundNumber = (value: number): number => {
  return Math.round(value);
};

/**
 * Merge a partial preference patch into a full preference object.
 * @param baseValues
 * @param patch
 * @returns {HexagonPreferencesValues}
 */
export const mergeHexagonPreferences = (
  baseValues: HexagonPreferencesValues,
  patch: HexagonPreferencesPatch
): HexagonPreferencesValues => {
  return {
    hexagonTheme: patch.hexagonTheme ?? baseValues.hexagonTheme,
    hexagonVariant: patch.hexagonVariant ?? baseValues.hexagonVariant,
    hexagonSize: patch.hexagonSize ?? baseValues.hexagonSize,
    hexagonCustomDepth: patch.hexagonCustomDepth ?? baseValues.hexagonCustomDepth,
    hexagonUseCustomDepth: patch.hexagonUseCustomDepth ?? baseValues.hexagonUseCustomDepth,
  };
};

/**
 * Validate and normalize preference values.
 * @param values
 * @returns {HexagonPreferencesValues}
 */
export const normalizeHexagonPreferences = (values: HexagonPreferencesValues): HexagonPreferencesValues => {
  if (!allowedHexagonThemes.includes(values.hexagonTheme as (typeof allowedHexagonThemes)[number])) {
    throw new Error(`Invalid hexagon theme: ${values.hexagonTheme}`);
  }

  if (!allowedHexagonVariants.includes(values.hexagonVariant as (typeof allowedHexagonVariants)[number])) {
    throw new Error(`Invalid hexagon variant: ${values.hexagonVariant}`);
  }

  if (!Number.isFinite(values.hexagonSize)) {
    throw new Error('Hexagon size must be a finite number.');
  }

  const normalizedSize = roundNumber(values.hexagonSize);

  if (normalizedSize < MIN_HEXAGON_SIZE || normalizedSize > MAX_HEXAGON_SIZE) {
    throw new Error(`Hexagon size must be between ${MIN_HEXAGON_SIZE} and ${MAX_HEXAGON_SIZE}.`);
  }

  if (values.hexagonCustomDepth !== null && !Number.isFinite(values.hexagonCustomDepth)) {
    throw new Error('Hexagon custom depth must be null or a finite number.');
  }

  const normalizedCustomDepth = values.hexagonCustomDepth === null ? null : roundNumber(values.hexagonCustomDepth);

  if (
    normalizedCustomDepth !== null
    && (normalizedCustomDepth < MIN_CUSTOM_DEPTH || normalizedCustomDepth > MAX_CUSTOM_DEPTH)
  ) {
    throw new Error(`Hexagon custom depth must be between ${MIN_CUSTOM_DEPTH} and ${MAX_CUSTOM_DEPTH}.`);
  }

  return {
    hexagonTheme: values.hexagonTheme,
    hexagonVariant: values.hexagonVariant,
    hexagonSize: normalizedSize,
    hexagonCustomDepth: normalizedCustomDepth,
    hexagonUseCustomDepth: Boolean(values.hexagonUseCustomDepth),
  };
};
