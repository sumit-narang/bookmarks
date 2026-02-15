/**
 * Shared auth contracts used by backend, clients, and mobile runtime.
 */

export type AuthTokenType = 'access' | 'refresh';

export interface AuthUserProfile {
  id: string;
  provider: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthIdentityInput {
  provider: string;
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  identityToken?: string | null;
}

export interface AuthTokenPayload {
  tokenType: AuthTokenType;
  userId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  issuer?: string;
  audience?: string;
}

export interface AuthTokenBundle {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface AuthSessionEnvelope {
  sessionId: string;
  userId: string;
  tokens: AuthTokenBundle;
}

export interface AuthSessionRecord {
  sessionId: string;
  userId: string;
  refreshTokenHash: string;
  refreshExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string;
  revokedAt: string | null;
}

export interface CreateAuthSessionRequest extends AuthIdentityInput {}

export interface CreateAuthSessionResponse {
  user: AuthUserProfile;
  session: AuthSessionEnvelope;
}

export interface RefreshAuthSessionRequest {
  refreshToken: string;
}

export interface RefreshAuthSessionResponse {
  session: AuthSessionEnvelope;
}

export interface RevokeAuthSessionRequest {
  refreshToken?: string;
}

export interface RevokeAuthSessionResponse {
  revoked: boolean;
}
