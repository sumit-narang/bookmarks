/**
 * Mobile sync manager for authenticated backend sync operations.
 */

import { createAuthHttpClient } from '../../../auth/src/httpClient';
import { createCollectionsHttpClient, syncCollections } from '../../../collections/src';
import type { HttpClientOptions } from '../../../http/src';
import { createPlacesHttpClient, syncPlaces } from '../../../places/src';
import { createPreferencesHttpClient, syncPreferences } from '../../../preferences/src';
import { BOOKMARKS_BACKEND_URL } from '../config/backend';
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSessionEnvelope,
  toMobileAuthSession,
  type MobileAuthSession,
} from './authSession';
import { getDatabase } from './database';
import { getActiveUserId } from './runtimeSession';

interface AuthSessionRef {
  current: MobileAuthSession | null;
}

const refreshRequestByUserId = new Map<string, Promise<boolean>>();

const loadAuthSessionForUser = async (userId: string): Promise<MobileAuthSession | null> => {
  const persistedSession = await loadAuthSession();

  if (!persistedSession || persistedSession.userId !== userId) {
    return null;
  }

  return persistedSession;
};

const runRefreshSessionFromBackend = async (
  sessionRef: AuthSessionRef,
  expectedRefreshToken: string
): Promise<boolean> => {
  const initialSession = sessionRef.current;

  if (!initialSession) {
    return false;
  }

  const userId = initialSession.userId;
  const authClient = createAuthHttpClient({ baseUrl: BOOKMARKS_BACKEND_URL });
  const persistedSession = await loadAuthSessionForUser(userId);
  const sessionForRefresh = persistedSession ?? initialSession;

  if (sessionForRefresh.refreshToken !== expectedRefreshToken) {
    sessionRef.current = sessionForRefresh;
    return true;
  }

  try {
    const refreshResponse = await authClient.refreshSession({
      refreshToken: sessionForRefresh.refreshToken,
    });

    await saveAuthSessionEnvelope(refreshResponse.session);
    sessionRef.current = toMobileAuthSession(refreshResponse.session);
    return true;
  } catch (error) {
    const latestPersistedSession = await loadAuthSessionForUser(userId);

    if (latestPersistedSession && latestPersistedSession.refreshToken !== expectedRefreshToken) {
      sessionRef.current = latestPersistedSession;
      return true;
    }

    if (
      sessionRef.current
      && sessionRef.current.userId === userId
      && sessionRef.current.refreshToken !== expectedRefreshToken
    ) {
      return true;
    }

    console.warn('Unable to refresh auth session for sync:', error);
    await clearAuthSession();
    sessionRef.current = null;
    return false;
  }
};

const refreshSessionFromBackend = async (sessionRef: AuthSessionRef): Promise<boolean> => {
  const currentSession = sessionRef.current;

  if (!currentSession) {
    return false;
  }

  const userId = currentSession.userId;
  const expectedRefreshToken = currentSession.refreshToken;
  const existingRefreshRequest = refreshRequestByUserId.get(userId);

  if (existingRefreshRequest) {
    const refreshed = await existingRefreshRequest;

    if (refreshed) {
      sessionRef.current = await loadAuthSessionForUser(userId);
    }

    return refreshed;
  }

  const refreshRequest = runRefreshSessionFromBackend(sessionRef, expectedRefreshToken)
    .finally(() => {
      const activeRefreshRequest = refreshRequestByUserId.get(userId);

      if (activeRefreshRequest === refreshRequest) {
        refreshRequestByUserId.delete(userId);
      }
    });

  refreshRequestByUserId.set(userId, refreshRequest);
  return refreshRequest;
};

/**
 * Build shared HTTP client options with auth header injection + refresh retry.
 * @returns {Promise<HttpClientOptions | null>}
 */
export const createAuthenticatedHttpClientOptions = async (): Promise<HttpClientOptions | null> => {
  const activeUserId = getActiveUserId();
  const session = await loadAuthSession();

  if (!session || session.userId !== activeUserId) {
    return null;
  }

  const sessionRef: AuthSessionRef = {
    current: session,
  };

  return {
    baseUrl: BOOKMARKS_BACKEND_URL,
    auth: {
      getAccessToken: () => sessionRef.current?.accessToken ?? null,
      onUnauthorized: async () => {
        return refreshSessionFromBackend(sessionRef);
      },
    },
  };
};

export interface AuthenticatedSyncResult {
  preferences: Awaited<ReturnType<typeof syncPreferences>>;
  places: Awaited<ReturnType<typeof syncPlaces>>;
  collections: Awaited<ReturnType<typeof syncCollections>>;
}

/**
 * Run authenticated sync for preferences, places, and collections.
 * Returns null when there is no active authenticated session.
 * @returns {Promise<AuthenticatedSyncResult | null>}
 */
export const syncAuthenticatedData = async (): Promise<AuthenticatedSyncResult | null> => {
  const activeUserId = getActiveUserId();
  const httpOptions = await createAuthenticatedHttpClientOptions();

  if (!httpOptions) {
    return null;
  }

  const database = await getDatabase();

  const preferencesRemote = createPreferencesHttpClient(httpOptions);
  const placesRemote = createPlacesHttpClient(httpOptions);
  const collectionsRemote = createCollectionsHttpClient(httpOptions);

  const preferences = await syncPreferences({
    database,
    userId: activeUserId,
    remote: preferencesRemote,
  });

  const places = await syncPlaces({
    database,
    userId: activeUserId,
    remote: placesRemote,
  });

  const collections = await syncCollections({
    database,
    userId: activeUserId,
    remote: collectionsRemote,
  });

  return {
    preferences,
    places,
    collections,
  };
};
