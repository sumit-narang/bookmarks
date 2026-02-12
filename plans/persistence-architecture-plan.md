# Persistence Architecture Plan

## Status
- **Date:** 2026-02-12
- **State:** Core persistence implemented; mobile cutover pending

---

## 1) Goals

Build a modular, offline-first persistence system with:
- shared schema across frontend and backend
- strong integration test coverage
- a CLI that uses the exact same core code paths as the app
- clean feature packaging and platform separation

---

## 2) Locked decisions

1. Persistence is **user-scoped**.
2. Persistence is **OAuth-related only**.
3. Place identity = **internal UUID**; Google Place ID is an external reference.
4. `saved` and `placeCount` are **derived**, not stored.
5. Empty collections are **not auto-deleted**.
6. If place has zero collection memberships, it is considered **unsaved** (derived).
7. Keep current share payload URL model for now.
8. Architecture is **offline-first**.
9. Persist Hexagon customizer preferences.
10. Mock seed data only in dev contexts.
11. Conflict resolution = **Last-write-wins**.
12. Avoid mock remote APIs for core testing.
13. New work should be in **TypeScript**.
14. Local data is **wiped on sign out**.
15. No backward compatibility required (app is still in dev).

---

## 3) Repository structure

```txt
/apps
  /mobile
  /backend
  /cli

/core
/schema
/db
/http
/auth
/preferences
/places
/collections
/share
/sync
/tests
```

### Rationale
- `apps/*` contains platform/runtime-specific code.
- Root modules contain shared business logic and adapters.
- No `packages/` directory.
- No `feature-` or `platform-` prefixes.

---

## 4) Module responsibilities

## `/core`
- shared primitives
- IDs, result/error utilities, clocks, common types

## `/schema`
- SQL schema and migrations (single source of truth)
- shared DB typing contracts used by app/backend

## `/db`
- SQLite adapters:
  - Expo adapter for mobile runtime
  - Node adapter for CLI/tests/backend tooling
- transaction helpers

## `/http`
- shared HTTP transport utilities (URL normalization, response parsing, error handling)
- common `HttpClientOptions` type and `createSyncRemoteClient` factory
- auth header/token handling (planned)

## `/auth`
- auth persistence contracts
- local session lifecycle hooks (including wipe-on-signout)

## `/preferences`
- Hexagon customizer persistence use-cases

## `/places`
- place persistence/use-cases
- external Google place mapping (`google_place_id`)

## `/collections`
- collection + ordered collection-place membership use-cases

## `/share`
- encode/decode current share payload URL model

## `/sync`
- outbox/pull-push orchestration
- LWW reconciliation

## `/apps/mobile`
- Expo UI and navigation
- consumes shared modules only

## `/apps/backend`
- real CRUD + sync API implementation using same schema contracts

## `/apps/cli`
- command-line client using same use-cases as app

## `/tests`
- integration/e2e scenario test suites

---

## 5) Data model (v1)

Core tables:
- `users`
- `places`
  - `id` (UUID, internal PK)
  - `user_id`
  - `google_place_id` (nullable external ID, unique per user)
  - place details fields
  - timestamps (`created_at`, `updated_at`, optional `deleted_at`)
- `collections`
  - `id`, `user_id`, `name`, `cover_image`, timestamps
- `collection_places`
  - `collection_id`, `place_id`, `position`, timestamps
  - unique `(collection_id, place_id)`
- `preferences`
  - per-user settings (hexagon config)
- `outbox`
  - queued offline mutations for sync
- `sync_state`
  - cursors/version/checkpoints

### Derived rules
- place is saved iff membership exists in `collection_places`
- collection place count = `COUNT(collection_places)`

---

## 6) Offline-first + sync strategy

Write flow:
1. write to local SQLite in transaction
2. append outbox mutation event
3. return success immediately to UI

Sync flow:
1. push pending outbox events to backend
2. pull remote deltas
3. apply deltas in local transaction
4. update sync cursor/state

Conflict policy:
- **Last-write-wins** using `updated_at`
- deterministic tie-breaker (e.g., operation ID) when timestamps equal

