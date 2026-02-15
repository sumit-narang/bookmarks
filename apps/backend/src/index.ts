/**
 * Backend entrypoint.
 */

import { createBackendServer, defaultBackendDatabasePath } from './server';

const host = process.env.BOOKMARKS_BACKEND_HOST ?? '127.0.0.1';
const port = Number(process.env.BOOKMARKS_BACKEND_PORT ?? '8787');
const databasePath = process.env.BOOKMARKS_BACKEND_DB_PATH ?? defaultBackendDatabasePath;
const runtimeEnvironment = process.env.NODE_ENV ?? 'development';

if (runtimeEnvironment === 'development' && !process.env.BOOKMARKS_AUTH_ALLOW_INSECURE_TEST_TOKENS) {
  process.env.BOOKMARKS_AUTH_ALLOW_INSECURE_TEST_TOKENS = '1';
}

const run = async (): Promise<void> => {
  const server = await createBackendServer({ host, port, databasePath });
  await server.start();

  console.log(`Backend running on http://${host}:${port}`);
  console.log(`Using database: ${databasePath}`);

  if (runtimeEnvironment === 'development') {
    console.log('Development test auth enabled (provider=test).');
  }

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

run().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
