/**
 * Minimal backend bootstrap.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createNodeSqliteAdapter, listUserTables, migrateDatabase } from '../../../db/src';
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

  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, {
      status: 'ok',
      service: 'bookmarks-backend',
      databasePath: options.databasePath,
      timestamp: new Date().toISOString(),
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

  writeJson(response, 404, { error: 'Not found.' });
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
