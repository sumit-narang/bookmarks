/**
 * Backend server for persistence foundation routes.
 */

import { createHmac, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'node:crypto';
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAuthSession,
  getAuthSessionById,
  hashAuthToken,
  isAuthSessionActive,
  issueAuthTokenPair,
  revokeAuthSession,
  rotateAuthSession,
  upsertAuthUser,
  verifyAuthToken,
  type AuthIdentityInput,
  type AuthSessionEnvelope,
  type AuthTokenCodecOptions,
  type AuthTokenPayload,
  type CreateAuthSessionRequest,
  type RefreshAuthSessionRequest,
  type RevokeAuthSessionRequest,
} from '../../../auth/src';
import { createUuid, nowIso } from '../../../core/src';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
import {
  addPlaceToCollection,
  applyCollectionSyncOperation,
  createCollection,
  getCollection,
  listCollectionPlaces,
  listCollections,
  parseCollectionInput,
  removeCollection,
  removePlaceFromCollection,
  updateCollection,
  type CollectionInput,
  type CollectionSyncOperation,
  type CollectionSyncOperationType,
} from '../../../collections/src';
import {
  applyPlaceSyncOperation,
  getPlace,
  listPlaces,
  parsePlaceInput,
  removePlace,
  upsertPlace,
  type PlaceInput,
  type PlaceSyncOperation,
} from '../../../places/src';
import {
  applyPreferenceSyncOperation,
  getOrCreatePreferences,
  getPreferenceSyncState,
  setPreferences,
  type HexagonPreferencesValues,
  type HexagonPreferencesPatch,
  type PreferenceSyncOperation,
} from '../../../preferences/src';
import { schemaMigrations } from '../../../schema/src';

export interface BackendServerOptions {
  host: string;
  port: number;
  databasePath: string;
  auth?: Partial<BackendAuthOptions>;
}

export interface BackendAuthOptions {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

export interface BackendServer {
  /** Start listening. Returns the actual bound port (useful when port 0 is requested). */
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
}

const DEFAULT_AUTH_TOKEN_ISSUER = 'bookmarks-backend';
const DEFAULT_AUTH_TOKEN_AUDIENCE = 'bookmarks-clients';
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_ISSUER = 'https://appleid.apple.com';
const JWK_CACHE_FALLBACK_TTL_MILLISECONDS = 5 * 60 * 1000;

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const badRequest = (message: string): HttpError => {
  return new HttpError(400, message);
};

const unauthorized = (message: string): HttpError => {
  return new HttpError(401, message);
};

const forbidden = (message: string): HttpError => {
  return new HttpError(403, message);
};

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
};

const readJsonBody = async <TPayload>(request: IncomingMessage): Promise<TPayload> => {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {} as TPayload;
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw) {
    return {} as TPayload;
  }

  return JSON.parse(raw) as TPayload;
};

interface AuthenticatedRequestContext {
  userId: string;
  sessionId: string;
  token: AuthTokenPayload;
}

const buildTokenCodec = (authOptions: BackendAuthOptions): AuthTokenCodecOptions => {
  return {
    secret: authOptions.tokenSecret,
    issuer: authOptions.tokenIssuer,
    audience: authOptions.tokenAudience,
  };
};

const toSessionEnvelope = (
  userId: string,
  sessionId: string,
  issued: ReturnType<typeof issueAuthTokenPair>
): AuthSessionEnvelope => {
  return {
    sessionId,
    userId,
    tokens: {
      tokenType: 'Bearer',
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
    },
  };
};

const extractBearerToken = (request: IncomingMessage): string | null => {
  const authorizationHeader = request.headers.authorization;

  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);

  if (!match || !match[1]) {
    throw unauthorized('Authorization header must use Bearer token format.');
  }

  return match[1].trim();
};

const requireBearerToken = (request: IncomingMessage): string => {
  const token = extractBearerToken(request);

  if (!token) {
    throw unauthorized('Authorization header is required.');
  }

  return token;
};

const parseAuthIdentityInput = (value: unknown): AuthIdentityInput => {
  if (!value || typeof value !== 'object') {
    throw badRequest('Auth session request body must be an object.');
  }

  const input = value as Record<string, unknown>;

  if (typeof input.provider !== 'string' || input.provider.trim().length === 0) {
    throw badRequest('Auth session request must include provider.');
  }

  if (typeof input.providerUserId !== 'string' || input.providerUserId.trim().length === 0) {
    throw badRequest('Auth session request must include providerUserId.');
  }

  if (input.email !== undefined && input.email !== null && typeof input.email !== 'string') {
    throw badRequest('email must be a string or null when provided.');
  }

  if (input.name !== undefined && input.name !== null && typeof input.name !== 'string') {
    throw badRequest('name must be a string or null when provided.');
  }

  if (input.avatarUrl !== undefined && input.avatarUrl !== null && typeof input.avatarUrl !== 'string') {
    throw badRequest('avatarUrl must be a string or null when provided.');
  }

  if (input.identityToken !== undefined && input.identityToken !== null && typeof input.identityToken !== 'string') {
    throw badRequest('identityToken must be a string or null when provided.');
  }

  return {
    provider: input.provider.trim().toLowerCase(),
    providerUserId: input.providerUserId.trim(),
    email: (input.email as string | null | undefined) ?? null,
    name: (input.name as string | null | undefined) ?? null,
    avatarUrl: (input.avatarUrl as string | null | undefined) ?? null,
    identityToken: (input.identityToken as string | null | undefined) ?? null,
  };
};

interface VerifiedAuthIdentity {
  providerUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

interface GoogleUserInfoResponse {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
}

interface ParsedJwtToken<TPayload extends object> {
  header: Record<string, unknown>;
  payload: TPayload;
  signingInput: string;
  signature: Buffer;
}

interface AppleIdentityTokenPayload {
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  email?: unknown;
}

interface JsonWebKeySetResponse {
  keys?: unknown;
}

let cachedAppleJwks: { keys: Array<Record<string, unknown>>; expiresAtMs: number } | null = null;

const getRequiredIdentityToken = (identity: AuthIdentityInput): string => {
  const identityToken = identity.identityToken?.trim() ?? '';

  if (!identityToken) {
    throw unauthorized('identityToken is required for auth session creation.');
  }

  return identityToken;
};

const isTimingSafeStringEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const parseJwtJsonSegment = <TPayload extends object>(segment: string, segmentName: string): TPayload => {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(json) as TPayload;
  } catch {
    throw unauthorized(`Identity token ${segmentName} segment is invalid.`);
  }
};

