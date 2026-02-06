/**
 * Shared table contracts used by runtime modules.
 */

export interface UserRow {
  id: string;
  provider: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaceRow {
  id: string;
  user_id: string;
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  notes: string | null;
  image_url: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  cover_image: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CollectionPlaceRow {
  collection_id: string;
  place_id: string;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PreferenceRow {
  user_id: string;
  hexagon_theme: string;
  hexagon_variant: string;
  hexagon_size: number;
  hexagon_custom_depth: number | null;
  hexagon_use_custom_depth: 0 | 1;
  updated_at: string;
}

export interface OutboxRow {
  id: string;
  user_id: string;
  operation_type: string;
  entity_type: string;
  entity_id: string;
  payload_json: string;
  operation_id: string;
  created_at: string;
  updated_at: string;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
}

export interface SyncStateRow {
  user_id: string;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  remote_cursor: string | null;
  last_synced_operation_id: string | null;
  updated_at: string;
}
