/**
 * Shared clock helpers for persistence modules.
 */

/**
 * Returns an ISO timestamp string in UTC.
 * @returns {string}
 */
export const nowIso = (): string => {
  return new Date().toISOString();
};
