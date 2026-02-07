/**
 * Backend server for persistence foundation routes.
 */

import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../../../core/src';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
import {
  applyPreferenceSyncOperation,
  getOrCreatePreferences,
  getPreferenceSyncState,
  setPreferences,
  type HexagonPreferencesPatch,
  type PreferenceSyncOperation,
} from '../../../preferences/src';
import { schemaMigrations } from '../../../schema/src';

export interface BackendServerOptions {
  host: string;
  port: number;
  databasePath: string;
}

export interface BackendServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

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

const parsePreferenceValues = (value: unknown): {
  hexagonTheme: string;
  hexagonVariant: string;
  hexagonSize: number;
  hexagonCustomDepth: number | null;
  hexagonUseCustomDepth: boolean;
} => {
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

const parseSyncOperation = (value: unknown): PreferenceSyncOperation => {
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

const handleSyncPush = async (request: IncomingMessage, response: ServerResponse, databasePath: string): Promise<void> => {
  const payload = await readJsonBody<{ userId?: unknown; operations?: unknown }>(request);

  if (typeof payload.userId !== 'string') {
    throw new Error('Push payload must include userId.');
  }

  if (!Array.isArray(payload.operations)) {
    throw new Error('Push payload must include operations array.');
  }

  const operations = payload.operations.map((operation) => parseSyncOperation(operation));

  for (const operation of operations) {
    if (operation.userId !== payload.userId) {
      throw new Error('All operation userId values must match payload userId.');
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

const handleSyncPull = async (url: URL, response: ServerResponse, databasePath: string): Promise<void> => {
  const userId = url.searchParams.get('userId');

  if (!userId) {
    throw new Error('Pull query requires userId.');
  }

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

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: BackendServerOptions
): Promise<void> => {
  if (!request.url) {
    writeJson(response, 400, { error: 'Missing request URL.' });
    return;
  }

  const url = new URL(request.url, `http://${options.host}:${options.port}`);

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

    const preferenceUserId = extractPreferenceUserId(url.pathname);

    if (preferenceUserId && request.method === 'GET') {
      await handlePreferenceGet(response, preferenceUserId, options.databasePath);
      return;
    }

    if (preferenceUserId && request.method === 'PUT') {
      await handlePreferencePut(request, response, preferenceUserId, options.databasePath);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync/preferences/push') {
      await handleSyncPush(request, response, options.databasePath);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/sync/preferences/pull') {
      await handleSyncPull(url, response, options.databasePath);
      return;
    }

    writeJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    writeJson(response, 400, { error: (error as Error).message });
  }
};

/**
 * Create backend server instance.
 * @param options
 * @returns {BackendServer}
 */
export const createBackendServer = async (options: BackendServerOptions): Promise<BackendServer> => {
  mkdirSync(dirname(options.databasePath), { recursive: true });

  const migrationAdapter = createNodeSqliteAdapter({ filename: options.databasePath });

  try {
    await migrateDatabase(migrationAdapter, schemaMigrations);
  } finally {
    await migrationAdapter.close();
  }

  const server = createServer((request, response) => {
    handleRequest(request, response, options).catch((error) => {
      console.error('Unhandled backend request error:', error);
      writeJson(response, 500, { error: 'Internal server error.' });
    });
  });

  return {
    async start() {
      await new Promise<void>((resolvePromise) => {
        server.listen(options.port, options.host, () => {
          resolvePromise();
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
