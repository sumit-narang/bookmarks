/**
 * Shared ID helpers.
 */

import { randomUUID } from 'node:crypto';

/**
 * Generate a UUID v4 string.
 * @returns {string}
 */
export const createUuid = (): string => {
  return randomUUID();
};
