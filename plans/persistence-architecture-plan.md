# Persistence Architecture Plan

## Status
- **Date:** 2026-02-06
- **State:** Approved planning draft (no implementation yet)

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
- typed API client and transport utilities
- auth header/token handling

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

## 8) Delivery roadmap (vertical slices)

## Foundation
Status: ✅ Done
- [x] workspace + TypeScript setup
- [x] move app into `/apps/mobile` (if not already)
- [x] establish `/apps/backend` and `/apps/cli`
- [x] create `/schema` and `/db` foundations

## Slice 1: Preferences (first end-to-end)
Status: ✅ Done
- [x] implement `/preferences` with local + remote + sync
- [x] wire Hexagon screen to new module
- [x] add CLI commands for preferences
- [x] integration tests pass

## Slice 2: Places
- implement place upsert/fetch/delete (UUID + external Google ID)
- ensure saved status is derived
- integration tests + CLI

## Slice 3: Collections
- collection CRUD + ordered membership
- keep empty collections
- derived place counts only
- integration tests + CLI

## Slice 4: Sync hardening
- full outbox flow, retries, checkpoints
- LWW conflict tests

## Slice 5: Share
- keep current payload URL model in `/share`
- move encoding/decoding to shared module

## Slice 6: Mobile cutover
- replace legacy `data/storage.js` calls with new modules
- remove startup data reset behavior
- signout triggers local wipe

---

## 9) CLI scope

Planned commands:
- `db:init`, `db:reset`, `db:inspect`
- `preferences:get`, `preferences:set`
- `places:list`, `places:upsert-google`, `places:remove`
- `collections:create`, `collections:list`, `collections:add-place`, `collections:remove-place`
- `sync:push`, `sync:pull`, `sync:run`

CLI must call the same use-cases/repositories used by mobile.

---

## 10) Immediate next steps

- [x] Create workspace + TS baselines for `/apps/*` and root modules.
- [x] Define schema migration `v1` and DB adapters.
- [x] Implement preferences end-to-end with integration tests.
- [ ] Proceed to Places and Collections work.

---

## 11) Non-goals for initial implementation

- backward compatibility with existing AsyncStorage data
- replacing current share URL format with DB links (deferred)
- introducing mocked remote services for core verification
