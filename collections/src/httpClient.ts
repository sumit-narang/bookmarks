/**
 * HTTP client for collection sync routes served by the backend app.
 */

import type {
  SyncOperation,
  SyncPullResponse,
  SyncPushResponse,
  SyncRemote,
} from '../../sync/src';

export interface CollectionsHttpClient extends SyncRemote {}

export interface CollectionsHttpClientOptions {
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
 * Create a backend HTTP client for collection sync routes.
 * @param options
 * @returns {CollectionsHttpClient}
 */
export const createCollectionsHttpClient = (options: CollectionsHttpClientOptions): CollectionsHttpClient => {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async pushOperations(userId: string, entityType: string, operations: SyncOperation[]): Promise<SyncPushResponse> {
      if (entityType !== 'collections') {
        throw new Error(`createCollectionsHttpClient only supports entityType=collections (received ${entityType}).`);
      }

      const response = await fetchImpl(`${baseUrl}/sync/collections/push`, {
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
      if (entityType !== 'collections') {
        throw new Error(`createCollectionsHttpClient only supports entityType=collections (received ${entityType}).`);
      }

      const query = new URLSearchParams({ userId });

      if (cursor) {
        query.set('cursor', cursor);
      }

      const response = await fetchImpl(`${baseUrl}/sync/collections/pull?${query.toString()}`);
      return readJsonResponse<SyncPullResponse>(response);
    },
  };
};
