/**
 * Shared mobile-layer view models.
 * These keep existing screen contracts while persistence uses shared TS modules.
 */

export interface LegacyPlace {
  id: string;
  placeId?: string;
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
  latitude: number;
  longitude: number;
  saved: boolean;
  isGooglePlace: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyCollection {
  id: string;
  name: string;
  placeCount: number;
  coverImage: string | null;
  places: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
  picture: string | null;
  provider: 'google' | 'apple';
}