---

## 7) Testing strategy (integration-first)

No mock remote API for core confidence.

### A) Local integration tests
- real SQLite schema/migrations
- repository/use-case behavior

### B) Backend integration tests
- real `/apps/backend` instance
- real DB + real HTTP contracts

### C) Sync integration tests
- local DB + real backend
- outbox retries, reconnection, LWW behavior

### D) CLI black-box tests
- scenario workflows through `/apps/cli`
- verify final DB + API state

### E) Auth isolation tests
- test user token A vs B data isolation

---

## 8) Delivery roadmap

## Foundation
Status: ✅ Done
- [x] workspace + TypeScript setup
- [x] move app into `/apps/mobile` (if not already)
- [x] establish `/apps/backend` and `/apps/cli`
- [x] create `/schema` and `/db` foundations

## Preferences (first end-to-end)
Status: ✅ Done
- [x] implement `/preferences` with local + remote + sync
- [x] wire Hexagon screen to new module
- [x] add CLI commands for preferences
- [x] integration tests pass

## Places
Status: ✅ Done
- [x] implement place upsert/fetch/delete (UUID + external Google ID)
- [x] ensure saved status is derived
- [x] integration tests + CLI

## Collections
Status: ✅ Done
- [x] collection CRUD + ordered membership
- [x] keep empty collections
- [x] derived place counts only
- [x] cascading soft-delete (collection delete cascades to memberships)
- [x] 6 sync operation types (create, update, delete, add-place, remove-place, upsert)
- [x] full membership reconciliation during pull
- [x] integration tests (18 persistence + 4 sync) + CLI + backend routes

## Sync hardening
Status: ✅ Done
- [x] shared entity-agnostic sync engine (push/pull/run)
- [x] full outbox flow, retries, checkpoints
- [x] dead-letter skip with starvation prevention
- [x] batch-limited push with cursor progression
- [x] LWW conflict tests (8 cases)
- [x] stress tests (120+ entities, 10-cycle convergence)
- [x] CLI sync commands (sync:push, sync:pull, sync:run for all entity types)

## Share
Status: ✅ Done
- [x] keep current payload URL model in `/share`
- [x] move encoding/decoding to shared module
- [x] mobile-format compatibility tests (10 cases)

## HTTP consolidation
Status: ✅ Done
- [x] extract shared transport utilities (trimTrailingSlash, readJsonResponse) into `/http`
- [x] refactor domain httpClient modules to use shared `/http` helpers

## Mobile cutover
Status: Not started
- [ ] replace legacy `data/storage.js` calls with new modules
- [ ] wire `expoSqliteAdapter` into mobile app
- [ ] remove startup data reset behavior
- [ ] signout triggers local wipe (extend `localPersistence.js` to delete SQLite file)

---

## 9) CLI scope

Implemented commands:
- `db:init`, `db:reset`, `db:inspect`
- `preferences:get`, `preferences:set`, `preferences:sync`
- `places:list`, `places:upsert-google`, `places:remove`
- `collections:create`, `collections:list`, `collections:get`, `collections:update`, `collections:remove`
- `collections:add-place`, `collections:remove-place`, `collections:list-places`
- `sync:push`, `sync:pull`, `sync:run` (all entity types)

CLI calls the same use-cases/repositories used by mobile.

---

## 10) Immediate next steps

- [x] Create workspace + TS baselines for `/apps/*` and root modules.
- [x] Define schema migration `v1` and DB adapters.
- [x] Implement preferences end-to-end with integration tests.
- [x] Proceed to Places and Collections work.
- [x] Consolidate HTTP transport utilities into `/http` module.
- [ ] Implement `/auth` module (auth persistence contracts, token handling, session lifecycle).
- [ ] Add auth middleware to backend (currently unauthenticated; userId is a path param).
- [ ] Mobile cutover: wire new persistence modules into the Expo app.

---

## 11) Non-goals for initial implementation

- backward compatibility with existing AsyncStorage data
- replacing current share URL format with DB links (deferred)
- introducing mocked remote services for core verification
