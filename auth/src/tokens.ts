/**
 * Token signing and verification helpers.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthTokenPayload, AuthTokenType } from './contracts';

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

interface JwtPayload {
  sub: string;
  sid: string;
  jti: string;
  ttp: AuthTokenType;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
}

export interface AuthTokenCodecOptions {
  secret: string;
  issuer?: string;
  audience?: string;
}

export interface IssueAuthTokenOptions {
  tokenType: AuthTokenType;
  userId: string;
  sessionId: string;
  ttlSeconds: number;
  now?: Date;
}

export interface VerifyAuthTokenOptions {
  expectedType?: AuthTokenType;
  now?: Date;
  allowExpired?: boolean;
}

export interface IssuedAuthToken {
  token: string;
  payload: AuthTokenPayload;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenPayload: AuthTokenPayload;
  refreshTokenPayload: AuthTokenPayload;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface IssueAuthTokenPairOptions {
  userId: string;
  sessionId: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  now?: Date;
}

const toEpochSeconds = (value: Date): number => {
  return Math.floor(value.getTime() / 1000);
};

const fromEpochSeconds = (value: number): string => {
  return new Date(value * 1000).toISOString();
};

const encodeBase64Url = (value: string | Buffer): string => {
  return Buffer.from(value).toString('base64url');
};

const decodeBase64Url = (value: string): Buffer => {
  return Buffer.from(value, 'base64url');
};

const parseJson = <TValue>(raw: Buffer, context: string): TValue => {
  try {
    return JSON.parse(raw.toString('utf8')) as TValue;
  } catch (error) {
    throw new Error(`Invalid ${context} JSON: ${(error as Error).message}`);
  }
};

const parseToken = (token: string): { headerSegment: string; payloadSegment: string; signatureSegment: string } => {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Auth token must include header, payload, and signature segments.');
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;

  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw new Error('Auth token segments must be non-empty.');
  }

  return {
    headerSegment,
    payloadSegment,
    signatureSegment,
  };
};

const mapJwtPayload = (payload: JwtPayload): AuthTokenPayload => {
  return {
    tokenType: payload.ttp,
    userId: payload.sub,
    sessionId: payload.sid,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    issuer: payload.iss,
    audience: payload.aud,
  };
};

/**
 * SHA-256 hash for persisted refresh-token tracking.
 * @param token
 * @returns {string}
 */
export const hashAuthToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};

/**
 * Issue a signed auth token.
 * @param options
 * @param codec
 * @returns {IssuedAuthToken}
 */
export const issueAuthToken = (
  options: IssueAuthTokenOptions,
  codec: AuthTokenCodecOptions
): IssuedAuthToken => {
  const now = options.now ?? new Date();
  const issuedAt = toEpochSeconds(now);
  const expiresAt = issuedAt + options.ttlSeconds;

  const payload: JwtPayload = {
    sub: options.userId,
    sid: options.sessionId,
    jti: randomUUID(),
    ttp: options.tokenType,
    iat: issuedAt,
    exp: expiresAt,
  };

  if (codec.issuer) {
    payload.iss = codec.issuer;
  }

  if (codec.audience) {
    payload.aud = codec.audience;
  }

  const header: JwtHeader = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const headerSegment = encodeBase64Url(JSON.stringify(header));
  const payloadSegment = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = createHmac('sha256', codec.secret).update(signingInput).digest();

  return {
    token: `${signingInput}.${encodeBase64Url(signature)}`,
    payload: mapJwtPayload(payload),
  };
};

/**
 * Verify a signed auth token and return its payload.
 * @param token
 * @param codec
 * @param options
 * @returns {AuthTokenPayload}
 */
export const verifyAuthToken = (
  token: string,
  codec: AuthTokenCodecOptions,
  options: VerifyAuthTokenOptions = {}
): AuthTokenPayload => {
  const parsed = parseToken(token);
  const signingInput = `${parsed.headerSegment}.${parsed.payloadSegment}`;

  const expectedSignature = createHmac('sha256', codec.secret).update(signingInput).digest();
  const actualSignature = decodeBase64Url(parsed.signatureSegment);

  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new Error('Auth token signature is invalid.');
  }

  const header = parseJson<JwtHeader>(decodeBase64Url(parsed.headerSegment), 'token header');

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Unsupported auth token header.');
  }

  const payload = parseJson<JwtPayload>(decodeBase64Url(parsed.payloadSegment), 'token payload');

  if (
    typeof payload.sub !== 'string'
    || typeof payload.sid !== 'string'
    || typeof payload.jti !== 'string'
    || (payload.ttp !== 'access' && payload.ttp !== 'refresh')
    || typeof payload.iat !== 'number'
    || typeof payload.exp !== 'number'
  ) {
    throw new Error('Auth token payload is malformed.');
  }

  if (codec.issuer && payload.iss !== codec.issuer) {
    throw new Error('Auth token issuer does not match expected issuer.');
  }

  if (codec.audience && payload.aud !== codec.audience) {
    throw new Error('Auth token audience does not match expected audience.');
  }

  if (options.expectedType && payload.ttp !== options.expectedType) {
    throw new Error(`Auth token type must be ${options.expectedType}.`);
  }

  const nowSeconds = toEpochSeconds(options.now ?? new Date());

  if (!options.allowExpired && payload.exp <= nowSeconds) {
    throw new Error('Auth token has expired.');
  }

  return mapJwtPayload(payload);
};

/**
 * Issue access + refresh tokens for one session.
 * @param options
 * @param codec
 * @returns {AuthTokenPair}
 */
export const issueAuthTokenPair = (
  options: IssueAuthTokenPairOptions,
  codec: AuthTokenCodecOptions
): AuthTokenPair => {
  const now = options.now ?? new Date();

  const issuedAccess = issueAuthToken(
    {
      tokenType: 'access',
      userId: options.userId,
      sessionId: options.sessionId,
      ttlSeconds: options.accessTokenTtlSeconds,
      now,
    },
    codec
  );

  const issuedRefresh = issueAuthToken(
    {
      tokenType: 'refresh',
      userId: options.userId,
      sessionId: options.sessionId,
      ttlSeconds: options.refreshTokenTtlSeconds,
      now,
    },
    codec
  );

  return {
    accessToken: issuedAccess.token,
    refreshToken: issuedRefresh.token,
    accessTokenPayload: issuedAccess.payload,
    refreshTokenPayload: issuedRefresh.payload,
    accessTokenExpiresAt: fromEpochSeconds(issuedAccess.payload.expiresAt),
    refreshTokenExpiresAt: fromEpochSeconds(issuedRefresh.payload.expiresAt),
  };
};
