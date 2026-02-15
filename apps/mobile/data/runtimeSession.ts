/**
 * In-memory runtime session state for the mobile app.
 * Keeps the active user ID available to persistence helpers.
 */

export const GUEST_USER_ID = 'local-guest-user';

let activeUserId = GUEST_USER_ID;

/**
 * Set the active user ID for persistence operations.
 * @param userId
 */
export const setActiveUserId = (userId: string): void => {
  activeUserId = userId;
};

/**
 * Get the active user ID for persistence operations.
 * @returns {string}
 */
export const getActiveUserId = (): string => {
  return activeUserId;
};

/**
 * Reset runtime state back to guest mode.
 */
export const resetActiveUserId = (): void => {
  activeUserId = GUEST_USER_ID;
};
