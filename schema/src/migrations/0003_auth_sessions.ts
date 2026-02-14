/**
 * Add persisted auth session tracking for refresh/revoke flows.
 */

import type { Migration } from '../types';

export const migration0003AuthSessions: Migration = {
  id: '0003_auth_sessions',
  description: 'Create auth_sessions table for refresh token lifecycle',
  statements: [
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      refresh_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_refreshed_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    'CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);',
    'CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions(revoked_at);',
    'CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_expires_at ON auth_sessions(refresh_expires_at);',
  ],
};
