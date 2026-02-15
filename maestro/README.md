# Mobile E2E (Maestro)

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

The runner retries once and stores artifacts in:

```bash
.bookmarks/e2e-artifacts/
```

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
