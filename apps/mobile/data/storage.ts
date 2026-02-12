/**
 * SQLite-backed mobile storage facade.
 * Preserves existing screen-facing contracts while using shared repositories.
 */

import {
  addPlaceToCollection as addCollectionMembership,
  createCollection as createCollectionRecord,
  getCollection as getCollectionRecord,
  listCollectionPlaces,
  listCollections,
  listCollectionsForPlace,
  removeCollection,
  removePlaceFromCollection as removeCollectionMembership,
  updateCollection as updateCollectionRecord,
  type CollectionRecord,
} from '../../../collections/src';
import type { DatabaseAdapter } from '../../../db/src';
import {
  getPlace as getPlaceRecord,
  listPlaces,
  removePlace,
  upsertPlace,
  type PlaceInput,
  type PlaceRecord,
} from '../../../places/src';
import { getDatabase, initializeDatabase, wipeMobileDatabase } from './database';
import { getActiveUserId } from './runtimeSession';
import type { LegacyCollection, LegacyPlace } from './types';

const DEFAULT_COLLECTION_COVER = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop';

interface PlaceMetadata {
  type?: string;
  reviewCount?: number;
  description?: string;
  images?: string[];
  isGooglePlace?: boolean;
}

interface PlacePayload {
  id?: string;
  placeId?: string;
  googlePlaceId?: string | null;
  name?: string;
  type?: string;
  address?: string | null;
  rating?: number | null;
  reviewCount?: number;
  description?: string;
  image?: string | null;
  imageUrl?: string | null;
  images?: string[];
  coordinates?: {
    latitude?: number;
    longitude?: number;
  };
  latitude?: number;
  longitude?: number;
  saved?: boolean;
  isGooglePlace?: boolean;
  notes?: string | null;
}

