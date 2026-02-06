/**
 * Initial schema for offline-first persistence.
 */

import type { Migration } from '../types';

export const migration0001Initial: Migration = {
  id: '0001_initial',
  description: 'Create core v1 tables',
  statements: [
    'PRAGMA foreign_keys = ON;',
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      email TEXT,
      name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      google_place_id TEXT,
      name TEXT NOT NULL,
      address TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      rating REAL,
      notes TEXT,
      image_url TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_places_user_google_place_id
      ON places(user_id, google_place_id)
      WHERE google_place_id IS NOT NULL;`,
    'CREATE INDEX IF NOT EXISTS idx_places_user_id ON places(user_id);',
    `CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cover_image TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    'CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);',
    `CREATE TABLE IF NOT EXISTS collection_places (
      collection_id TEXT NOT NULL,
      place_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (collection_id, place_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS idx_collection_places_collection_position
      ON collection_places(collection_id, position);`,
    `CREATE TABLE IF NOT EXISTS preferences (
      user_id TEXT PRIMARY KEY,
      hexagon_theme TEXT NOT NULL DEFAULT 'stone',
      hexagon_variant TEXT NOT NULL DEFAULT 'medium',
      hexagon_size INTEGER NOT NULL DEFAULT 80,
      hexagon_custom_depth INTEGER,
      hexagon_use_custom_depth INTEGER NOT NULL DEFAULT 0 CHECK (hexagon_use_custom_depth IN (0, 1)),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      processed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    'CREATE INDEX IF NOT EXISTS idx_outbox_user_created_at ON outbox(user_id, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_outbox_processed_at ON outbox(processed_at);',
    `CREATE TABLE IF NOT EXISTS sync_state (
      user_id TEXT PRIMARY KEY,
      last_pulled_at TEXT,
      last_pushed_at TEXT,
      remote_cursor TEXT,
      last_synced_operation_id TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
  ],
};
