/**
 * Shared HTTP transport utilities for backend API clients.
 * Centralizes URL normalization, response parsing, and common options.
 */

export type AccessTokenGetter = () => string | null | Promise<string | null>;

export interface HttpAuthOptions {
  accessToken?: string;
  getAccessToken?: AccessTokenGetter;
  /**
   * Called after a 401 response so callers can refresh credentials.
   * Return true to retry the request once with updated auth state.
   */
  onUnauthorized?: () => Promise<boolean>;
}

/**
 * Common options accepted by all HTTP client factories.
 */
export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  auth?: HttpAuthOptions;
}

export interface HttpRequestExecutionOptions {
  retryOnUnauthorized?: boolean;
}

export type HttpRequest = (
  path: string,
  init?: RequestInit,
  options?: HttpRequestExecutionOptions
) => Promise<Response>;

/**
 * Strip trailing slash from a URL so callers can concatenate paths without
 * double-slash issues.
 * @param value - URL string to normalize
 * @returns URL without trailing slash
 */
export const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const isAbsoluteUrl = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

const toRequestUrl = (baseUrl: string, path: string): string => {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  if (path.startsWith('/')) {
    return `${baseUrl}${path}`;
  }

  return `${baseUrl}/${path}`;
};

const resolveAccessToken = async (auth?: HttpAuthOptions): Promise<string | null> => {
  if (!auth) {
    return null;
  }

  if (auth.getAccessToken) {
    return auth.getAccessToken();
  }

  return auth.accessToken ?? null;
};

/**
 * Create an HTTP request helper that supports optional auth-header injection
 * and one retry after credential refresh.
 * @param options
 * @returns {HttpRequest}
 */
export const createHttpRequest = (options: HttpClientOptions): HttpRequest => {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const fetchFn = options.fetchImpl ?? fetch;

  return async (path, init = {}, requestOptions = {}) => {
    const retryOnUnauthorized = requestOptions.retryOnUnauthorized ?? true;

    const execute = async (allowRetry: boolean): Promise<Response> => {
      const headers = new Headers(init.headers ?? undefined);
      const token = await resolveAccessToken(options.auth);

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetchFn(toRequestUrl(baseUrl, path), {
        ...init,
        headers,
      });

      if (response.status === 401 && allowRetry && options.auth?.onUnauthorized) {
        const refreshed = await options.auth.onUnauthorized();

        if (refreshed) {
          return execute(false);
        }
      }

      return response;
    };

    return execute(retryOnUnauthorized);
  };
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