const parseMetadata = (rawValue: string | null): PlaceMetadata => {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as PlaceMetadata;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeImages = (images: unknown): string[] => {
  if (!Array.isArray(images)) {
    return [];
  }

  return images.filter((image): image is string => typeof image === 'string' && image.length > 0);
};

const toMetadataJson = (payload: PlacePayload, googlePlaceId: string | null, fallbackImage: string | null): string | null => {
  const images = normalizeImages(payload.images);
  const nextImages = images.length > 0
    ? images
    : (fallbackImage ? [fallbackImage] : []);

  const metadata: PlaceMetadata = {
    type: payload.type,
    reviewCount: typeof payload.reviewCount === 'number' ? payload.reviewCount : undefined,
    description: payload.description,
    images: nextImages,
    isGooglePlace: payload.isGooglePlace ?? Boolean(googlePlaceId),
  };

  if (
    metadata.type === undefined
    && metadata.reviewCount === undefined
    && metadata.description === undefined
    && (!metadata.images || metadata.images.length === 0)
    && metadata.isGooglePlace === undefined
  ) {
    return null;
  }

  return JSON.stringify(metadata);
};

const resolveCoordinates = (payload: PlacePayload): { latitude: number; longitude: number } => {
  const latitude = payload.coordinates?.latitude ?? payload.latitude ?? 0;
  const longitude = payload.coordinates?.longitude ?? payload.longitude ?? 0;

  return {
    latitude,
    longitude,
  };
};

const buildPlaceInput = (payload: PlacePayload): PlaceInput => {
  const coordinates = resolveCoordinates(payload);
  const imageUrl = payload.imageUrl ?? payload.image ?? normalizeImages(payload.images)[0] ?? null;
  const googlePlaceId = payload.googlePlaceId ?? payload.placeId ?? null;

  return {
    name: payload.name ?? 'Untitled Place',
    address: payload.address ?? null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    googlePlaceId,
    rating: payload.rating ?? null,
    notes: payload.notes ?? null,
    imageUrl,
    metadataJson: toMetadataJson(payload, googlePlaceId, imageUrl),
  };
};

const toLegacyPlace = (record: PlaceRecord): LegacyPlace => {
  const metadata = parseMetadata(record.metadataJson);
  const images = normalizeImages(metadata.images);
  const primaryImage = record.imageUrl ?? images[0] ?? null;

  return {
    id: record.id,
    placeId: record.googlePlaceId ?? undefined,
    name: record.name,
    type: metadata.type ?? 'Place',
    address: record.address ?? '',
    rating: record.rating ?? 0,
    reviewCount: metadata.reviewCount ?? 0,
    description: metadata.description ?? `${record.name}${record.address ? ` located at ${record.address}` : ''}`,
    image: primaryImage,
    images: images.length > 0 ? images : (primaryImage ? [primaryImage] : []),
    coordinates: {
      latitude: record.latitude,
      longitude: record.longitude,
    },
    latitude: record.latitude,
    longitude: record.longitude,
    saved: record.isSaved,
    isGooglePlace: metadata.isGooglePlace ?? Boolean(record.googlePlaceId),
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

const toCollectionReference = (place: PlaceRecord): string => {
  return place.id;
};

const toLegacyCollection = (collection: CollectionRecord, placeReferences: string[] = []): LegacyCollection => {
  return {
    id: collection.id,
    name: collection.name,
    placeCount: collection.placeCount,
    coverImage: collection.coverImage ?? DEFAULT_COLLECTION_COVER,
    places: placeReferences,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
};

const resolvePlaceId = async (
  database: DatabaseAdapter,
  userId: string,
  placeIdOrGoogleId: string
): Promise<string | null> => {
  const row = await database.get<{ id: string }>(
    `SELECT id
     FROM places
     WHERE user_id = ?
       AND deleted_at IS NULL
       AND (id = ? OR google_place_id = ?)
     LIMIT 1;`,
    [userId, placeIdOrGoogleId, placeIdOrGoogleId]
  );

  return row?.id ?? null;
};

const getPlaceByAnyId = async (
  database: DatabaseAdapter,
  userId: string,
  placeIdOrGoogleId: string
): Promise<PlaceRecord | null> => {
  const resolvedId = await resolvePlaceId(database, userId, placeIdOrGoogleId);

  if (!resolvedId) {
    return null;
  }

  return getPlaceRecord(database, userId, resolvedId);
};

const getContext = async (): Promise<{ database: DatabaseAdapter; userId: string }> => {
  return {
    database: await getDatabase(),
    userId: getActiveUserId(),
  };
};

/**
 * Initialize storage (runs migrations and opens mobile SQLite).
 */
export const initializeStorage = async (): Promise<void> => {
  await initializeDatabase();
};

/**
 * Get all places for the active user.
 * @returns {Promise<LegacyPlace[]>}
 */
export const getPlaces = async (): Promise<LegacyPlace[]> => {
  try {
    const { database, userId } = await getContext();
    const records = await listPlaces(database, userId);
    return records.map(toLegacyPlace);
  } catch (error) {
    console.error('Error getting places:', error);
    return [];
  }
};

/**
 * Get a single place by internal UUID or Google place ID.
 * @param id
 * @returns {Promise<LegacyPlace | null>}
 */
export const getPlaceById = async (id: string): Promise<LegacyPlace | null> => {
  try {
    const { database, userId } = await getContext();
    const record = await getPlaceByAnyId(database, userId, id);
    return record ? toLegacyPlace(record) : null;
  } catch (error) {
    console.error('Error getting place:', error);
    return null;
  }
};

/**
 * Update a place row.
 * @param updatedPlace
 * @returns {Promise<LegacyPlace[] | null>}
 */
export const updatePlace = async (updatedPlace: PlacePayload): Promise<LegacyPlace[] | null> => {
  try {
    const candidateId = updatedPlace.id ?? updatedPlace.placeId;

    if (!candidateId) {
      return null;
    }

    const { database, userId } = await getContext();
    const resolvedId = await resolvePlaceId(database, userId, candidateId);

    if (!resolvedId) {
      return null;
    }

    await upsertPlace(database, {
      userId,
      placeId: resolvedId,
      input: buildPlaceInput(updatedPlace),
    });

    return getPlaces();
  } catch (error) {
    console.error('Error updating place:', error);
    return null;
  }
};

/**
 * Get all collections for the active user.
 * @returns {Promise<LegacyCollection[]>}
 */
export const getCollections = async (): Promise<LegacyCollection[]> => {
  try {
    const { database, userId } = await getContext();
    const records = await listCollections(database, userId);

    const mappedCollections = await Promise.all(
      records.map(async (record) => {
        const places = await listCollectionPlaces(database, {
          userId,
          collectionId: record.id,
        });

        const placeReferences = places.map(toCollectionReference).reverse();
        return toLegacyCollection(record, placeReferences);
      })
    );

    return mappedCollections;
  } catch (error) {
    console.error('Error getting collections:', error);
    return [];
  }
};

/**
 * Get a single collection.
 * @param id
 * @returns {Promise<LegacyCollection | null>}
 */
export const getCollectionById = async (id: string): Promise<LegacyCollection | null> => {
  try {
    const { database, userId } = await getContext();
    const record = await getCollectionRecord(database, userId, id);

    if (!record) {
      return null;
    }

    const places = await listCollectionPlaces(database, {
      userId,
      collectionId: id,
    });

    return toLegacyCollection(record, places.map(toCollectionReference).reverse());
  } catch (error) {
    console.error('Error getting collection:', error);
    return null;
  }
};

/**
 * Create a collection.
 * @param name
 * @param coverImage
 * @returns {Promise<LegacyCollection | null>}
 */
export const createCollection = async (
  name: string,
  coverImage: string | null = null
): Promise<LegacyCollection | null> => {
  try {
    const { database, userId } = await getContext();
    const record = await createCollectionRecord(database, {
      userId,
      input: {
        name,
        coverImage: coverImage ?? DEFAULT_COLLECTION_COVER,
      },
    });

    return toLegacyCollection(record, []);
  } catch (error) {
    console.error('Error creating collection:', error);
    return null;
  }
};

/**
 * Save or upsert a Google place.
 * @param googlePlace
 * @returns {Promise<string | null>}
 */
export const saveGooglePlace = async (googlePlace: PlacePayload): Promise<string | null> => {
  try {
    const { database, userId } = await getContext();
    const record = await upsertPlace(database, {
      userId,
      input: buildPlaceInput(googlePlace),
    });

    return record.googlePlaceId ?? record.id;
  } catch (error) {
    console.error('Error saving Google place:', error);
    return null;
  }
};

/**
 * Add a place to a collection.
 * @param collectionId
 * @param placeId
 * @param googlePlace
 * @returns {Promise<LegacyCollection[] | null>}
 */
export const addPlaceToCollection = async (
  collectionId: string,
  placeId: string,
  googlePlace: PlacePayload | null = null
): Promise<LegacyCollection[] | null> => {
  try {
    const { database, userId } = await getContext();

    let resolvedPlaceId: string | null = null;

    if (googlePlace) {
      const record = await upsertPlace(database, {
        userId,
        input: buildPlaceInput(googlePlace),
      });
      resolvedPlaceId = record.id;
    } else {
      resolvedPlaceId = await resolvePlaceId(database, userId, placeId);
    }

    if (!resolvedPlaceId) {
      return null;
    }

    await addCollectionMembership(database, {
      userId,
      collectionId,
      placeId: resolvedPlaceId,
    });

    const nextCoverImage = googlePlace?.image ?? googlePlace?.imageUrl ?? normalizeImages(googlePlace?.images)[0] ?? null;
    const collection = await getCollectionRecord(database, userId, collectionId);

    if (collection && nextCoverImage && collection.coverImage !== nextCoverImage) {
      await updateCollectionRecord(database, {
        userId,
        collectionId,
        input: {
          name: collection.name,
          coverImage: nextCoverImage,
        },
      });
    }

    return getCollections();
  } catch (error) {
    console.error('Error adding place to collection:', error);
    return null;
  }
};

/**
 * Remove a place from a collection.
 * @param collectionId
 * @param placeId
 * @returns {Promise<LegacyCollection[] | null>}
 */
export const removePlaceFromCollection = async (
  collectionId: string,
  placeId: string
): Promise<LegacyCollection[] | null> => {
  try {
    const { database, userId } = await getContext();
    const resolvedPlaceId = await resolvePlaceId(database, userId, placeId);

    if (!resolvedPlaceId) {
      return null;
    }

    await removeCollectionMembership(database, {
      userId,
      collectionId,
      placeId: resolvedPlaceId,
    });

    return getCollections();
  } catch (error) {
    console.error('Error removing place from collection:', error);
    return null;
  }
};

/**
 * Delete (soft-delete) a collection.
 * @param collectionId
 * @returns {Promise<LegacyCollection[] | null>}
 */
export const deleteCollection = async (collectionId: string): Promise<LegacyCollection[] | null> => {
  try {
    const { database, userId } = await getContext();
    await removeCollection(database, userId, collectionId);
    return getCollections();
  } catch (error) {
    console.error('Error deleting collection:', error);
    return null;
  }
};

/**
 * Get all places in one collection.
 * @param collectionId
 * @returns {Promise<LegacyPlace[]>}
 */
export const getPlacesInCollection = async (collectionId: string): Promise<LegacyPlace[]> => {
  try {
    const { database, userId } = await getContext();
    const records = await listCollectionPlaces(database, {
      userId,
      collectionId,
    });
    return records.map(toLegacyPlace).reverse();
  } catch (error) {
    console.error('Error getting places in collection:', error);
    return [];
  }
};

/**
 * Get all collections containing a place.
 * @param placeId
 * @returns {Promise<LegacyCollection[]>}
 */
export const getCollectionsForPlace = async (placeId: string): Promise<LegacyCollection[]> => {
  try {
    const { database, userId } = await getContext();
    const resolvedPlaceId = await resolvePlaceId(database, userId, placeId);

    if (!resolvedPlaceId) {
      return [];
    }

    const records = await listCollectionsForPlace(database, userId, resolvedPlaceId);
    return records.map((record) => toLegacyCollection(record, []));
  } catch (error) {
    console.error('Error getting collections for place:', error);
    return [];
  }
};

/**
 * Search places by name or type.
 * @param query
 * @returns {Promise<LegacyPlace[]>}
 */
export const searchPlaces = async (query: string): Promise<LegacyPlace[]> => {
  try {
    const places = await getPlaces();
    const lowerQuery = query.toLowerCase();

    return places.filter((place) => {
      return place.name.toLowerCase().includes(lowerQuery)
        || place.type.toLowerCase().includes(lowerQuery);
    });
  } catch (error) {
    console.error('Error searching places:', error);
    return [];
  }
};

/**
 * Delete a place and detach it from all collections.
 * @param placeId
 * @returns {Promise<boolean>}
 */
export const deletePlace = async (placeId: string): Promise<boolean> => {
  try {
    const { database, userId } = await getContext();
    const resolvedPlaceId = await resolvePlaceId(database, userId, placeId);

    if (!resolvedPlaceId) {
      return false;
    }

    const collections = await listCollectionsForPlace(database, userId, resolvedPlaceId);

    for (const collection of collections) {
      await removeCollectionMembership(database, {
        userId,
        collectionId: collection.id,
        placeId: resolvedPlaceId,
      });
    }

    return removePlace(database, userId, resolvedPlaceId);
  } catch (error) {
    console.error('Error deleting place:', error);
    return false;
  }
};

/**
 * Clear local storage for test/dev usage.
 */
export const clearStorage = async (): Promise<void> => {
  try {
    await wipeMobileDatabase();
  } catch (error) {
    console.error('Error clearing storage:', error);
  }
};
