/**
 * Share payload contracts for collection deep links.
 */

/**
 * Shared place shape used inside shared collections.
 */
export interface SharedPlace {
  id: string;
  name: string;
  type?: string;
  image?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
}

/**
 * Shared collection shape used in a share payload.
 */
export interface SharedCollection {
  id: string;
  name: string;
  places: SharedPlace[];
}

/**
 * Top-level share payload used for URL sharing.
 */
export type SharePayload = SharedCollection[];
