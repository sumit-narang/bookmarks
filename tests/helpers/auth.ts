/**
 * Test helpers for backend auth sessions.
 */

import { createHmac } from 'node:crypto';
import { createAuthHttpClient } from '../../auth/src';
import type { HttpClientOptions } from '../../http/src';

export interface TestAuthSession {
  userId: string;
  httpClientOptions: HttpClientOptions;
  getAccessToken(): string;
  getRefreshToken(): string;
  withAuth(init?: RequestInit): RequestInit;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  revoke(): Promise<void>;
}

const withAuthorizationHeader = (token: string, init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers ?? undefined);
  headers.set('Authorization', `Bearer ${token}`);

  return {
    ...init,
    headers,
  };
};

const resolveTestIdentitySecret = (): string => {
  const configuredSecret = process.env.BOOKMARKS_AUTH_TOKEN_SECRET;

  if (!configuredSecret || configuredSecret.trim().length === 0) {
    throw new Error('BOOKMARKS_AUTH_TOKEN_SECRET must be configured for test identity tokens.');
  }

  return configuredSecret;
};

/**
 * Build a test-provider identity signature accepted by /auth/session.
 * @param providerUserId
 * @returns {string}
 */
export const createTestIdentityToken = (providerUserId: string): string => {
  return createHmac('sha256', resolveTestIdentitySecret())
    .update(`test:${providerUserId}`)
    .digest('hex');
};

/**
 * Create a short-lived backend auth session for integration tests.
 * @param baseUrl
 * @param userId
 * @returns {Promise<TestAuthSession>}
 */
export const createTestAuthSession = async (
  baseUrl: string,
  userId: string
): Promise<TestAuthSession> => {
  const authClient = createAuthHttpClient({ baseUrl });
  const createdSession = await authClient.createSession({
    provider: 'test',
    providerUserId: userId,
    email: null,
    name: 'Test User',
    avatarUrl: null,
    identityToken: createTestIdentityToken(userId),
  });

  let accessToken = createdSession.session.tokens.accessToken;
  let refreshToken = createdSession.session.tokens.refreshToken;

  const refresh = async (): Promise<boolean> => {
    try {
      const refreshedSession = await authClient.refreshSession({ refreshToken });
      accessToken = refreshedSession.session.tokens.accessToken;
      refreshToken = refreshedSession.session.tokens.refreshToken;
      return true;
    } catch {
      return false;
    }
  };

  return {
    userId,
    httpClientOptions: {
      baseUrl,
      auth: {
        getAccessToken: () => accessToken,
        onUnauthorized: refresh,
      },
    },
    getAccessToken() {
      return accessToken;
    },
    getRefreshToken() {
      return refreshToken;
    },
    withAuth(init = {}) {
      return withAuthorizationHeader(accessToken, init);
    },
    fetch(input, init = {}) {
      return fetch(input, withAuthorizationHeader(accessToken, init));
    },
    async revoke() {
      await authClient.revokeSession({ refreshToken });
    },
  };
};
