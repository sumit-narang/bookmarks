/**
 * Mobile e2e runtime flags and deterministic test-user config.
 */

export const isE2eModeEnabled = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_MODE === '1';

export const e2ePrimaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_A || 'e2e-user-a';
export const e2eSecondaryUserId = process.env.EXPO_PUBLIC_BOOKMARKS_E2E_USER_B || 'e2e-user-b';

/**
 * Build an insecure test token accepted by backend only when explicitly enabled.
 * @param userId
 * @returns {string}
 */
export const buildInsecureTestIdentityToken = (userId: string): string => {
  return `test-token:${userId}`;
};
