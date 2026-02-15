/**
 * Expand sync_state to track per-entity cursors.
 */

import type { Migration } from '../types';

export const migration0002SyncStateEntityType: Migration = {
  id: '0002_sync_state_entity_type',
  description: 'Add entity_type to sync_state primary key',
  statements: [
    `CREATE TABLE IF NOT EXISTS sync_state_new (
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      last_pulled_at TEXT,
      last_pushed_at TEXT,
      remote_cursor TEXT,
      last_synced_operation_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, entity_type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `INSERT INTO sync_state_new (
      user_id,
      entity_type,
      last_pulled_at,
      last_pushed_at,
      remote_cursor,
      last_synced_operation_id,
      updated_at
    )
    SELECT
      user_id,
      'preferences',
      last_pulled_at,
      last_pushed_at,
      remote_cursor,
      last_synced_operation_id,
      updated_at
    FROM sync_state;`,
    'DROP TABLE sync_state;',
    'ALTER TABLE sync_state_new RENAME TO sync_state;',
  ],
};
