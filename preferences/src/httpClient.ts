/**
 * HTTP client for preference routes served by the backend app.
 */

import type { HttpClientOptions } from '../../http/src';
import { buildPullQuery, createHttpRequest, readJsonResponse } from '../../http/src';
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

export type PreferencesHttpClientOptions = HttpClientOptions;

/**
 * Create a backend HTTP client for preference routes.
 * @param options
 * @returns {PreferencesHttpClient}
 */
export const createPreferencesHttpClient = (options: PreferencesHttpClientOptions): PreferencesHttpClient => {
  const request = createHttpRequest(options);

  return {
    async getPreferences(userId) {
      const response = await request(`/users/${encodeURIComponent(userId)}/preferences`);
      const payload = await readJsonResponse<{ preferences: HexagonPreferences }>(response);
      return payload.preferences;
    },
    async setPreferences(userId, patch, payloadOptions = {}) {
      const response = await request(`/users/${encodeURIComponent(userId)}/preferences`, {
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
      const response = await request('/sync/preferences/push', {
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
      const query = buildPullQuery(userId, cursor);
      const response = await request(`/sync/preferences/pull?${query.toString()}`);
      return readJsonResponse<PreferenceSyncPullResponse>(response);
    },
  };
};
