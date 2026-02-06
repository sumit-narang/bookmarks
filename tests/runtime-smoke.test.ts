/**
 * Runtime smoke tests for CLI and backend process checks.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const cliEntrypoint = resolve(repositoryRoot, 'apps', 'cli', 'src', 'index.ts');
const backendEntrypoint = resolve(repositoryRoot, 'apps', 'backend', 'src', 'index.ts');

const expectedTables = [
  'collection_places',
  'collections',
  'outbox',
  'places',
  'preferences',
  'schema_migrations',
  'sync_state',
  'users',
];

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmarks-runtime-'));

  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

interface CommandOutput {
  stdout: string;
  stderr: string;
}

const runNodeTsxCommand = async (
  entrypoint: string,
  args: readonly string[],
  environment: Record<string, string> = {}
): Promise<CommandOutput> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(
        new Error(
          `Command failed with code ${code}: ${entrypoint} ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
};

const parseSummaryJson = (stdout: string): Record<string, number> => {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON summary in output:\n${stdout}`);
  }

  return JSON.parse(stdout.slice(start, end + 1)) as Record<string, number>;
};

const getAvailablePort = async (): Promise<number> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close();
        rejectPromise(new Error('Failed to detect an ephemeral local port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(address.port);
      });
    });

    server.on('error', (error) => {
      rejectPromise(error);
    });
  });
};

const waitForBackendHealth = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient connection errors while process is still booting.
    }

    await delay(100);
  }

  throw new Error(`Backend was not healthy within ${timeoutMs}ms (${baseUrl}/health).`);
};

const stopProcess = async (processHandle: ReturnType<typeof spawn>): Promise<void> => {
  if (processHandle.exitCode !== null) {
    return;
  }

  processHandle.kill('SIGTERM');

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      if (processHandle.exitCode === null) {
        processHandle.kill('SIGKILL');
      }

      rejectPromise(new Error('Timed out while waiting for process shutdown.'));
    }, 5000);

    processHandle.once('close', () => {
      clearTimeout(timeout);
      resolvePromise();
    });

    processHandle.once('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
  });
};

test('CLI smoke: db:reset + db:inspect produce expected schema summary', async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'cli.sqlite');

    const resetOutput = await runNodeTsxCommand(cliEntrypoint, ['db:reset', '--db', databasePath]);

    assert.match(resetOutput.stdout, /Database reset complete\./);

    const inspectOutput = await runNodeTsxCommand(cliEntrypoint, ['db:inspect', '--db', databasePath]);
    const summary = parseSummaryJson(inspectOutput.stdout);

    for (const tableName of expectedTables) {
      const expectedCount = tableName === 'schema_migrations' ? 1 : 0;
      assert.equal(summary[tableName], expectedCount);
    }

    assert.equal(Object.keys(summary).length, expectedTables.length);
  });
});

test('Backend smoke: process boots and serves health + schema routes', { timeout: 20_000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const databasePath = join(directory, 'backend.sqlite');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const backendProcess = spawn(process.execPath, ['--import', 'tsx', backendEntrypoint], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BOOKMARKS_BACKEND_HOST: '127.0.0.1',
        BOOKMARKS_BACKEND_PORT: String(port),
        BOOKMARKS_BACKEND_DB_PATH: databasePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    backendProcess.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    backendProcess.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await waitForBackendHealth(baseUrl, 10_000);

      const healthResponse = await fetch(`${baseUrl}/health`);
      assert.equal(healthResponse.status, 200);

      const healthPayload = (await healthResponse.json()) as {
        status: string;
        service: string;
        databasePath: string;
      };

      assert.equal(healthPayload.status, 'ok');
      assert.equal(healthPayload.service, 'bookmarks-backend');
      assert.equal(healthPayload.databasePath, databasePath);

      const schemaResponse = await fetch(`${baseUrl}/schema/tables`);
      assert.equal(schemaResponse.status, 200);

      const schemaPayload = (await schemaResponse.json()) as { tables: string[] };
      assert.deepEqual(schemaPayload.tables, expectedTables);
    } catch (error) {
      throw new Error(
        `Backend smoke test failed: ${(error as Error).message}\nstdout:\n${stdout}\nstderr:\n${stderr}`
      );
    } finally {
      await stopProcess(backendProcess);
    }
  });
});
