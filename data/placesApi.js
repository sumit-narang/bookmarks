/**
 * Google Places API helper functions
 * Handles searching for places and fetching details
 */

import {
  GOOGLE_PLACES_API_KEY,
  PLACES_AUTOCOMPLETE_URL,
  PLACES_DETAILS_URL,
  PLACES_PHOTO_URL,
} from '../config/api';

/**
 * Search for places using Google Places Autocomplete
 * @param {string} query - Search text
 * @returns {Promise<Array>} - Array of place predictions
 */
export const searchPlacesGoogle = async (query) => {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const url = `${PLACES_AUTOCOMPLETE_URL}?input=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_API_KEY}&types=establishment`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.predictions) {
      return data.predictions.map((prediction) => ({
        placeId: prediction.place_id,
        name: prediction.structured_formatting?.main_text || prediction.description,
        address: prediction.structured_formatting?.secondary_text || '',
        fullDescription: prediction.description,
      }));
    }

    if (data.status === 'REQUEST_DENIED') {
      console.warn('Google Places API request denied. Check your API key.');
    }

    return [];
  } catch (error) {
    console.error('Error searching places:', error);
    return [];
  }
};

/**
 * Get detailed information about a place
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Object|null>} - Place details or null
 */
export const getPlaceDetails = async (placeId) => {
  try {
    const fields = 'place_id,name,formatted_address,geometry,rating,user_ratings_total,types,photos,editorial_summary';
    const url = `${PLACES_DETAILS_URL}?place_id=${placeId}&fields=${fields}&key=${GOOGLE_PLACES_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.result) {
      const result = data.result;

      // Get up to 3 photo URLs if available
      let photoUrl = null;
      let photoUrls = [];
      if (result.photos && result.photos.length > 0) {
        // Get up to 3 photos
        const photosToGet = result.photos.slice(0, 3);
        photoUrls = photosToGet.map((photo) =>
          `${PLACES_PHOTO_URL}?maxwidth=400&photo_reference=${photo.photo_reference}&key=${GOOGLE_PLACES_API_KEY}`
        );
        photoUrl = photoUrls[0]; // First photo as main image
      }

      // Format place type for display
      const placeType = formatPlaceType(result.types);

      return {
        id: result.place_id,
        placeId: result.place_id,
        name: result.name,
        type: placeType,
        address: result.formatted_address,
        rating: result.rating || 0,
        reviewCount: result.user_ratings_total || 0,
        description: result.editorial_summary?.overview || `${result.name} located at ${result.formatted_address}`,
        image: photoUrl,
        images: photoUrls, // Array of up to 3 photo URLs
        coordinates: {
          latitude: result.geometry?.location?.lat || 0,
          longitude: result.geometry?.location?.lng || 0,
        },
        saved: false,
        isGooglePlace: true, // Flag to identify this is from Google, not local storage
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting place details:', error);
    return null;
  }
};

/**
 * Get just the photo URL for a place (lightweight details fetch)
 * @param {string} placeId - Google Place ID
 * @returns {Promise<string|null>} - Photo URL or null
 */
export const getPlacePhoto = async (placeId) => {
  try {
    const url = `${PLACES_DETAILS_URL}?place_id=${placeId}&fields=photos&key=${GOOGLE_PLACES_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.result?.photos?.length > 0) {
      const photoReference = data.result.photos[0].photo_reference;
      return `${PLACES_PHOTO_URL}?maxwidth=200&photo_reference=${photoReference}&key=${GOOGLE_PLACES_API_KEY}`;
    }

    return null;
  } catch (error) {
    console.error('Error getting place photo:', error);
    return null;
  }
};

/**
 * Format Google place types to a readable string
 * @param {Array} types - Array of place type strings
 * @returns {string} - Formatted type string
 */
const formatPlaceType = (types) => {
  if (!types || types.length === 0) return 'Place';

  // Map of Google place types to display names
  const typeMap = {
    restaurant: 'Restaurant',
    cafe: 'Cafe',
    bar: 'Bar',
    night_club: 'Night Club',
    bakery: 'Bakery',
    meal_takeaway: 'Takeaway',
    meal_delivery: 'Delivery',
    food: 'Food',
    lodging: 'Hotel',
    museum: 'Museum',
    art_gallery: 'Art Gallery',
    park: 'Park',
    tourist_attraction: 'Tourist Attraction',
    shopping_mall: 'Shopping Mall',
    store: 'Store',
    gym: 'Gym',
    spa: 'Spa',
    movie_theater: 'Cinema',
    bowling_alley: 'Bowling',
    amusement_park: 'Amusement Park',
    zoo: 'Zoo',
    aquarium: 'Aquarium',
    stadium: 'Stadium',
    library: 'Library',
    church: 'Church',
    mosque: 'Mosque',
    synagogue: 'Synagogue',
    hindu_temple: 'Temple',
    airport: 'Airport',
    train_station: 'Train Station',
    bus_station: 'Bus Station',
    subway_station: 'Subway Station',
    hospital: 'Hospital',
    pharmacy: 'Pharmacy',
    doctor: 'Doctor',
    dentist: 'Dentist',
    bank: 'Bank',
    atm: 'ATM',
    gas_station: 'Gas Station',
    car_wash: 'Car Wash',
    car_repair: 'Auto Repair',
    beauty_salon: 'Beauty Salon',
    hair_care: 'Hair Salon',
  };

  // Find the first matching type
  for (const type of types) {
    if (typeMap[type]) {
      return typeMap[type];
    }
  }

  // Format the first type if no mapping found
  const firstType = types[0];
  return firstType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