const parseJwtToken = <TPayload extends object>(token: string): ParsedJwtToken<TPayload> => {
  const segments = token.split('.');

  if (segments.length !== 3) {
    throw unauthorized('Identity token must use JWT format.');
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;

  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw unauthorized('Identity token JWT segments must be non-empty.');
  }

  return {
    header: parseJwtJsonSegment<Record<string, unknown>>(headerSegment, 'header'),
    payload: parseJwtJsonSegment<TPayload>(payloadSegment, 'payload'),
    signingInput: `${headerSegment}.${payloadSegment}`,
    signature: Buffer.from(signatureSegment, 'base64url'),
  };
};

const parseCacheControlMaxAgeMilliseconds = (cacheControlHeader: string | null): number => {
  if (!cacheControlHeader) {
    return JWK_CACHE_FALLBACK_TTL_MILLISECONDS;
  }

  const maxAgeMatch = cacheControlHeader.match(/max-age=(\d+)/i);

  if (!maxAgeMatch || !maxAgeMatch[1]) {
    return JWK_CACHE_FALLBACK_TTL_MILLISECONDS;
  }

  const maxAgeSeconds = Number(maxAgeMatch[1]);

  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    return JWK_CACHE_FALLBACK_TTL_MILLISECONDS;
  }

  return maxAgeSeconds * 1000;
};

