/**
 * Place input validation helpers.
 */

import type { PlaceInput, ValidatedPlaceInput } from './types';

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;
const MAX_NAME_LENGTH = 500;

/**
 * Validate and normalize a place input payload.
 * Throws on invalid data. Returns a fully resolved object (no undefined fields).
 * @param input
 * @returns {ValidatedPlaceInput}
 */
export const validatePlaceInput = (input: PlaceInput): ValidatedPlaceInput => {
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Place name is required and must be a non-empty string.');
  }

  if (input.name.length > MAX_NAME_LENGTH) {
    throw new Error(`Place name must be at most ${MAX_NAME_LENGTH} characters.`);
  }

  if (typeof input.latitude !== 'number' || !Number.isFinite(input.latitude)) {
    throw new Error('Place latitude must be a finite number.');
  }

  if (input.latitude < MIN_LATITUDE || input.latitude > MAX_LATITUDE) {
    throw new Error(`Place latitude must be between ${MIN_LATITUDE} and ${MAX_LATITUDE}.`);
  }

  if (typeof input.longitude !== 'number' || !Number.isFinite(input.longitude)) {
    throw new Error('Place longitude must be a finite number.');
  }

  if (input.longitude < MIN_LONGITUDE || input.longitude > MAX_LONGITUDE) {
    throw new Error(`Place longitude must be between ${MIN_LONGITUDE} and ${MAX_LONGITUDE}.`);
  }

  if (input.googlePlaceId !== undefined && input.googlePlaceId !== null && typeof input.googlePlaceId !== 'string') {
    throw new Error('Place googlePlaceId must be a string or null.');
  }

  if (input.rating !== undefined && input.rating !== null) {
    if (typeof input.rating !== 'number' || !Number.isFinite(input.rating)) {
      throw new Error('Place rating must be a finite number or null.');
    }
  }

  return {
    name: input.name.trim(),
    address: input.address ?? null,
    latitude: input.latitude,
    longitude: input.longitude,
    googlePlaceId: input.googlePlaceId ?? null,
    rating: input.rating ?? null,
    notes: input.notes ?? null,
    imageUrl: input.imageUrl ?? null,
    metadataJson: input.metadataJson ?? null,
  };
};

/**
 * Parse a raw object into a PlaceInput, validating required fields.
 * Throws if required fields are missing or invalid.
 * @param value
 * @returns {PlaceInput}
 */
export const parsePlaceInput = (value: unknown): PlaceInput => {
  if (!value || typeof value !== 'object') {
    throw new Error('Place input must be an object.');
  }

  const raw = value as Record<string, unknown>;

  if (typeof raw.name !== 'string') {
    throw new Error('Place input must include name as a string.');
  }

  if (typeof raw.latitude !== 'number') {
    throw new Error('Place input must include latitude as a number.');
  }

  if (typeof raw.longitude !== 'number') {
    throw new Error('Place input must include longitude as a number.');
  }

  return validatePlaceInput({
    name: raw.name,
    address: typeof raw.address === 'string' ? raw.address : null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    googlePlaceId: typeof raw.googlePlaceId === 'string' ? raw.googlePlaceId : null,
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : null,
    metadataJson: typeof raw.metadataJson === 'string' ? raw.metadataJson : null,
  });
};
