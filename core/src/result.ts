/**
 * Shared result type for explicit success/error handling.
 */

export type Result<TValue, TError = Error> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

/**
 * Create a successful result wrapper.
 * @param value
 * @returns {Result<TValue, never>}
 */
export const ok = <TValue>(value: TValue): Result<TValue, never> => {
  return { ok: true, value };
};

/**
 * Create an error result wrapper.
 * @param error
 * @returns {Result<never, TError>}
 */
export const err = <TError>(error: TError): Result<never, TError> => {
  return { ok: false, error };
};
