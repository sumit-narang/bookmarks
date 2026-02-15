/**
 * Add per-entity operation IDs for deterministic LWW tie-breaks.
 */

import type { Migration } from '../types';

export const migration0004EntityOperationIds: Migration = {
  id: '0004_entity_operation_ids',
  description: 'Add last_operation_id columns for places and collections',
  statements: [
    'ALTER TABLE places ADD COLUMN last_operation_id TEXT;',
    'ALTER TABLE collections ADD COLUMN last_operation_id TEXT;',
    `UPDATE places
     SET last_operation_id = updated_at || ':' || id
     WHERE last_operation_id IS NULL;`,
    `UPDATE collections
     SET last_operation_id = updated_at || ':' || id
     WHERE last_operation_id IS NULL;`,
  ],
};
