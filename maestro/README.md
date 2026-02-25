# Mobile E2E (maestro-runner)

Android-first persistence coverage lives under `maestro/flows/android/p0`.

## Run locally

1. Start seeded backend:

```bash
npm run mobile:e2e:backend:start
```

2. Run P0 Android suite:

```bash
npm run mobile:e2e:android
```

The runner now uses `maestro-runner` with a reliability-first default parallelism strategy:

- target parallelism = number of flow files
- capped by available connected devices + startable AVDs
- capped again by `E2E_MAX_PARALLEL` (default `4` for local stability)
- starts additional Android emulators automatically when needed

Optional overrides:

```bash
E2E_MAX_PARALLEL=4 npm run mobile:e2e:android   # default reliability cap
E2E_PARALLEL=6 npm run mobile:e2e:android       # force exact worker count
E2E_WAIT_FOR_IDLE_TIMEOUT=100 npm run mobile:e2e:android
E2E_BOOT_TIMEOUT=300 npm run mobile:e2e:android
```

Artifacts (report JSON/HTML/JUnit, logs, diagnostics capture on failure) are written under:

```bash
.bookmarks/e2e-artifacts/
```

## CI sharding (GitHub Actions)

Android CI uses workflow-level sharding (4 parallel jobs), with one emulator per shard:

- shard 1: `auth-session-restart-sync.yaml`, `collection-membership-persistence-relaunch.yaml`
- shard 2: `local-place-persistence-relaunch.yaml`, `offline-write-online-sync-push.yaml`
- shard 3: `preferences-persistence-sync.yaml`, `remote-pull-convergence.yaml`
- shard 4: `saved-state-derived-removal-relaunch.yaml`, `signout-wipe-persistence.yaml`

Each shard writes artifacts under `.bookmarks/e2e-artifacts/shard-<n>/` and uploads them as shard-specific GitHub Actions artifacts.

## P0 scenarios

- `local-place-persistence-relaunch.yaml`
- `collection-membership-persistence-relaunch.yaml`
- `saved-state-derived-removal-relaunch.yaml`
- `signout-wipe-persistence.yaml`
- `auth-session-restart-sync.yaml`
- `offline-write-online-sync-push.yaml`
- `remote-pull-convergence.yaml`
- `preferences-persistence-sync.yaml`

All scenarios use the e2e-only Diagnostics screen for deterministic assertions.
