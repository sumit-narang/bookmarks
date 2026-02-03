/**
 * AsyncStorage helpers for persisting data locally
 * Simple functions to save and load places and collections
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { mockPlaces } from './mockPlaces';
import { mockCollections } from './mockCollections';

// Storage keys
const PLACES_KEY = '@bookmarks_places';
const COLLECTIONS_KEY = '@bookmarks_collections';

/**
 * Initialize storage with mock data
 * Always resets to fresh mock data on app start
 */
export const initializeStorage = async () => {
  try {
    // Clear existing data and reset with fresh mock data
    await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(mockPlaces));
    await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(mockCollections));
  } catch (error) {
    console.error('Error initializing storage:', error);
  }
};

/**
 * Get all places from storage
 */
export const getPlaces = async () => {
  try {
    const data = await AsyncStorage.getItem(PLACES_KEY);
    return data ? JSON.parse(data) : mockPlaces;
  } catch (error) {
    console.error('Error getting places:', error);
    return mockPlaces;
  }
};

/**
 * Get a single place by ID
 */
export const getPlaceById = async (id) => {
  try {
    const places = await getPlaces();
    return places.find((place) => place.id === id) || null;
  } catch (error) {
    console.error('Error getting place:', error);
    return null;
  }
};

/**
 * Update a place (e.g., mark as saved)
 */
export const updatePlace = async (updatedPlace) => {
  try {
    const places = await getPlaces();
    const index = places.findIndex((p) => p.id === updatedPlace.id);
    if (index !== -1) {
      places[index] = updatedPlace;
      await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(places));
    }
    return places;
  } catch (error) {
    console.error('Error updating place:', error);
    return null;
  }
};

/**
 * Get all collections from storage
 */
export const getCollections = async () => {
  try {
    const data = await AsyncStorage.getItem(COLLECTIONS_KEY);
    return data ? JSON.parse(data) : mockCollections;
  } catch (error) {
    console.error('Error getting collections:', error);
    return mockCollections;
  }
};

/**
 * Get a single collection by ID
 */
export const getCollectionById = async (id) => {
  try {
    const collections = await getCollections();
    return collections.find((col) => col.id === id) || null;
  } catch (error) {
    console.error('Error getting collection:', error);
    return null;
  }
};

/**
 * Create a new collection
 * New collections are added with full ISO timestamp for proper sorting (newest first)
 */
export const createCollection = async (name, coverImage = null) => {
  try {
    const collections = await getCollections();
    const newCollection = {
      id: Date.now().toString(),
      name,
      placeCount: 0,
      coverImage: coverImage || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop',
      places: [],
      createdAt: new Date().toISOString(), // Full ISO timestamp for proper sorting
    };
    // Add to beginning of array so it appears first
    collections.unshift(newCollection);
    await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
    return newCollection;
  } catch (error) {
    console.error('Error creating collection:', error);
    return null;
  }
};

/**
 * Save a Google Place to local storage
 * This is called when a user saves a place from Google search
 */
export const saveGooglePlace = async (googlePlace) => {
  try {
    const places = await getPlaces();

    // Check if place already exists (by placeId or id)
    const existingIndex = places.findIndex(
      (p) => p.placeId === googlePlace.placeId || p.id === googlePlace.placeId
    );

    if (existingIndex !== -1) {
      // Update existing place
      places[existingIndex] = { ...places[existingIndex], ...googlePlace, saved: true };
    } else {
      // Add new place with a local id
      const newPlace = {
        ...googlePlace,
        id: googlePlace.placeId, // Use placeId as id for consistency
        saved: true,
      };
      places.push(newPlace);
    }

    await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(places));
    return googlePlace.placeId;
  } catch (error) {
    console.error('Error saving Google place:', error);
    return null;
  }
};

/**
 * Add a place to a collection
 * Handles both local places and Google Places
 */
export const addPlaceToCollection = async (collectionId, placeId, googlePlace = null) => {
  try {
    // If it's a Google Place, save it to storage first
    if (googlePlace && googlePlace.placeId) {
      await saveGooglePlace(googlePlace);
      placeId = googlePlace.placeId;
    } else if (googlePlace) {
      // Local place passed as googlePlace - use the id field
      placeId = googlePlace.id || placeId;
    }

    const collections = await getCollections();
    const index = collections.findIndex((c) => c.id === collectionId);

    if (index !== -1) {
      // Avoid duplicates
      if (!collections[index].places.includes(placeId)) {
        // Add to beginning so newest appears first
        collections[index].places.unshift(placeId);
        collections[index].placeCount = collections[index].places.length;

        // Update collection cover image to the newest place
        if (googlePlace?.image) {
          collections[index].coverImage = googlePlace.image;
        }
      }
      await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));

      // Mark the place as saved if it's a local place
      if (!googlePlace) {
        const place = await getPlaceById(placeId);
        if (place) {
          await updatePlace({ ...place, saved: true });
        }
      }
    }
    return collections;
  } catch (error) {
    console.error('Error adding place to collection:', error);
    return null;
  }
};

