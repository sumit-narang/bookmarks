/**
 * Collection input validation helpers.
 */

import type { CollectionInput, ValidatedCollectionInput } from './types';

const MAX_NAME_LENGTH = 500;

/**
 * Validate and normalize a collection input payload.
 * Throws on invalid data. Returns a fully resolved object (no undefined fields).
 * @param input
 * @returns {ValidatedCollectionInput}
 */
export const validateCollectionInput = (input: CollectionInput): ValidatedCollectionInput => {
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Collection name is required and must be a non-empty string.');
  }

  if (input.name.length > MAX_NAME_LENGTH) {
    throw new Error(`Collection name must be at most ${MAX_NAME_LENGTH} characters.`);
  }

  if (input.coverImage !== undefined && input.coverImage !== null && typeof input.coverImage !== 'string') {
    throw new Error('Collection coverImage must be a string or null.');
  }

  return {
    name: input.name.trim(),
    coverImage: input.coverImage ?? null,
  };
};

/**
 * Parse a raw object into a CollectionInput, validating required fields.
 * Throws if required fields are missing or invalid.
 * @param value
 * @returns {CollectionInput}
 */
export const parseCollectionInput = (value: unknown): CollectionInput => {
  if (!value || typeof value !== 'object') {
    throw new Error('Collection input must be an object.');
  }

  const raw = value as Record<string, unknown>;

  if (typeof raw.name !== 'string') {
    throw new Error('Collection input must include name as a string.');
  }

  return validateCollectionInput({
    name: raw.name,
    coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : null,
  });
};
