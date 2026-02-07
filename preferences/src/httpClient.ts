/**
 * HTTP client for preference routes served by the backend app.
 */

import type {
  HexagonPreferences,
  HexagonPreferencesPatch,
  PreferenceSyncOperation,
  PreferenceSyncPullResponse,
  PreferenceSyncPushResponse,
} from './types';

export interface PreferencesHttpClient {
  getPreferences(userId: string): Promise<HexagonPreferences>;
  setPreferences(
    userId: string,
    patch: HexagonPreferencesPatch,
    options?: { updatedAt?: string; operationId?: string | null }
  ): Promise<HexagonPreferences>;
  pushPreferenceOperations(userId: string, operations: PreferenceSyncOperation[]): Promise<PreferenceSyncPushResponse>;
  pullPreferences(userId: string, cursor: string | null): Promise<PreferenceSyncPullResponse>;
}

export interface PreferencesHttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const readJsonResponse = async <TPayload>(response: Response): Promise<TPayload> => {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`HTTP ${response.status}: ${payload || response.statusText}`);
  }

  return (await response.json()) as TPayload;
};

/**
 * Create a backend HTTP client for preference routes.
 * @param options
 * @returns {PreferencesHttpClient}
 */
export const createPreferencesHttpClient = (options: PreferencesHttpClientOptions): PreferencesHttpClient => {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async getPreferences(userId) {
      const response = await fetchImpl(`${baseUrl}/users/${encodeURIComponent(userId)}/preferences`);
      const payload = await readJsonResponse<{ preferences: HexagonPreferences }>(response);
      return payload.preferences;
    },
    async setPreferences(userId, patch, payloadOptions = {}) {
      const response = await fetchImpl(`${baseUrl}/users/${encodeURIComponent(userId)}/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          patch,
          updatedAt: payloadOptions.updatedAt,
          operationId: payloadOptions.operationId,
        }),
      });

      const payload = await readJsonResponse<{ preferences: HexagonPreferences }>(response);
      return payload.preferences;
    },
    async pushPreferenceOperations(userId, operations) {
      const response = await fetchImpl(`${baseUrl}/sync/preferences/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          operations,
        }),
      });

      return readJsonResponse<PreferenceSyncPushResponse>(response);
    },
    async pullPreferences(userId, cursor) {
      const query = new URLSearchParams({ userId });

      if (cursor) {
        query.set('cursor', cursor);
      }

      const response = await fetchImpl(`${baseUrl}/sync/preferences/pull?${query.toString()}`);
      return readJsonResponse<PreferenceSyncPullResponse>(response);
    },
  };
};
