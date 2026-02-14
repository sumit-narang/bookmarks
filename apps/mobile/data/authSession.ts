/**
 * Mobile auth-session persistence helpers.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { nowIso } from '../../../core/src';
import type { AuthSessionEnvelope } from '../../../auth/src/contracts';

const AUTH_SESSION_STORAGE_KEY = 'bookmarks_auth_session';

/** @deprecated Legacy key used before expo-secure-store adoption. */
const LEGACY_AUTH_SESSION_STORAGE_KEY = '@bookmarks_auth_session';

interface CredentialStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface SecureStoreModuleLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const asyncStorageCredentialStorage: CredentialStorage = {
  async getItem(key) {
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key) {
    await AsyncStorage.removeItem(key);
  },
};

let credentialStoragePromise: Promise<CredentialStorage> | null = null;
let didWarnSecureStoreUnavailable = false;

const tryLoadSecureStoreModule = async (): Promise<SecureStoreModuleLike | null> => {
  if (Platform.OS === 'web') {
    return null;
  }

  try {
    const secureStoreModuleName = 'expo-secure-store';
    const secureStoreModule = await import(secureStoreModuleName);

    if (
      typeof secureStoreModule.getItemAsync !== 'function'
      || typeof secureStoreModule.setItemAsync !== 'function'
      || typeof secureStoreModule.deleteItemAsync !== 'function'
    ) {
      return null;
    }

    return secureStoreModule as SecureStoreModuleLike;
  } catch {
    return null;
  }
};

const createCredentialStorage = async (): Promise<CredentialStorage> => {
  const secureStore = await tryLoadSecureStoreModule();

  if (secureStore) {
    return {
      async getItem(key) {
        return secureStore.getItemAsync(key);
      },
      async setItem(key, value) {
        await secureStore.setItemAsync(key, value);
      },
      async removeItem(key) {
        await secureStore.deleteItemAsync(key);
      },
    };
  }

  if (!didWarnSecureStoreUnavailable) {
    didWarnSecureStoreUnavailable = true;
    console.warn('expo-secure-store is unavailable; falling back to AsyncStorage for auth-session persistence.');
  }

  return asyncStorageCredentialStorage;
};

const getCredentialStorage = async (): Promise<CredentialStorage> => {
  if (!credentialStoragePromise) {
    credentialStoragePromise = createCredentialStorage();
  }

  return credentialStoragePromise;
};

export interface MobileAuthSession {
  userId: string;
  sessionId: string;
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  lastRefreshedAt: string;
}

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const parseMobileAuthSession = (value: unknown): MobileAuthSession | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Record<string, unknown>;

  if (
    !isNonEmptyString(input.userId)
    || !isNonEmptyString(input.sessionId)
    || input.tokenType !== 'Bearer'
    || !isNonEmptyString(input.accessToken)
    || !isNonEmptyString(input.refreshToken)
    || !isNonEmptyString(input.accessTokenExpiresAt)
    || !isNonEmptyString(input.refreshTokenExpiresAt)
    || !isNonEmptyString(input.lastRefreshedAt)
  ) {
    return null;
  }

  return {
    userId: input.userId,
    sessionId: input.sessionId,
    tokenType: 'Bearer',
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    lastRefreshedAt: input.lastRefreshedAt,
  };
};

/**
 * Convert backend auth-session payload into mobile persisted shape.
 * @param session
 * @returns {MobileAuthSession}
 */
export const toMobileAuthSession = (session: AuthSessionEnvelope): MobileAuthSession => {
  return {
    userId: session.userId,
    sessionId: session.sessionId,
    tokenType: session.tokens.tokenType,
    accessToken: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken,
    accessTokenExpiresAt: session.tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: session.tokens.refreshTokenExpiresAt,
    lastRefreshedAt: nowIso(),
  };
};

/**
 * Persist mobile auth-session state.
 * @param session
 */
export const saveAuthSession = async (session: MobileAuthSession): Promise<void> => {
  const credentialStorage = await getCredentialStorage();
  await credentialStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
};

/**
 * Persist backend auth-session payload.
 * @param session
 */
export const saveAuthSessionEnvelope = async (session: AuthSessionEnvelope): Promise<void> => {
  await saveAuthSession(toMobileAuthSession(session));
};

/**
 * Migrate a session stored under the legacy AsyncStorage key to the current
 * SecureStore-compatible key. Returns the raw JSON string if migration
 * occurred, or null otherwise.
 */
const migrateLegacySession = async (): Promise<string | null> => {
  try {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_AUTH_SESSION_STORAGE_KEY);

    if (!legacyRaw) {
      return null;
    }

    const credentialStorage = await getCredentialStorage();
    await credentialStorage.setItem(AUTH_SESSION_STORAGE_KEY, legacyRaw);
    await AsyncStorage.removeItem(LEGACY_AUTH_SESSION_STORAGE_KEY);

    return legacyRaw;
  } catch {
    return null;
  }
};

/**
 * Load persisted mobile auth-session state.
 * @returns {Promise<MobileAuthSession | null>}
 */
export const loadAuthSession = async (): Promise<MobileAuthSession | null> => {
  const credentialStorage = await getCredentialStorage();
  let raw = await credentialStorage.getItem(AUTH_SESSION_STORAGE_KEY);

  if (!raw) {
    raw = await migrateLegacySession();
  }

  if (!raw) {
    return null;
  }

  try {
    return parseMobileAuthSession(JSON.parse(raw));
  } catch {
    return null;
  }
};

/**
 * Clear persisted auth-session state (both current and legacy keys).
 */
export const clearAuthSession = async (): Promise<void> => {
  const credentialStorage = await getCredentialStorage();
  await credentialStorage.removeItem(AUTH_SESSION_STORAGE_KEY);

  try {
    await AsyncStorage.removeItem(LEGACY_AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Legacy key may already be gone; safe to ignore.
  }
};

/**
 * Check if an access token is expired (with optional safety window).
 * @param session
 * @param safetyWindowSeconds
 * @returns {boolean}
 */
export const isAccessTokenExpired = (
  session: Pick<MobileAuthSession, 'accessTokenExpiresAt'>,
  safetyWindowSeconds = 30
): boolean => {
  const expiresAt = new Date(session.accessTokenExpiresAt).getTime();
  const threshold = Date.now() + (safetyWindowSeconds * 1000);

  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return expiresAt <= threshold;
};
