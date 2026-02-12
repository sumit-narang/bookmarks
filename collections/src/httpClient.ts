/**
 * HTTP client for collection sync routes served by the backend app.
 */

import type { SyncRemote } from '../../sync/src';
import type { HttpClientOptions } from '../../http/src';
import { createSyncRemoteClient } from '../../http/src';

export interface CollectionsHttpClient extends SyncRemote {}

export type CollectionsHttpClientOptions = HttpClientOptions;

/**
 * Create a backend HTTP client for collection sync routes.
 * @param options
 * @returns {CollectionsHttpClient}
 */
export const createCollectionsHttpClient = (options: CollectionsHttpClientOptions): CollectionsHttpClient => {
  return createSyncRemoteClient({
    ...options,
    entityType: 'collections',
    routePrefix: 'collections',
  });
};
