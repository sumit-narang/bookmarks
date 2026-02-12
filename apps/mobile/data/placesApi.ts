/**
 * Google Places API helper functions.
 * Handles searching for places and fetching details.
 */

import {
  GOOGLE_PLACES_API_KEY,
  PLACES_AUTOCOMPLETE_URL,
  PLACES_DETAILS_URL,
  PLACES_PHOTO_URL,
} from '../config/api';

export interface GooglePlaceSearchResult {
  placeId: string;
  name: string;
  address: string;
  fullDescription: string;
  photoUrl?: string;
}

export interface GooglePlaceDetails {
  id: string;
  placeId: string;
  name: string;
  type: string;
  address: string;
  rating: number;
  reviewCount: number;
  description: string;
  image: string | null;
  images: string[];
  coordinates: {
    latitude: number;
    longitude: number;
  };
  saved: boolean;
  isGooglePlace: boolean;
}

interface GoogleAutocompleteResponse {
  status: string;
  predictions?: Array<{
    place_id: string;
    description: string;
    structured_formatting?: {
      main_text?: string;
      secondary_text?: string;
    };
  }>;
}

interface GooglePlaceDetailsResponse {
  status: string;
  result?: {
    place_id: string;
    name: string;
    formatted_address: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
    photos?: Array<{
      photo_reference: string;
    }>;
    editorial_summary?: {
      overview?: string;
    };
  };
}

/**
 * Search for places using Google Places Autocomplete.
 * @param query
 * @returns {Promise<GooglePlaceSearchResult[]>}
 */
export const searchPlacesGoogle = async (query: string): Promise<GooglePlaceSearchResult[]> => {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const url = `${PLACES_AUTOCOMPLETE_URL}?input=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_API_KEY}&types=establishment`;

    const response = await fetch(url);
    const data = (await response.json()) as GoogleAutocompleteResponse;

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
 * Get detailed information about a place.
 * @param placeId
 * @returns {Promise<GooglePlaceDetails | null>}
 */
export const getPlaceDetails = async (placeId: string): Promise<GooglePlaceDetails | null> => {
  try {
    const fields = 'place_id,name,formatted_address,geometry,rating,user_ratings_total,types,photos,editorial_summary';
    const url = `${PLACES_DETAILS_URL}?place_id=${placeId}&fields=${fields}&key=${GOOGLE_PLACES_API_KEY}`;

    const response = await fetch(url);
    const data = (await response.json()) as GooglePlaceDetailsResponse;

    if (data.status === 'OK' && data.result) {
      const result = data.result;

      let photoUrl: string | null = null;
      let photoUrls: string[] = [];

      if (result.photos && result.photos.length > 0) {
        const photosToGet = result.photos.slice(0, 3);
        photoUrls = photosToGet.map((photo) => {
          return `${PLACES_PHOTO_URL}?maxwidth=400&photo_reference=${photo.photo_reference}&key=${GOOGLE_PLACES_API_KEY}`;
        });
        photoUrl = photoUrls[0] ?? null;
      }

      const placeType = formatPlaceType(result.types ?? []);

      return {
        id: result.place_id,
        placeId: result.place_id,
        name: result.name,
        type: placeType,
        address: result.formatted_address,
        rating: result.rating ?? 0,
        reviewCount: result.user_ratings_total ?? 0,
        description: result.editorial_summary?.overview ?? `${result.name} located at ${result.formatted_address}`,
        image: photoUrl,
        images: photoUrls,
        coordinates: {
          latitude: result.geometry?.location?.lat ?? 0,
          longitude: result.geometry?.location?.lng ?? 0,
        },
        saved: false,
        isGooglePlace: true,
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting place details:', error);
    return null;
  }
};

/**
 * Get only the first photo URL for a place.
 * @param placeId
 * @returns {Promise<string | null>}
 */
export const getPlacePhoto = async (placeId: string): Promise<string | null> => {
  try {
    const url = `${PLACES_DETAILS_URL}?place_id=${placeId}&fields=photos&key=${GOOGLE_PLACES_API_KEY}`;

    const response = await fetch(url);
    const data = (await response.json()) as GooglePlaceDetailsResponse;

    if (data.status === 'OK' && data.result?.photos && data.result.photos.length > 0) {
      const photoReference = data.result.photos[0]?.photo_reference;

      if (!photoReference) {
        return null;
      }

      return `${PLACES_PHOTO_URL}?maxwidth=200&photo_reference=${photoReference}&key=${GOOGLE_PLACES_API_KEY}`;
    }

    return null;
  } catch (error) {
    console.error('Error getting place photo:', error);
    return null;
  }
};

const formatPlaceType = (types: string[]): string => {
  if (!types || types.length === 0) {
    return 'Place';
  }

  const typeMap: Record<string, string> = {
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

  for (const type of types) {
    if (typeMap[type]) {
      return typeMap[type];
    }
  }

  const firstType = types[0] ?? 'Place';
  return firstType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
