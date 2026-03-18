/**
 * Mobile e2e runtime flags and deterministic test-user config.
 */

export const isE2eModeEnabled = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_MODE === '1';

export const e2ePrimaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_A || 'e2e-user-a';
export const e2eSecondaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_B || 'e2e-user-b';
export const e2eTertiaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_C || 'e2e-user-c';
export const e2eQuaternaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_D || 'e2e-user-d';
export const e2eQuinaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_E || 'e2e-user-e';
export const e2eSenaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_F || 'e2e-user-f';
export const e2eSeptenaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_G || 'e2e-user-g';
export const e2eOctonaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_H || 'e2e-user-h';

/**
 * Build an insecure test token accepted by backend only when explicitly enabled.
 * @param userId
 * @returns {string}
 */
export const buildInsecureTestIdentityToken = (userId: string): string => {
  return `test-token:${userId}`;
};
