/**
 * API Configuration
 *
 * API keys are loaded from environment variables.
 * Create a .env file with: EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=your_key_here
 *
 * To get a Google Places API key:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a new project (or select existing)
 * 3. Enable "Places API" and "Places API (New)"
 * 4. Go to Credentials → Create Credentials → API Key
 * 5. Copy the key to your .env file
 */

export const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

// Google Places API endpoints
export const PLACES_AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
export const PLACES_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
export const PLACES_PHOTO_URL = 'https://maps.googleapis.com/maps/api/place/photo';
