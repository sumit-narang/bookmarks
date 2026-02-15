/**
 * HTTP client for place sync routes served by the backend app.
 */

import type { SyncRemote } from '../../sync/src';
import type { HttpClientOptions } from '../../http/src';
import { createSyncRemoteClient } from '../../http/src';

export interface PlacesHttpClient extends SyncRemote {}

export type PlacesHttpClientOptions = HttpClientOptions;

/**
 * Create a backend HTTP client for place sync routes.
 * @param options
 * @returns {PlacesHttpClient}
 */
export const createPlacesHttpClient = (options: PlacesHttpClientOptions): PlacesHttpClient => {
  return createSyncRemoteClient({
    ...options,
    entityType: 'places',
    routePrefix: 'places',
  });
};
