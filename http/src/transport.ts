/**
 * Shared HTTP transport utilities for backend API clients.
 * Centralizes URL normalization, response parsing, and common options.
 */

/**
 * Common options accepted by all HTTP client factories.
 */
export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Strip trailing slash from a URL so callers can concatenate paths without
 * double-slash issues.
 * @param value - URL string to normalize
 * @returns URL without trailing slash
 */
export const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

/**
 * Read and parse a JSON response body, throwing on non-2xx status codes.
 * @param response - Fetch Response object
 * @returns Parsed JSON body typed as TPayload
 */
export const readJsonResponse = async <TPayload>(response: Response): Promise<TPayload> => {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`HTTP ${response.status}: ${payload || response.statusText}`);
  }

  return (await response.json()) as TPayload;
};

/**
 * Build a URLSearchParams instance from a userId and optional cursor.
 * @param userId - User identifier
 * @param cursor - Optional pagination cursor
 * @returns URLSearchParams ready to append to a URL
 */
export const buildPullQuery = (userId: string, cursor: string | null): URLSearchParams => {
  const query = new URLSearchParams({ userId });

  if (cursor) {
    query.set('cursor', cursor);
  }

  return query;
};