/**
 * Remove a place from a collection
 * If the collection becomes empty, delete it
 */
export const removePlaceFromCollection = async (collectionId, placeId) => {
  try {
    let collections = await getCollections();
    const index = collections.findIndex((c) => c.id === collectionId);

    if (index !== -1) {
      collections[index].places = collections[index].places.filter((id) => id !== placeId);
      collections[index].placeCount = collections[index].places.length;

      // If collection is now empty, remove it
      if (collections[index].placeCount === 0) {
        collections = collections.filter((c) => c.id !== collectionId);
      }

      await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
    }
    return collections;
  } catch (error) {
    console.error('Error removing place from collection:', error);
    return null;
  }
};

/**
 * Delete a collection
 * Places that only belong to this collection are marked as unsaved
 * Places in multiple collections just lose the association with this collection
 */
export const deleteCollection = async (collectionId) => {
  try {
    const collections = await getCollections();
    const collectionToDelete = collections.find((c) => c.id === collectionId);

    if (!collectionToDelete) {
      return collections;
    }

    // Get places in the collection being deleted
    const placesInDeletedCollection = collectionToDelete.places || [];

    // Find other collections (excluding the one being deleted)
    const otherCollections = collections.filter((c) => c.id !== collectionId);

    // Get all place IDs that exist in other collections
    const placesInOtherCollections = new Set();
    otherCollections.forEach((collection) => {
      (collection.places || []).forEach((placeId) => {
        placesInOtherCollections.add(placeId);
      });
    });

    // Find places that ONLY exist in the deleted collection
    const placesToUnsave = placesInDeletedCollection.filter(
      (placeId) => !placesInOtherCollections.has(placeId)
    );

    // Mark those places as unsaved
    if (placesToUnsave.length > 0) {
      const places = await getPlaces();
      const updatedPlaces = places.map((place) => {
        const placeId = place.id || place.placeId;
        if (placesToUnsave.includes(placeId)) {
          return { ...place, saved: false };
        }
        return place;
      });
      await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(updatedPlaces));
    }

    // Remove the collection
    await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(otherCollections));
    return otherCollections;
  } catch (error) {
    console.error('Error deleting collection:', error);
    return null;
  }
};

/**
 * Get places in a collection (full place objects)
 * Handles both local place IDs and Google placeIds
 * Returns places in the order they appear in the collection (newest first)
 */
export const getPlacesInCollection = async (collectionId) => {
  try {
    const collection = await getCollectionById(collectionId);
    const allPlaces = await getPlaces();

    if (collection) {
      // Map over collection.places to preserve order (newest first)
      return collection.places
        .map((placeId) =>
          allPlaces.find((place) => place.id === placeId || place.placeId === placeId)
        )
        .filter(Boolean); // Remove any undefined entries
    }
    return [];
  } catch (error) {
    console.error('Error getting places in collection:', error);
    return [];
  }
};

/**
 * Get collections that contain a specific place
 * Returns collections with savedAt date
 */
export const getCollectionsForPlace = async (placeId) => {
  try {
    const collections = await getCollections();
    return collections.filter((collection) =>
      collection.places.includes(placeId)
    );
  } catch (error) {
    console.error('Error getting collections for place:', error);
    return [];
  }
};

/**
 * Search places by name
 */
export const searchPlaces = async (query) => {
  try {
    const places = await getPlaces();
    const lowerQuery = query.toLowerCase();
    return places.filter(
      (place) =>
        place.name.toLowerCase().includes(lowerQuery) ||
        place.type.toLowerCase().includes(lowerQuery)
    );
  } catch (error) {
    console.error('Error searching places:', error);
    return [];
  }
};

/**
 * Delete a place completely (unsave and remove from all collections)
 */
export const deletePlace = async (placeId) => {
  try {
    // Get all places and mark this one as unsaved
    const places = await getPlaces();
    const placeIndex = places.findIndex((p) => p.id === placeId || p.placeId === placeId);
    if (placeIndex !== -1) {
      places[placeIndex].saved = false;
      await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(places));
    }

    // Remove from all collections
    const collections = await getCollections();
    const updatedCollections = collections.map((collection) => {
      const updatedPlaces = collection.places.filter((id) => id !== placeId);
      return {
        ...collection,
        places: updatedPlaces,
        placeCount: updatedPlaces.length,
      };
    });
    await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(updatedCollections));

    return true;
  } catch (error) {
    console.error('Error deleting place:', error);
    return false;
  }
};

/**
 * Clear all storage (for testing)
 */
export const clearStorage = async () => {
  try {
    await AsyncStorage.removeItem(PLACES_KEY);
    await AsyncStorage.removeItem(COLLECTIONS_KEY);
  } catch (error) {
    console.error('Error clearing storage:', error);
  }
};