const loadAppleJwks = async (): Promise<Array<Record<string, unknown>>> => {
  const timestamp = Date.now();

  if (cachedAppleJwks && cachedAppleJwks.expiresAtMs > timestamp) {
    return cachedAppleJwks.keys;
  }

  let response: Response;

  try {
    response = await fetch(APPLE_JWKS_URL);
  } catch (error) {
    throw unauthorized(`Unable to load Apple signing keys: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw unauthorized(`Unable to load Apple signing keys: HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as JsonWebKeySetResponse;

  if (!Array.isArray(payload.keys)) {
    throw unauthorized('Apple signing-key response is malformed.');
  }

  const keys = payload.keys.filter((entry): entry is Record<string, unknown> => {
    return Boolean(entry) && typeof entry === 'object';
  });

  if (keys.length === 0) {
    throw unauthorized('Apple signing-key response did not include usable keys.');
  }

  cachedAppleJwks = {
    keys,
    expiresAtMs: timestamp + parseCacheControlMaxAgeMilliseconds(response.headers.get('cache-control')),
  };

  return keys;
};

const verifyGoogleIdentity = async (identity: AuthIdentityInput): Promise<VerifiedAuthIdentity> => {
  const identityToken = getRequiredIdentityToken(identity);

  let response: Response;

  try {
    response = await fetch(GOOGLE_USER_INFO_URL, {
      headers: {
        Authorization: `Bearer ${identityToken}`,
      },
    });
  } catch (error) {
    throw unauthorized(`Unable to verify Google identity token: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw unauthorized('Google identity token is invalid or expired.');
  }

  const userInfo = (await response.json()) as GoogleUserInfoResponse;

  if (typeof userInfo.id !== 'string' || userInfo.id.trim().length === 0) {
    throw unauthorized('Google identity token did not return a user id.');
  }

  const providerUserId = userInfo.id.trim();

  if (providerUserId !== identity.providerUserId) {
    throw unauthorized('Google identity token subject does not match providerUserId.');
  }

  return {
    providerUserId,
    email: typeof userInfo.email === 'string' ? userInfo.email : null,
    name: typeof userInfo.name === 'string' ? userInfo.name : null,
    avatarUrl: typeof userInfo.picture === 'string' ? userInfo.picture : null,
  };
};

const verifyAppleIdentity = async (identity: AuthIdentityInput): Promise<VerifiedAuthIdentity> => {
  const identityToken = getRequiredIdentityToken(identity);
  const parsedToken = parseJwtToken<AppleIdentityTokenPayload>(identityToken);
  const algorithm = typeof parsedToken.header.alg === 'string' ? parsedToken.header.alg : null;
  const keyId = typeof parsedToken.header.kid === 'string' ? parsedToken.header.kid : null;

  if (algorithm !== 'RS256' || !keyId) {
    throw unauthorized('Apple identity token header is invalid.');
  }

  const issuer = typeof parsedToken.payload.iss === 'string' ? parsedToken.payload.iss : null;
  const providerUserId = typeof parsedToken.payload.sub === 'string' ? parsedToken.payload.sub : null;
  const expiresAt = typeof parsedToken.payload.exp === 'number' ? parsedToken.payload.exp : null;

  if (issuer !== APPLE_TOKEN_ISSUER) {
    throw unauthorized('Apple identity token issuer is invalid.');
  }

  if (!providerUserId) {
    throw unauthorized('Apple identity token is missing subject.');
  }

  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw unauthorized('Apple identity token is expired.');
  }

  if (providerUserId !== identity.providerUserId) {
    throw unauthorized('Apple identity token subject does not match providerUserId.');
  }

  const keys = await loadAppleJwks();
  const signingKey = keys.find((entry) => entry.kid === keyId);

  if (!signingKey) {
    throw unauthorized('Unable to find Apple signing key for token header kid.');
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(parsedToken.signingInput);
  verifier.end();

  const isSignatureValid = verifier.verify(
    createPublicKey({
      key: signingKey as CryptoJsonWebKey,
      format: 'jwk',
    }),
    parsedToken.signature
  );

  if (!isSignatureValid) {
    throw unauthorized('Apple identity token signature is invalid.');
  }

  return {
    providerUserId,
    email: typeof parsedToken.payload.email === 'string' ? parsedToken.payload.email : null,
    name: identity.name ?? null,
    avatarUrl: identity.avatarUrl ?? null,
  };
};

const verifyTestIdentity = (identity: AuthIdentityInput, authOptions: BackendAuthOptions): VerifiedAuthIdentity => {
  if (process.env.NODE_ENV === 'production') {
    throw forbidden('test auth provider is disabled in production.');
  }

  const identityToken = getRequiredIdentityToken(identity);
  const expectedToken = createHmac('sha256', authOptions.tokenSecret)
    .update(`${identity.provider}:${identity.providerUserId}`)
    .digest('hex');

  if (!isTimingSafeStringEqual(identityToken, expectedToken)) {
    throw unauthorized('Test identity token is invalid.');
  }

  return {
    providerUserId: identity.providerUserId,
    email: identity.email ?? null,
    name: identity.name ?? null,
    avatarUrl: identity.avatarUrl ?? null,
  };
};

const verifyAuthIdentity = async (
  identity: AuthIdentityInput,
  authOptions: BackendAuthOptions
): Promise<VerifiedAuthIdentity> => {
  switch (identity.provider) {
    case 'google':
      return verifyGoogleIdentity(identity);
    case 'apple':
      return verifyAppleIdentity(identity);
    case 'test':
      return verifyTestIdentity(identity, authOptions);
    default:
      throw forbidden(`Unsupported auth provider: ${identity.provider}.`);
  }
};

const parseRefreshAuthSessionRequest = (value: unknown): RefreshAuthSessionRequest => {
  if (!value || typeof value !== 'object') {
    throw badRequest('Refresh request body must be an object.');
  }

  const input = value as Record<string, unknown>;

  if (typeof input.refreshToken !== 'string' || input.refreshToken.trim().length === 0) {
    throw badRequest('Refresh request must include refreshToken.');
  }

  return {
    refreshToken: input.refreshToken,
  };
};

const parseRevokeAuthSessionRequest = (value: unknown): RevokeAuthSessionRequest => {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object') {
    throw badRequest('Revoke request body must be an object when provided.');
  }

  const input = value as Record<string, unknown>;

  if (input.refreshToken !== undefined && input.refreshToken !== null && typeof input.refreshToken !== 'string') {
    throw badRequest('refreshToken must be a string when provided.');
  }

  return {
    refreshToken: (input.refreshToken as string | undefined) ?? undefined,
  };
};

const ensureRouteUserMatchesAuthenticatedUser = (routeUserId: string, authenticatedUserId: string): void => {
  if (routeUserId !== authenticatedUserId) {
    throw forbidden('Requested user does not match authenticated user.');
  }
};

const requireAuthenticatedRequestContext = async (
  request: IncomingMessage,
  databasePath: string,
  tokenCodec: AuthTokenCodecOptions
): Promise<AuthenticatedRequestContext> => {
  const accessToken = requireBearerToken(request);

  let payload: AuthTokenPayload;

  try {
    payload = verifyAuthToken(accessToken, tokenCodec, { expectedType: 'access' });
  } catch (error) {
    throw unauthorized(`Invalid access token: ${(error as Error).message}`);
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const session = await getAuthSessionById(adapter, payload.sessionId);

    if (!session) {
      throw unauthorized('Auth session not found.');
    }

    if (session.userId !== payload.userId) {
      throw unauthorized('Auth session user mismatch.');
    }

    if (!isAuthSessionActive(session)) {
      throw unauthorized('Auth session has expired or is revoked.');
    }
  } finally {
    await adapter.close();
  }

  return {
    userId: payload.userId,
    sessionId: payload.sessionId,
    token: payload,
  };
};

const parsePreferencePatch = (value: unknown): HexagonPreferencesPatch => {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object') {
    throw new Error('Preference patch must be an object.');
  }

  const input = value as Record<string, unknown>;
  const patch: HexagonPreferencesPatch = {};

  if ('hexagonTheme' in input) {
    if (typeof input.hexagonTheme !== 'string') {
      throw new Error('hexagonTheme must be a string.');
    }

    patch.hexagonTheme = input.hexagonTheme;
  }

  if ('hexagonVariant' in input) {
    if (typeof input.hexagonVariant !== 'string') {
      throw new Error('hexagonVariant must be a string.');
    }

    patch.hexagonVariant = input.hexagonVariant;
  }

  if ('hexagonSize' in input) {
    if (typeof input.hexagonSize !== 'number') {
      throw new Error('hexagonSize must be a number.');
    }

    patch.hexagonSize = input.hexagonSize;
  }

  if ('hexagonCustomDepth' in input) {
    if (typeof input.hexagonCustomDepth !== 'number' && input.hexagonCustomDepth !== null) {
      throw new Error('hexagonCustomDepth must be a number or null.');
    }

    patch.hexagonCustomDepth = input.hexagonCustomDepth;
  }

  if ('hexagonUseCustomDepth' in input) {
    if (typeof input.hexagonUseCustomDepth !== 'boolean') {
      throw new Error('hexagonUseCustomDepth must be a boolean.');
    }

    patch.hexagonUseCustomDepth = input.hexagonUseCustomDepth;
  }

  return patch;
};

const parsePreferenceValues = (value: unknown): HexagonPreferencesValues => {
  const patch = parsePreferencePatch(value);

  if (
    patch.hexagonTheme === undefined
    || patch.hexagonVariant === undefined
    || patch.hexagonSize === undefined
    || patch.hexagonCustomDepth === undefined
    || patch.hexagonUseCustomDepth === undefined
  ) {
    throw new Error('Sync operation preferences must include all preference fields.');
  }

  return {
    hexagonTheme: patch.hexagonTheme,
    hexagonVariant: patch.hexagonVariant,
    hexagonSize: patch.hexagonSize,
    hexagonCustomDepth: patch.hexagonCustomDepth,
    hexagonUseCustomDepth: patch.hexagonUseCustomDepth,
  };
};

const compareOperationVersion = (
  left: { updatedAt: string; operationId: string },
  right: { updatedAt: string; operationId: string }
): number => {
  if (left.updatedAt > right.updatedAt) {
    return 1;
  }

  if (left.updatedAt < right.updatedAt) {
    return -1;
  }

  if (left.operationId > right.operationId) {
    return 1;
  }

  if (left.operationId < right.operationId) {
    return -1;
  }

  return 0;
};

const parsePreferenceSyncOperation = (value: unknown): PreferenceSyncOperation => {
  if (!value || typeof value !== 'object') {
    throw new Error('Sync operation must be an object.');
  }

  const input = value as Record<string, unknown>;

  if (typeof input.userId !== 'string') {
    throw new Error('Sync operation is missing userId.');
  }

  if (typeof input.operationId !== 'string') {
    throw new Error('Sync operation is missing operationId.');
  }

  if (typeof input.updatedAt !== 'string') {
    throw new Error('Sync operation is missing updatedAt.');
  }

  return {
    userId: input.userId,
    operationId: input.operationId,
    updatedAt: input.updatedAt,
    preferences: parsePreferenceValues(input.preferences),
  };
};

interface GenericSyncOperationInput {
  entityId: string;
  operationId: string;
  operationType: string;
  updatedAt: string;
  payload: Record<string, unknown>;
}

const parseGenericSyncOperationInput = (value: unknown): GenericSyncOperationInput => {
  if (!value || typeof value !== 'object') {
    throw new Error('Sync operation must be an object.');
  }

  const input = value as Record<string, unknown>;

  if (typeof input.entityId !== 'string') {
    throw new Error('Sync operation is missing entityId.');
  }

  if (typeof input.operationId !== 'string') {
    throw new Error('Sync operation is missing operationId.');
  }

  if (typeof input.operationType !== 'string') {
    throw new Error('Sync operation is missing operationType.');
  }

  if (typeof input.updatedAt !== 'string') {
    throw new Error('Sync operation is missing updatedAt.');
  }

  if (!input.payload || typeof input.payload !== 'object') {
    throw new Error('Sync operation is missing payload object.');
  }

  return {
    entityId: input.entityId,
    operationId: input.operationId,
    operationType: input.operationType,
    updatedAt: input.updatedAt,
    payload: input.payload as Record<string, unknown>,
  };
};

const parsePlaceSyncOperation = (value: unknown, userId: string): PlaceSyncOperation => {
  const operation = parseGenericSyncOperationInput(value);
  const payloadUserId = typeof operation.payload.userId === 'string' ? operation.payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error('Place sync operation userId does not match payload userId.');
  }

  const placeId = typeof operation.payload.placeId === 'string' ? operation.payload.placeId : operation.entityId;

  if (operation.operationType !== 'upsert' && operation.operationType !== 'delete') {
    throw new Error(`Unsupported place sync operation type: ${operation.operationType}.`);
  }

  if (operation.operationType === 'upsert') {
    const placeInput = parsePlaceInput(operation.payload.place);

    return {
      userId,
      placeId,
      operationId: operation.operationId,
      operationType: 'upsert',
      updatedAt: operation.updatedAt,
      place: placeInput,
    };
  }

  return {
    userId,
    placeId,
    operationId: operation.operationId,
    operationType: 'delete',
    updatedAt: operation.updatedAt,
    place: null,
  };
};

const parseCollectionSyncOperation = (value: unknown, userId: string): CollectionSyncOperation => {
  const operation = parseGenericSyncOperationInput(value);
  const payloadUserId = typeof operation.payload.userId === 'string' ? operation.payload.userId : userId;

  if (payloadUserId !== userId) {
    throw new Error('Collection sync operation userId does not match payload userId.');
  }

  const collectionId = typeof operation.payload.collectionId === 'string'
    ? operation.payload.collectionId
    : operation.entityId;

  if (
    operation.operationType !== 'create'
    && operation.operationType !== 'update'
    && operation.operationType !== 'delete'
    && operation.operationType !== 'add-place'
    && operation.operationType !== 'remove-place'
    && operation.operationType !== 'upsert'
  ) {
    throw new Error(`Unsupported collection sync operation type: ${operation.operationType}.`);
  }

  const placeId = typeof operation.payload.placeId === 'string' ? operation.payload.placeId : null;

  let collectionInput: CollectionInput | null = null;

  if (operation.payload.collection !== null && operation.payload.collection !== undefined) {
    collectionInput = parseCollectionInput(operation.payload.collection);
  }

  let placeIds: string[] | undefined;

  if (operation.payload.placeIds !== undefined) {
    if (!Array.isArray(operation.payload.placeIds)) {
      throw new Error('Collection sync operation placeIds must be an array when provided.');
    }

    placeIds = operation.payload.placeIds.map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error('Collection sync operation placeIds entries must be strings.');
      }

      return entry;
    });
  }

  return {
    userId,
    collectionId,
    operationId: operation.operationId,
    operationType: operation.operationType,
    updatedAt: operation.updatedAt,
    collection: collectionInput,
    placeId,
    placeIds,
  };
};

const handleAuthSessionCreate = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  authOptions: BackendAuthOptions
): Promise<void> => {
  const payload = await readJsonBody<CreateAuthSessionRequest>(request);
  const identityInput = parseAuthIdentityInput(payload);
  const verifiedIdentity = await verifyAuthIdentity(identityInput, authOptions);

  const identity: AuthIdentityInput = {
    provider: identityInput.provider,
    providerUserId: verifiedIdentity.providerUserId,
    email: verifiedIdentity.email ?? identityInput.email ?? null,
    name: verifiedIdentity.name ?? identityInput.name ?? null,
    avatarUrl: verifiedIdentity.avatarUrl ?? identityInput.avatarUrl ?? null,
    identityToken: null,
  };

  const tokenCodec = buildTokenCodec(authOptions);
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const sessionId = createUuid();
    let userId = identity.providerUserId;
    let userProfile: Awaited<ReturnType<typeof upsertAuthUser>> | null = null;
    let issuedTokens: ReturnType<typeof issueAuthTokenPair> | null = null;

    await adapter.transaction(async (tx) => {
      userProfile = await upsertAuthUser(tx, identity);
      userId = userProfile.id;

      issuedTokens = issueAuthTokenPair(
        {
          userId,
          sessionId,
          accessTokenTtlSeconds: authOptions.accessTokenTtlSeconds,
          refreshTokenTtlSeconds: authOptions.refreshTokenTtlSeconds,
        },
        tokenCodec
      );

      await createAuthSession(tx, {
        sessionId,
        userId,
        refreshTokenHash: hashAuthToken(issuedTokens.refreshToken),
        refreshExpiresAt: issuedTokens.refreshTokenExpiresAt,
      });
    });

    if (!userProfile || !issuedTokens) {
      throw new Error(`Failed to create auth session for ${identity.providerUserId}.`);
    }

    writeJson(response, 200, {
      user: userProfile,
      session: toSessionEnvelope(userId, sessionId, issuedTokens),
    });
  } finally {
    await adapter.close();
  }
};

const handleAuthSessionRefresh = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  authOptions: BackendAuthOptions
): Promise<void> => {
  const payload = await readJsonBody<RefreshAuthSessionRequest>(request);
  const input = parseRefreshAuthSessionRequest(payload);
  const tokenCodec = buildTokenCodec(authOptions);

  let refreshTokenPayload: AuthTokenPayload;

  try {
    refreshTokenPayload = verifyAuthToken(input.refreshToken, tokenCodec, { expectedType: 'refresh' });
  } catch (error) {
    throw unauthorized(`Invalid refresh token: ${(error as Error).message}`);
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const session = await getAuthSessionById(adapter, refreshTokenPayload.sessionId);

    if (!session) {
      throw unauthorized('Auth session not found.');
    }

    if (session.userId !== refreshTokenPayload.userId) {
      throw unauthorized('Auth session user mismatch.');
    }

    if (!isAuthSessionActive(session)) {
      throw unauthorized('Auth session has expired or is revoked.');
    }

    const previousRefreshTokenHash = hashAuthToken(input.refreshToken);

    if (session.refreshTokenHash !== previousRefreshTokenHash) {
      throw unauthorized('Refresh token has been rotated or revoked.');
    }

    const issuedTokens = issueAuthTokenPair(
      {
        userId: session.userId,
        sessionId: session.sessionId,
        accessTokenTtlSeconds: authOptions.accessTokenTtlSeconds,
        refreshTokenTtlSeconds: authOptions.refreshTokenTtlSeconds,
      },
      tokenCodec
    );

    const rotated = await rotateAuthSession(adapter, {
      sessionId: session.sessionId,
      previousRefreshTokenHash,
      refreshTokenHash: hashAuthToken(issuedTokens.refreshToken),
      refreshExpiresAt: issuedTokens.refreshTokenExpiresAt,
    });

    if (!rotated) {
      throw unauthorized('Refresh token has been rotated or revoked.');
    }

    writeJson(response, 200, {
      session: toSessionEnvelope(session.userId, session.sessionId, issuedTokens),
    });
  } finally {
    await adapter.close();
  }
};

const handleAuthSessionRevoke = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  authOptions: BackendAuthOptions
): Promise<void> => {
  const payload = await readJsonBody<RevokeAuthSessionRequest>(request);
  const input = parseRevokeAuthSessionRequest(payload);
  const tokenCodec = buildTokenCodec(authOptions);

  let tokenPayload: AuthTokenPayload | null = null;

  if (input.refreshToken) {
    try {
      tokenPayload = verifyAuthToken(input.refreshToken, tokenCodec, {
        expectedType: 'refresh',
        allowExpired: true,
      });
    } catch (error) {
      throw unauthorized(`Invalid refresh token: ${(error as Error).message}`);
    }
  } else {
    const bearerToken = extractBearerToken(request);

    if (!bearerToken) {
      throw badRequest('Revoke request requires refreshToken or Authorization header.');
    }

    try {
      tokenPayload = verifyAuthToken(bearerToken, tokenCodec, {
        expectedType: 'access',
        allowExpired: true,
      });
    } catch (error) {
      throw unauthorized(`Invalid access token: ${(error as Error).message}`);
    }
  }

  if (!tokenPayload) {
    throw badRequest('Unable to resolve revoke token payload.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const session = await getAuthSessionById(adapter, tokenPayload.sessionId);

    if (!session) {
      writeJson(response, 200, { revoked: false });
      return;
    }

    if (session.userId !== tokenPayload.userId) {
      throw unauthorized('Auth session user mismatch.');
    }

    await revokeAuthSession(adapter, tokenPayload.sessionId);
    writeJson(response, 200, { revoked: true });
  } finally {
    await adapter.close();
  }
};

const extractPreferenceUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/preferences$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];

  if (!encodedUserId) {
    return null;
  }

  return decodeURIComponent(encodedUserId);
};

const handlePreferenceGet = async (response: ServerResponse, userId: string, databasePath: string): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const preferences = await getOrCreatePreferences(adapter, userId);
    writeJson(response, 200, { preferences });
  } finally {
    await adapter.close();
  }
};

const handlePreferencePut = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<{ patch?: unknown; updatedAt?: unknown; operationId?: unknown }>(request);
  const patch = parsePreferencePatch(payload.patch ?? payload);

  if (Object.keys(patch).length === 0) {
    throw new Error('Preference patch cannot be empty.');
  }

  if (payload.updatedAt !== undefined && typeof payload.updatedAt !== 'string') {
    throw new Error('updatedAt must be a string when provided.');
  }

  if (payload.operationId !== undefined && payload.operationId !== null && typeof payload.operationId !== 'string') {
    throw new Error('operationId must be a string or null when provided.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const preferences = await setPreferences(adapter, {
      userId,
      patch,
      updatedAt: payload.updatedAt,
      operationId: (payload.operationId as string | null | undefined) ?? null,
      recordOutbox: false,
    });

    writeJson(response, 200, { preferences });
  } finally {
    await adapter.close();
  }
};

const handleSyncPush = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  authenticatedUserId: string
): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (payload.userId !== undefined && payload.userId !== authenticatedUserId) {
    throw forbidden('Push payload userId does not match authenticated user.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parsePreferenceSyncOperation(operation));

  for (const operation of operations) {
    if (operation.userId !== authenticatedUserId) {
      throw forbidden('All operation userId values must match authenticated user.');
    }
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const appliedOperationIds: string[] = [];
    let latestOperationId: string | null = null;
    let latestUpdatedAt: string | null = null;

    for (const operation of operations) {
      const result = await applyPreferenceSyncOperation(adapter, operation);

      if (result.applied) {
        appliedOperationIds.push(operation.operationId);
      }

      if (
        latestUpdatedAt === null
        || operation.updatedAt > latestUpdatedAt
        || (operation.updatedAt === latestUpdatedAt && (latestOperationId === null || operation.operationId > latestOperationId))
      ) {
        latestUpdatedAt = operation.updatedAt;
        latestOperationId = operation.operationId;
      }
    }

    writeJson(response, 200, {
      appliedOperationIds,
      latestOperationId,
      serverTimestamp: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const handleSyncPull = async (
  url: URL,
  response: ServerResponse,
  databasePath: string,
  authenticatedUserId: string
): Promise<void> => {
  const requestedUserId = url.searchParams.get('userId');

  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    throw forbidden('Pull query userId does not match authenticated user.');
  }

  const userId = authenticatedUserId;

  const cursor = url.searchParams.get('cursor');
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const preferences = await getOrCreatePreferences(adapter, userId);
    const syncState = await getPreferenceSyncState(adapter, userId);

    const shouldReturnPreference = cursor === null || preferences.updatedAt > cursor;

    writeJson(response, 200, {
      preference: shouldReturnPreference ? preferences : null,
      cursor: shouldReturnPreference ? preferences.updatedAt : cursor,
      lastSyncedOperationId: syncState?.lastSyncedOperationId ?? null,
    });
  } finally {
    await adapter.close();
  }
};

interface PlaceSyncSnapshotRow {
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
  updated_at: string;
  deleted_at: string | null;
}

const handlePlaceSyncPush = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  authenticatedUserId: string
): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (payload.userId !== undefined && payload.userId !== authenticatedUserId) {
    throw forbidden('Push payload userId does not match authenticated user.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parsePlaceSyncOperation(operation, authenticatedUserId));
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const appliedOperationIds: string[] = [];
    let latestVersion: { updatedAt: string; operationId: string } | null = null;

    for (const operation of operations) {
      const result = await applyPlaceSyncOperation(adapter, operation);

      if (result.applied) {
        appliedOperationIds.push(operation.operationId);
      }

      if (
        latestVersion === null
        || compareOperationVersion(
          {
            updatedAt: operation.updatedAt,
            operationId: operation.operationId,
          },
          latestVersion
        ) > 0
      ) {
        latestVersion = {
          updatedAt: operation.updatedAt,
          operationId: operation.operationId,
        };
      }
    }

    writeJson(response, 200, {
      appliedOperationIds,
      latestOperationId: latestVersion?.operationId ?? null,
      serverTimestamp: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const handlePlaceSyncPull = async (
  url: URL,
  response: ServerResponse,
  databasePath: string,
  authenticatedUserId: string
): Promise<void> => {
  const requestedUserId = url.searchParams.get('userId');

  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    throw forbidden('Pull query userId does not match authenticated user.');
  }

  const userId = authenticatedUserId;

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const rows = await adapter.all<PlaceSyncSnapshotRow>(
      `SELECT
         id,
         user_id,
         google_place_id,
         name,
         address,
         latitude,
         longitude,
         rating,
         notes,
         image_url,
         metadata_json,
         updated_at,
         deleted_at
       FROM places
       WHERE user_id = ?
       ORDER BY updated_at ASC, id ASC;`,
      [userId]
    );

    const entities = rows.map((row) => {
      const operationType = row.deleted_at ? 'delete' : 'upsert';

      return {
        entityId: row.id,
        updatedAt: row.updated_at,
        operationId: `${row.updated_at}:${row.id}`,
        data: {
          userId: row.user_id,
          placeId: row.id,
          operationType,
          updatedAt: row.updated_at,
          place: operationType === 'upsert'
            ? {
              name: row.name,
              address: row.address,
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              googlePlaceId: row.google_place_id,
              rating: row.rating === null ? null : Number(row.rating),
              notes: row.notes,
              imageUrl: row.image_url,
              metadataJson: row.metadata_json,
            }
            : null,
        },
      };
    });

    writeJson(response, 200, {
      entities,
      cursor: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

interface CollectionSyncSnapshotRow {
  id: string;
  user_id: string;
  name: string;
  cover_image: string | null;
  updated_at: string;
  deleted_at: string | null;
}

interface CollectionSyncPlaceRow {
  place_id: string;
}

const handleCollectionSyncPush = async (
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  authenticatedUserId: string
): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (payload.userId !== undefined && payload.userId !== authenticatedUserId) {
    throw forbidden('Push payload userId does not match authenticated user.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parseCollectionSyncOperation(operation, authenticatedUserId));
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const appliedOperationIds: string[] = [];
    let latestVersion: { updatedAt: string; operationId: string } | null = null;

    for (const operation of operations) {
      const result = await applyCollectionSyncOperation(adapter, operation);

      if (result.applied) {
        appliedOperationIds.push(operation.operationId);
      }

      if (
        latestVersion === null
        || compareOperationVersion(
          {
            updatedAt: operation.updatedAt,
            operationId: operation.operationId,
          },
          latestVersion
        ) > 0
      ) {
        latestVersion = {
          updatedAt: operation.updatedAt,
          operationId: operation.operationId,
        };
      }
    }

    writeJson(response, 200, {
      appliedOperationIds,
      latestOperationId: latestVersion?.operationId ?? null,
      serverTimestamp: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const handleCollectionSyncPull = async (
  url: URL,
  response: ServerResponse,
  databasePath: string,
  authenticatedUserId: string
): Promise<void> => {
  const requestedUserId = url.searchParams.get('userId');

  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    throw forbidden('Pull query userId does not match authenticated user.');
  }

  const userId = authenticatedUserId;

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const rows = await adapter.all<CollectionSyncSnapshotRow>(
      `SELECT id, user_id, name, cover_image, updated_at, deleted_at
       FROM collections
       WHERE user_id = ?
       ORDER BY updated_at ASC, id ASC;`,
      [userId]
    );

    const entities: Array<{
      entityId: string;
      updatedAt: string;
      operationId: string;
      data: {
        userId: string;
        collectionId: string;
        operationType: CollectionSyncOperationType;
        updatedAt: string;
        collection: CollectionInput | null;
        placeId: string | null;
        placeIds?: string[];
      };
    }> = [];

    for (const row of rows) {
      if (row.deleted_at) {
        entities.push({
          entityId: row.id,
          updatedAt: row.updated_at,
          operationId: `${row.updated_at}:${row.id}`,
          data: {
            userId: row.user_id,
            collectionId: row.id,
            operationType: 'delete',
            updatedAt: row.updated_at,
            collection: null,
            placeId: null,
          },
        });

        continue;
      }

      const placeRows = await adapter.all<CollectionSyncPlaceRow>(
        `SELECT cp.place_id
         FROM collection_places cp
         INNER JOIN places p ON p.id = cp.place_id
         WHERE cp.collection_id = ?
           AND cp.deleted_at IS NULL
           AND p.user_id = ?
           AND p.deleted_at IS NULL
         ORDER BY cp.position ASC;`,
        [row.id, row.user_id]
      );

      entities.push({
        entityId: row.id,
        updatedAt: row.updated_at,
        operationId: `${row.updated_at}:${row.id}`,
        data: {
          userId: row.user_id,
          collectionId: row.id,
          operationType: 'upsert',
          updatedAt: row.updated_at,
          collection: {
            name: row.name,
            coverImage: row.cover_image,
          },
          placeId: null,
          placeIds: placeRows.map((placeRow) => placeRow.place_id),
        },
      });
    }

    writeJson(response, 200, {
      entities,
      cursor: nowIso(),
    });
  } finally {
    await adapter.close();
  }
};

const extractPlaceListUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/places$/);

  if (!match) {
    return null;
  }

  const encoded = match[1];

  if (!encoded) {
    return null;
  }

  return decodeURIComponent(encoded);
};

const extractPlaceIds = (pathname: string): { userId: string; placeId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/places\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedPlaceId = match[2];

  if (!encodedUserId || !encodedPlaceId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    placeId: decodeURIComponent(encodedPlaceId),
  };
};

const extractUpsertGoogleUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/places\/upsert-google$/);

  if (!match) {
    return null;
  }

  const encoded = match[1];

  if (!encoded) {
    return null;
  }

  return decodeURIComponent(encoded);
};

const handlePlaceList = async (
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const places = await listPlaces(adapter, userId);
    writeJson(response, 200, { places });
  } finally {
    await adapter.close();
  }
};

const handlePlaceGet = async (
  response: ServerResponse,
  userId: string,
  placeId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const place = await getPlace(adapter, userId, placeId);

    if (!place) {
      writeJson(response, 404, { error: 'Place not found.' });
      return;
    }

    writeJson(response, 200, { place });
  } finally {
    await adapter.close();
  }
};

const handlePlaceUpsertGoogle = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<Record<string, unknown>>(request);
  const input = parsePlaceInput(payload);

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const place = await upsertPlace(adapter, { userId, input });
    writeJson(response, 200, { place });
  } finally {
    await adapter.close();
  }
};

const handlePlaceDelete = async (
  response: ServerResponse,
  userId: string,
  placeId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const removed = await removePlace(adapter, userId, placeId);

    if (!removed) {
      writeJson(response, 404, { error: 'Place not found.' });
      return;
    }

    writeJson(response, 200, { removed: true });
  } finally {
    await adapter.close();
  }
};

// --- Collection URL extractors ---

const extractCollectionListUserId = (pathname: string): string | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections$/);

  if (!match) {
    return null;
  }

  const encoded = match[1];

  if (!encoded) {
    return null;
  }

  return decodeURIComponent(encoded);
};

const extractCollectionIds = (pathname: string): { userId: string; collectionId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedCollectionId = match[2];

  if (!encodedUserId || !encodedCollectionId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    collectionId: decodeURIComponent(encodedCollectionId),
  };
};

const extractCollectionPlacesPath = (pathname: string): { userId: string; collectionId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections\/([^/]+)\/places$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedCollectionId = match[2];

  if (!encodedUserId || !encodedCollectionId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    collectionId: decodeURIComponent(encodedCollectionId),
  };
};

const extractCollectionPlaceIds = (pathname: string): { userId: string; collectionId: string; placeId: string } | null => {
  const match = pathname.match(/^\/users\/([^/]+)\/collections\/([^/]+)\/places\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const encodedCollectionId = match[2];
  const encodedPlaceId = match[3];

  if (!encodedUserId || !encodedCollectionId || !encodedPlaceId) {
    return null;
  }

  return {
    userId: decodeURIComponent(encodedUserId),
    collectionId: decodeURIComponent(encodedCollectionId),
    placeId: decodeURIComponent(encodedPlaceId),
  };
};

// --- Collection handlers ---

const handleCollectionCreate = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<Record<string, unknown>>(request);
  const input = parseCollectionInput(payload);

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collection = await createCollection(adapter, { userId, input });
    writeJson(response, 201, { collection });
  } finally {
    await adapter.close();
  }
};

const handleCollectionList = async (
  response: ServerResponse,
  userId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collections = await listCollections(adapter, userId);
    writeJson(response, 200, { collections });
  } finally {
    await adapter.close();
  }
};

const handleCollectionGet = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collection = await getCollection(adapter, userId, collectionId);

    if (!collection) {
      writeJson(response, 404, { error: 'Collection not found.' });
      return;
    }

    writeJson(response, 200, { collection });
  } finally {
    await adapter.close();
  }
};

const handleCollectionUpdate = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<Record<string, unknown>>(request);
  const input = parseCollectionInput(payload);

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const collection = await updateCollection(adapter, { userId, collectionId, input });
    writeJson(response, 200, { collection });
  } finally {
    await adapter.close();
  }
};

const handleCollectionDelete = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const removed = await removeCollection(adapter, userId, collectionId);

    if (!removed) {
      writeJson(response, 404, { error: 'Collection not found.' });
      return;
    }

    writeJson(response, 200, { removed: true });
  } finally {
    await adapter.close();
  }
};

const handleCollectionAddPlace = async (
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const payload = await readJsonBody<{ placeId?: unknown }>(request);

  if (typeof payload.placeId !== 'string') {
    throw new Error('Request body must include placeId as a string.');
  }

  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const added = await addPlaceToCollection(adapter, { userId, collectionId, placeId: payload.placeId });
    writeJson(response, 200, { added, collectionId, placeId: payload.placeId });
  } finally {
    await adapter.close();
  }
};

const handleCollectionRemovePlace = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  placeId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const removed = await removePlaceFromCollection(adapter, { userId, collectionId, placeId });

    if (!removed) {
      writeJson(response, 404, { error: 'Membership not found.' });
      return;
    }

    writeJson(response, 200, { removed: true });
  } finally {
    await adapter.close();
  }
};

const handleCollectionListPlaces = async (
  response: ServerResponse,
  userId: string,
  collectionId: string,
  databasePath: string
): Promise<void> => {
  const adapter = createNodeSqliteAdapter({ filename: databasePath });

  try {
    const places = await listCollectionPlaces(adapter, { userId, collectionId });
    writeJson(response, 200, { places });
  } finally {
    await adapter.close();
  }
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: BackendServerOptions,
  authOptions: BackendAuthOptions
): Promise<void> => {
  if (!request.url) {
    writeJson(response, 400, { error: 'Missing request URL.' });
    return;
  }

  const url = new URL(request.url, `http://${options.host}:${options.port}`);
  const tokenCodec = buildTokenCodec(authOptions);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, {
        status: 'ok',
        service: 'bookmarks-backend',
        databasePath: options.databasePath,
        timestamp: nowIso(),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/schema/tables') {
      const adapter = createNodeSqliteAdapter({ filename: options.databasePath });

      try {
        await migrateDatabase(adapter, schemaMigrations);
        const tables = await listUserTables(adapter);
        writeJson(response, 200, { tables });
      } finally {
        await adapter.close();
      }

      return;
    }

    if (request.method === 'POST' && url.pathname === '/auth/session') {
      await handleAuthSessionCreate(request, response, options.databasePath, authOptions);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/auth/refresh') {
      await handleAuthSessionRefresh(request, response, options.databasePath, authOptions);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/auth/revoke') {
      await handleAuthSessionRevoke(request, response, options.databasePath, authOptions);
      return;
    }

    const authContext = await requireAuthenticatedRequestContext(request, options.databasePath, tokenCodec);

    const preferenceUserId = extractPreferenceUserId(url.pathname);

    if (preferenceUserId && request.method === 'GET') {
      ensureRouteUserMatchesAuthenticatedUser(preferenceUserId, authContext.userId);
      await handlePreferenceGet(response, authContext.userId, options.databasePath);
      return;
    }

    if (preferenceUserId && request.method === 'PUT') {
      ensureRouteUserMatchesAuthenticatedUser(preferenceUserId, authContext.userId);
      await handlePreferencePut(request, response, authContext.userId, options.databasePath);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/preferences/push') {
      await handleSyncPush(request, response, options.databasePath, authContext.userId);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/preferences/pull') {
      await handleSyncPull(url, response, options.databasePath, authContext.userId);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/places/push') {
      await handlePlaceSyncPush(request, response, options.databasePath, authContext.userId);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/places/pull') {
      await handlePlaceSyncPull(url, response, options.databasePath, authContext.userId);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/collections/push') {
      await handleCollectionSyncPush(request, response, options.databasePath, authContext.userId);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/collections/pull') {
      await handleCollectionSyncPull(url, response, options.databasePath, authContext.userId);
      return;
    }

    // --- Place routes ---

    const upsertGoogleUserId = extractUpsertGoogleUserId(url.pathname);

    if (upsertGoogleUserId && request.method === 'PUT') {
      ensureRouteUserMatchesAuthenticatedUser(upsertGoogleUserId, authContext.userId);
      await handlePlaceUpsertGoogle(request, response, authContext.userId, options.databasePath);
      return;
    }

    const placeIds = extractPlaceIds(url.pathname);

    if (placeIds && request.method === 'GET') {
      ensureRouteUserMatchesAuthenticatedUser(placeIds.userId, authContext.userId);
      await handlePlaceGet(response, authContext.userId, placeIds.placeId, options.databasePath);
      return;
    }

    if (placeIds && request.method === 'DELETE') {
      ensureRouteUserMatchesAuthenticatedUser(placeIds.userId, authContext.userId);
      await handlePlaceDelete(response, authContext.userId, placeIds.placeId, options.databasePath);
      return;
    }

    const placeListUserId = extractPlaceListUserId(url.pathname);

    if (placeListUserId && request.method === 'GET') {
      ensureRouteUserMatchesAuthenticatedUser(placeListUserId, authContext.userId);
      await handlePlaceList(response, authContext.userId, options.databasePath);
      return;
    }

    // --- Collection routes ---
    // Order: most specific paths first (collection-place-ids, collection-places, collection-ids, collection-list)

    const collectionPlaceIds = extractCollectionPlaceIds(url.pathname);

    if (collectionPlaceIds && request.method === 'DELETE') {
      ensureRouteUserMatchesAuthenticatedUser(collectionPlaceIds.userId, authContext.userId);
      await handleCollectionRemovePlace(
        response,
        authContext.userId,
        collectionPlaceIds.collectionId,
        collectionPlaceIds.placeId,
        options.databasePath
      );
      return;
    }

    const collectionPlacesPath = extractCollectionPlacesPath(url.pathname);

    if (collectionPlacesPath && request.method === 'POST') {
      ensureRouteUserMatchesAuthenticatedUser(collectionPlacesPath.userId, authContext.userId);
      await handleCollectionAddPlace(request, response, authContext.userId, collectionPlacesPath.collectionId, options.databasePath);
      return;
    }

    if (collectionPlacesPath && request.method === 'GET') {
      ensureRouteUserMatchesAuthenticatedUser(collectionPlacesPath.userId, authContext.userId);
      await handleCollectionListPlaces(response, authContext.userId, collectionPlacesPath.collectionId, options.databasePath);
      return;
    }

    const collectionIds = extractCollectionIds(url.pathname);

    if (collectionIds && request.method === 'GET') {
      ensureRouteUserMatchesAuthenticatedUser(collectionIds.userId, authContext.userId);
      await handleCollectionGet(response, authContext.userId, collectionIds.collectionId, options.databasePath);
      return;
    }

    if (collectionIds && request.method === 'PUT') {
      ensureRouteUserMatchesAuthenticatedUser(collectionIds.userId, authContext.userId);
      await handleCollectionUpdate(request, response, authContext.userId, collectionIds.collectionId, options.databasePath);
      return;
    }

    if (collectionIds && request.method === 'DELETE') {
      ensureRouteUserMatchesAuthenticatedUser(collectionIds.userId, authContext.userId);
      await handleCollectionDelete(response, authContext.userId, collectionIds.collectionId, options.databasePath);
      return;
    }

    const collectionListUserId = extractCollectionListUserId(url.pathname);

    if (collectionListUserId && request.method === 'POST') {
      ensureRouteUserMatchesAuthenticatedUser(collectionListUserId, authContext.userId);
      await handleCollectionCreate(request, response, authContext.userId, options.databasePath);
      return;
    }

    if (collectionListUserId && request.method === 'GET') {
      ensureRouteUserMatchesAuthenticatedUser(collectionListUserId, authContext.userId);
      await handleCollectionList(response, authContext.userId, options.databasePath);
      return;
    }

    writeJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof HttpError) {
      writeJson(response, error.statusCode, { error: error.message });
      return;
    }

    writeJson(response, 400, { error: (error as Error).message });
  }
};

const parsePositiveInteger = (value: unknown, fallback: number, fieldName: string): number => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
};

const resolveTokenSecret = (input: Partial<BackendAuthOptions> | undefined): string => {
  const configuredSecret = input?.tokenSecret ?? process.env.BOOKMARKS_AUTH_TOKEN_SECRET;

  if (configuredSecret && configuredSecret.trim().length > 0) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('BOOKMARKS_AUTH_TOKEN_SECRET must be configured in production.');
  }

  if (process.env.NODE_ENV !== 'test') {
    console.warn('BOOKMARKS_AUTH_TOKEN_SECRET is not set; generated an ephemeral auth token secret for this backend process.');
  }

  return randomBytes(32).toString('hex');
};

