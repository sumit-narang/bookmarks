/**
 * Generic sync-remote HTTP client factory.
 * Creates a SyncRemote implementation for any entity type, eliminating
 * duplicated push/pull HTTP logic across domain modules.
 */

import type {
  SyncOperation,
  SyncPullResponse,
  SyncPushResponse,
  SyncRemote,
} from '../../sync/src';
import type { HttpClientOptions } from './transport';
import { buildPullQuery, readJsonResponse, trimTrailingSlash } from './transport';

export interface SyncRemoteClientOptions extends HttpClientOptions {
  /** The entity type this client handles (e.g. 'places', 'collections'). */
  entityType: string;
  /** URL path segment for the sync routes (e.g. 'places' → /sync/places/push). */
  routePrefix: string;
}

/**
 * Create a SyncRemote HTTP client for a specific entity type.
 * The resulting client enforces that only the configured entityType is used
 * and routes push/pull requests to /sync/{routePrefix}/push and /sync/{routePrefix}/pull.
 *
 * @param options
 * @returns {SyncRemote}
 */
export const createSyncRemoteClient = (options: SyncRemoteClientOptions): SyncRemote => {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const fetchFn = options.fetchImpl ?? fetch;
  const { entityType, routePrefix } = options;

  return {
    async pushOperations(userId: string, reqEntityType: string, operations: SyncOperation[]): Promise<SyncPushResponse> {
      if (reqEntityType !== entityType) {
        throw new Error(
          `Sync remote client for '${entityType}' does not support entityType='${reqEntityType}'.`
        );
      }

      const response = await fetchFn(`${baseUrl}/sync/${routePrefix}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, operations }),
      });

      return readJsonResponse<SyncPushResponse>(response);
    },

    async pullEntities(userId: string, reqEntityType: string, cursor: string | null): Promise<SyncPullResponse> {
      if (reqEntityType !== entityType) {
        throw new Error(
          `Sync remote client for '${entityType}' does not support entityType='${reqEntityType}'.`
        );
      }

      const query = buildPullQuery(userId, cursor);
      const response = await fetchFn(`${baseUrl}/sync/${routePrefix}/pull?${query.toString()}`);
      return readJsonResponse<SyncPullResponse>(response);
    },
  };
};
