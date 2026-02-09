/**
 * Share payload encode/decode helpers.
 */

import type { SharePayload, SharedCollection, SharedPlace } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isOptionalString = (value: unknown): value is string | undefined => {
  return value === undefined || value === null || typeof value === 'string';
};

const isOptionalFiniteNumber = (value: unknown): value is number | undefined => {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
};

const isValidSharedPlace = (value: unknown): value is SharedPlace => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false;
  }

  return (
    isOptionalString(value.type) &&
    isOptionalString(value.image) &&
    isOptionalString(value.address) &&
    isOptionalFiniteNumber(value.rating) &&
    isOptionalFiniteNumber(value.reviewCount)
  );
};

const isValidSharedCollection = (value: unknown): value is SharedCollection => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false;
  }

  if (!Array.isArray(value.places)) {
    return false;
  }

  return value.places.every((place) => isValidSharedPlace(place));
};

/**
 * Validate a runtime value against the shared payload schema.
 * @param value - Runtime value to validate.
 * @returns {boolean} True when the value matches SharePayload.
 */
export const isValidSharePayload = (value: unknown): value is SharePayload => {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((collection) => isValidSharedCollection(collection));
};

/**
 * Encode share payload data to the base64 query-param format used by mobile share links.
 * Note: Returns standard Base64 (with '+' and '/'). Consumers constructing URLs must ensure
 * this string is URI-encoded (e.g. via `Linking.createURL` or `encodeURIComponent`)
 * before placing it in a query parameter to preserve '+' characters.
 * @param payload - Share payload to encode.
 * @returns {string} Base64-encoded payload for the `data` query parameter.
 */
export const encodeSharePayload = (payload: SharePayload): string => {
  return btoa(encodeURIComponent(JSON.stringify(payload)));
};

/**
 * Decode a base64 share payload string back into a validated share payload.
 * @param encoded - Base64-encoded payload from the `data` query parameter.
 * @returns {SharePayload} Decoded share payload.
 */
export const decodeSharePayload = (encoded: string): SharePayload => {
  let decodedBase64: string;

  try {
    decodedBase64 = atob(encoded);
  } catch {
    throw new Error('Failed to decode share payload: data must be valid base64.');
  }

  let decodedJson: string;

  try {
    decodedJson = decodeURIComponent(decodedBase64);
  } catch {
    throw new Error('Failed to decode share payload: decoded data is not URI-encoded JSON.');
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(decodedJson);
  } catch {
    throw new Error('Failed to decode share payload: decoded data is not valid JSON.');
  }

  if (!isValidSharePayload(parsedValue)) {
    throw new Error('Failed to decode share payload: decoded JSON does not match the share payload schema.');
  }

  return parsedValue;
};