const resolveBackendAuthOptions = (input: Partial<BackendAuthOptions> | undefined): BackendAuthOptions => {
  return {
    tokenSecret: resolveTokenSecret(input),
    tokenIssuer: input?.tokenIssuer
      ?? process.env.BOOKMARKS_AUTH_TOKEN_ISSUER
      ?? DEFAULT_AUTH_TOKEN_ISSUER,
    tokenAudience: input?.tokenAudience
      ?? process.env.BOOKMARKS_AUTH_TOKEN_AUDIENCE
      ?? DEFAULT_AUTH_TOKEN_AUDIENCE,
    accessTokenTtlSeconds: parsePositiveInteger(
      input?.accessTokenTtlSeconds ?? process.env.BOOKMARKS_AUTH_ACCESS_TTL_SECONDS,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      'accessTokenTtlSeconds'
    ),
    refreshTokenTtlSeconds: parsePositiveInteger(
      input?.refreshTokenTtlSeconds ?? process.env.BOOKMARKS_AUTH_REFRESH_TTL_SECONDS,
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
      'refreshTokenTtlSeconds'
    ),
  };
};

/**
 * Create backend server instance.
 * @param options
 * @returns {BackendServer}
 */
export const createBackendServer = async (options: BackendServerOptions): Promise<BackendServer> => {
  mkdirSync(dirname(options.databasePath), { recursive: true });
  const authOptions = resolveBackendAuthOptions(options.auth);

  const migrationAdapter = createNodeSqliteAdapter({ filename: options.databasePath });

  try {
    await migrateDatabase(migrationAdapter, schemaMigrations);
  } finally {
    await migrationAdapter.close();
  }

  const server = createServer((request, response) => {
    handleRequest(request, response, options, authOptions).catch((error) => {
      console.error('Unhandled backend request error:', error);
      writeJson(response, 500, { error: 'Internal server error.' });
    });
  });

  return {
    /**
     * Start listening. Returns the actual bound port, which may differ
     * from options.port when port 0 is used (OS-assigned ephemeral port).
     */
    async start(): Promise<{ port: number }> {
      return new Promise((resolvePromise, rejectPromise) => {
        const onError = (error: Error) => {
          rejectPromise(error);
        };

        server.once('error', onError);

        server.listen(options.port, options.host, () => {
          server.removeListener('error', onError);
          const address = server.address();
          const boundPort = (address && typeof address === 'object') ? address.port : options.port;
          resolvePromise({ port: boundPort });
        });
      });
    },
    async stop() {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }

          resolvePromise();
        });
      });
    },
  };
};

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export const defaultBackendDatabasePath = resolve(currentDirectory, '..', '..', '..', '.bookmarks', 'backend.sqlite');
