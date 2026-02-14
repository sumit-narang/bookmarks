/**
 * Auth session persistence helpers.
 */

import { createUuid, nowIso } from '../../core/src';
import type { DatabaseAdapter } from '../../db/src';
import type { AuthSessionRow, UserRow } from '../../schema/src';
import type { AuthIdentityInput, AuthSessionRecord, AuthUserProfile } from './contracts';

interface PersistedAuthSessionRow extends AuthSessionRow {}
interface PersistedUserRow extends UserRow {}

const mapUserRow = (row: PersistedUserRow): AuthUserProfile => {
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
};

const mapAuthSessionRow = (row: PersistedAuthSessionRow): AuthSessionRecord => {
  return {
    sessionId: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    refreshExpiresAt: row.refresh_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRefreshedAt: row.last_refreshed_at,
    revokedAt: row.revoked_at,
  };
};

export interface CreateAuthSessionOptions {
  sessionId?: string;
  userId: string;
  refreshTokenHash: string;
  refreshExpiresAt: string;
  createdAt?: string;
}

/**
 * Upsert a user profile from a resolved provider identity.
 * @param database
 * @param identity
 * @returns {Promise<AuthUserProfile>}
 */
export const upsertAuthUser = async (
  database: DatabaseAdapter,
  identity: AuthIdentityInput
): Promise<AuthUserProfile> => {
  const timestamp = nowIso();
  const email = identity.email ?? null;
  const name = identity.name ?? null;
  const avatarUrl = identity.avatarUrl ?? null;

  await database.run(
    `INSERT INTO users (id, provider, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       email = excluded.email,
       name = excluded.name,
       avatar_url = excluded.avatar_url,
       updated_at = excluded.updated_at;`,
    [
      identity.providerUserId,
      identity.provider,
      email,
      name,
      avatarUrl,
      timestamp,
      timestamp,
    ]
  );

  const row = await database.get<PersistedUserRow>(
    `SELECT id, provider, email, name, avatar_url, created_at, updated_at
     FROM users
     WHERE id = ?;`,
    [identity.providerUserId]
  );

  if (!row) {
    throw new Error(`Failed to upsert auth user ${identity.providerUserId}.`);
  }

  return mapUserRow(row);
};

/**
 * Create a persisted auth session for refresh/revoke tracking.
 * @param database
 * @param options
 * @returns {Promise<AuthSessionRecord>}
 */
export const createAuthSession = async (
  database: DatabaseAdapter,
  options: CreateAuthSessionOptions
): Promise<AuthSessionRecord> => {
  const sessionId = options.sessionId ?? createUuid();
  const createdAt = options.createdAt ?? nowIso();

  await database.run(
    `INSERT INTO auth_sessions (
      id,
      user_id,
      refresh_token_hash,
      refresh_expires_at,
      created_at,
      updated_at,
      last_refreshed_at,
      revoked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL);`,
    [
      sessionId,
      options.userId,
      options.refreshTokenHash,
      options.refreshExpiresAt,
      createdAt,
      createdAt,
      createdAt,
    ]
  );

  const created = await getAuthSessionById(database, sessionId);

  if (!created) {
    throw new Error(`Failed to create auth session ${sessionId}.`);
  }

  return created;
};

/**
 * Read a single auth session by session ID.
 * @param database
 * @param sessionId
 * @returns {Promise<AuthSessionRecord | null>}
 */
export const getAuthSessionById = async (
  database: DatabaseAdapter,
  sessionId: string
): Promise<AuthSessionRecord | null> => {
  const row = await database.get<PersistedAuthSessionRow>(
    `SELECT
       id,
       user_id,
       refresh_token_hash,
       refresh_expires_at,
       created_at,
       updated_at,
       last_refreshed_at,
       revoked_at
     FROM auth_sessions
     WHERE id = ?;`,
    [sessionId]
  );

  if (!row) {
    return null;
  }

  return mapAuthSessionRow(row);
};

export interface RotateAuthSessionOptions {
  sessionId: string;
  refreshTokenHash: string;
  refreshExpiresAt: string;
  previousRefreshTokenHash?: string;
  refreshedAt?: string;
}

/**
 * Rotate refresh-token tracking fields for an active session.
 * @param database
 * @param options
 * @returns {Promise<AuthSessionRecord | null>}
 */
export const rotateAuthSession = async (
  database: DatabaseAdapter,
  options: RotateAuthSessionOptions
): Promise<AuthSessionRecord | null> => {
  const refreshedAt = options.refreshedAt ?? nowIso();

  const wherePreviousHashClause = options.previousRefreshTokenHash
    ? ' AND refresh_token_hash = ?'
    : '';

  const params: Array<string> = [
    options.refreshTokenHash,
    options.refreshExpiresAt,
    refreshedAt,
    refreshedAt,
    options.sessionId,
  ];

  if (options.previousRefreshTokenHash) {
    params.push(options.previousRefreshTokenHash);
  }

  const result = await database.run(
    `UPDATE auth_sessions
     SET refresh_token_hash = ?,
         refresh_expires_at = ?,
         last_refreshed_at = ?,
         updated_at = ?
     WHERE id = ?
       AND revoked_at IS NULL${wherePreviousHashClause};`,
    params
  );

  if (result.changes === 0) {
    return null;
  }

  return getAuthSessionById(database, options.sessionId);
};

/**
 * Revoke a session so future access and refresh attempts are blocked.
 * @param database
 * @param sessionId
 * @param revokedAt
 * @returns {Promise<AuthSessionRecord | null>}
 */
export const revokeAuthSession = async (
  database: DatabaseAdapter,
  sessionId: string,
  revokedAt = nowIso()
): Promise<AuthSessionRecord | null> => {
  await database.run(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, ?),
         updated_at = ?
     WHERE id = ?;`,
    [revokedAt, revokedAt, sessionId]
  );

  return getAuthSessionById(database, sessionId);
};

/**
 * Whether a session is currently usable for auth checks.
 * @param session
 * @param timestamp
 * @returns {boolean}
 */
export const isAuthSessionActive = (
  session: Pick<AuthSessionRecord, 'refreshExpiresAt' | 'revokedAt'>,
  timestamp = nowIso()
): boolean => {
  if (session.revokedAt !== null) {
    return false;
  }

  return session.refreshExpiresAt > timestamp;
};
