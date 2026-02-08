/**
 * Collection domain contracts and read-model types.
 */

/** Raw input for creating or updating a collection. */
export interface CollectionInput {
  name: string;
  coverImage?: string | null;
}

/**
 * Fully resolved collection input after validation/normalization.
 * All optional fields are resolved to their value or null (never undefined).
 */
export interface ValidatedCollectionInput {
  name: string;
  coverImage: string | null;
}

/** Full collection read model with derived placeCount. */
export interface CollectionRecord {
  id: string;
  userId: string;
  name: string;
  coverImage: string | null;
  placeCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Options for creating a collection. */
export interface CreateCollectionOptions {
  userId: string;
  input: CollectionInput;
  collectionId?: string;
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/** Options for updating a collection. */
export interface UpdateCollectionOptions {
  userId: string;
  collectionId: string;
  input: CollectionInput;
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/** Options for adding a place to a collection. */
export interface AddPlaceToCollectionOptions {
  userId: string;
  collectionId: string;
  placeId: string;
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/** Options for removing a place from a collection. */
export interface RemovePlaceFromCollectionOptions {
  userId: string;
  collectionId: string;
  placeId: string;
  updatedAt?: string;
  operationId?: string | null;
  recordOutbox?: boolean;
}

/** Options for listing places in a collection. */
export interface ListCollectionPlacesOptions {
  userId: string;
  collectionId: string;
}

export type CollectionSyncOperationType = 'create' | 'update' | 'delete' | 'add-place' | 'remove-place' | 'upsert';

export interface CollectionSyncOperation {
  userId: string;
  collectionId: string;
  operationId: string;
  operationType: CollectionSyncOperationType;
  updatedAt: string;
  collection: CollectionInput | null;
  placeId: string | null;
  placeIds?: string[];
}

export interface CollectionOutboxMutation {
  outboxId: string;
  userId: string;
  collectionId: string;
  operationId: string;
  operationType: CollectionSyncOperationType;
  updatedAt: string;
  attempts: number;
  collection: CollectionInput | null;
  placeId: string | null;
}
