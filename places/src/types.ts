/**
 * Place domain contracts and read-model types.
 */

export interface PlaceInput {
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  googlePlaceId?: string | null;
  rating?: number | null;
  notes?: string | null;
  imageUrl?: string | null;
  metadataJson?: string | null;
}

/**
 * Fully resolved place input after validation/normalization.
 * All optional fields are resolved to their value or null (never undefined).
 */
export interface ValidatedPlaceInput {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  googlePlaceId: string | null;
  rating: number | null;
  notes: string | null;
  imageUrl: string | null;
  metadataJson: string | null;
}

export interface PlaceRecord {
  id: string;
  userId: string;
  googlePlaceId: string | null;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  notes: string | null;
  imageUrl: string | null;
  metadataJson: string | null;
  isSaved: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type PlaceSyncOperationType = 'upsert' | 'delete';

export interface PlaceSyncOperation {
  userId: string;
  placeId: string;
  operationId: string;
  operationType: PlaceSyncOperationType;
  updatedAt: string;
  place: PlaceInput | null;
}

export interface PlaceOutboxMutation {
  outboxId: string;
  userId: string;
  placeId: string;
  operationId: string;
  operationType: PlaceSyncOperationType;
  updatedAt: string;
  attempts: number;
  place: PlaceInput | null;
}
