/**
 * HTTP client for backend auth session routes.
 */

import type { HttpClientOptions } from '../../http/src';
import { createHttpRequest, readJsonResponse } from '../../http/src';
import type {
  CreateAuthSessionRequest,
  CreateAuthSessionResponse,
  RefreshAuthSessionRequest,
  RefreshAuthSessionResponse,
  RevokeAuthSessionRequest,
  RevokeAuthSessionResponse,
} from './contracts';

export interface AuthHttpClient {
  createSession(input: CreateAuthSessionRequest): Promise<CreateAuthSessionResponse>;
  refreshSession(input: RefreshAuthSessionRequest): Promise<RefreshAuthSessionResponse>;
  revokeSession(input?: RevokeAuthSessionRequest): Promise<RevokeAuthSessionResponse>;
}

export type AuthHttpClientOptions = HttpClientOptions;

/**
 * Create an auth API client.
 * @param options
 * @returns {AuthHttpClient}
 */
export const createAuthHttpClient = (options: AuthHttpClientOptions): AuthHttpClient => {
  const request = createHttpRequest(options);

  return {
    async createSession(input) {
      const response = await request('/auth/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      return readJsonResponse<CreateAuthSessionResponse>(response);
    },

    async refreshSession(input) {
      const response = await request('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }, {
        retryOnUnauthorized: false,
      });

      return readJsonResponse<RefreshAuthSessionResponse>(response);
    },

    async revokeSession(input = {}) {
      const response = await request('/auth/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }, {
        retryOnUnauthorized: false,
      });

      return readJsonResponse<RevokeAuthSessionResponse>(response);
    },
  };
};
