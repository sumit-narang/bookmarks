/**
 * HTTP client for place sync routes served by the backend app.
 */

import type {
  SyncOperation,
  SyncPullResponse,
  SyncPushResponse,
  SyncRemote,
} from '../../sync/src';

export interface PlacesHttpClient extends SyncRemote {}

export interface PlacesHttpClientOptions {
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
 * Create a backend HTTP client for place sync routes.
 * @param options
 * @returns {PlacesHttpClient}
 */
export const createPlacesHttpClient = (options: PlacesHttpClientOptions): PlacesHttpClient => {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async pushOperations(userId: string, entityType: string, operations: SyncOperation[]): Promise<SyncPushResponse> {
      if (entityType !== 'places') {
        throw new Error(`createPlacesHttpClient only supports entityType=places (received ${entityType}).`);
      }

      const response = await fetchImpl(`${baseUrl}/sync/places/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          operations,
        }),
      });

      return readJsonResponse<SyncPushResponse>(response);
    },
    async pullEntities(userId: string, entityType: string, cursor: string | null): Promise<SyncPullResponse> {
      if (entityType !== 'places') {
        throw new Error(`createPlacesHttpClient only supports entityType=places (received ${entityType}).`);
      }

      const query = new URLSearchParams({ userId });

      if (cursor) {
        query.set('cursor', cursor);
      }

      const response = await fetchImpl(`${baseUrl}/sync/places/pull?${query.toString()}`);
      return readJsonResponse<SyncPullResponse>(response);
    },
  };
};
