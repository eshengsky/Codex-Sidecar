# Sidecar Data Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the packaged app's main-process full-refresh pipeline with one isolated, restartable data engine that incrementally indexes Codex transcripts, owns Sidecar persistence and app-server access, and publishes revisioned projections to every renderer in one release.

**Architecture:** Electron's main process remains responsible for windows, native menus, updates and process supervision. A single `utilityProcess` owns `sidecar.sqlite`, the Codex app-server child, Hook ingestion, transcript checkpoints and the current Codex projection. Renderers receive one initial snapshot followed by monotonic revision updates; they never poll or scan transcript files.

**Tech Stack:** Electron 42 `utilityProcess`, CommonJS Node modules, `better-sqlite3`, JSONL streaming, Electron `MessageChannelMain`, Vue 3, Node's built-in test runner, pnpm.

## Global Constraints

- The production cutover ships in one version; no legacy and new data paths run side by side after release.
- Development may use isolated fixtures and comparison tests, but production contains no runtime feature flag or fallback to the legacy full-refresh path.
- Do not start the local development server and do not run compilation, ESLint, `vue-tsc` or `tsc`.
- Use `pnpm` for package management; add no dependency for this change.
- No production code is written before a failing behavior test has been observed.
- `better-sqlite3` is opened only inside the data-engine utility process after the cutover.
- Transcript processing reads bounded chunks and persists byte offsets; no production path may call `readFile()` on a transcript.
- Main-to-engine and engine-to-renderer messages must be projection data or bounded command responses, never complete transcript contents.
- Existing user data is migrated atomically and retained in a recovery backup; the app never silently continues with a partially migrated database.
- Do not stage, commit or push unless the user explicitly asks.

---

## File Structure

### New engine modules

- `electron/data-engine/protocol.cjs`
  - Validates request, response, event and projection envelopes.
  - Defines bounded public operation names; no arbitrary method execution.
- `electron/data-engine/transcript-indexer.cjs`
  - Streams appended JSONL bytes.
  - Tracks file identity, offset and an incomplete trailing line.
  - Emits token, context-usage, turn lifecycle and last-user-preview facts.
- `electron/data-engine/projection-store.cjs`
  - Owns engine schema v2, migration, Hook inbox, transcript checkpoints, daily usage, runtime signals, thread projections and revision log.
  - Wraps the existing Sidecar-owned tables through the current normalizers.
- `electron/data-engine/codex-rpc-client.cjs`
  - Owns the one `codex app-server --stdio` child.
  - Coalesces connection and identical in-flight reads.
- `electron/data-engine/codex-projection-service.cjs`
  - Converts app-server metadata, Hook/runtime facts, unread state and indexed transcript facts into a small `CodexStore`.
  - Publishes only when the committed projection changes.
- `electron/data-engine/service.cjs`
  - Utility-process entrypoint.
  - Owns startup migration, watchers, refresh scheduling, RPC dispatch and clean shutdown.
- `electron/data-engine/supervisor.cjs`
  - Main-process adapter around `utilityProcess.fork`.
  - Provides request correlation, readiness gating, health state, bounded restart and subscriber-port reattachment.

### New tests

- `electron/data-engine/protocol.test.cjs`
- `electron/data-engine/transcript-indexer.test.cjs`
- `electron/data-engine/projection-store.test.cjs`
- `electron/data-engine/codex-rpc-client.test.cjs`
- `electron/data-engine/codex-projection-service.test.cjs`
- `electron/data-engine/supervisor.test.cjs`
- `electron/data-engine/service.integration.test.cjs`
- `electron/data-engine/renderer-stream.test.cjs`

### Existing files changed

- `electron/sidecar-store.cjs`
  - Export normalization and schema helpers needed by the engine.
  - Stop opening this store from the main process.
- `electron/main.cjs`
  - Remove main-owned app-server, Hook queue, runtime JSON, transcript scan and CodexStore recomputation.
  - Route bounded data commands to the supervisor.
- `electron/preload.cjs`
  - Receive replacement MessagePorts and expose revisioned store subscription.
- `src/types/sidecar.ts`
  - Add projection revision and engine health types.
- `src/env.d.ts`
  - Update renderer API types.
- `src/App.vue`
  - Remove the 5-second refresh timer and request-id refresh writer.
  - Apply only monotonic projection revisions.
- `electron/account-usage-estimate.cjs`
  - Retain pure estimation helpers for compatibility tests; remove full-file production reader.
- `electron/context-usage.cjs`
  - Retain event normalization; remove full-file production reader.
- `docs/state-model.md`
  - Replace the legacy snapshot pipeline with the engine event/revision model.
- `.github/workflows/release.yml`
  - Add installed-artifact signature and first-launch migration smoke gates without publishing an intermediate version.

---

### Task 1: Bounded engine protocol

**Files:**
- Create: `electron/data-engine/protocol.cjs`
- Create: `electron/data-engine/protocol.test.cjs`

**Interfaces:**
- Produces: `createRequest(id, operation, payload)`, `createSuccessResponse(id, value)`, `createErrorResponse(id, error)`, `parseEngineMessage(value)`, `ENGINE_OPERATIONS`, `MAX_ENGINE_MESSAGE_BYTES`.
- Consumes: plain structured-clone-compatible objects.

- [x] **Step 1: Write failing tests for accepted envelopes and rejected unbounded operations**

```js
test('accepts a declared engine request', () => {
  assert.deepEqual(parseEngineMessage({
    type: 'request',
    id: 7,
    operation: 'projection.get',
    payload: null
  }), {
    type: 'request',
    id: 7,
    operation: 'projection.get',
    payload: null
  })
})

test('rejects an undeclared operation', () => {
  assert.throws(
    () => parseEngineMessage({ type: 'request', id: 8, operation: 'eval', payload: 'process.exit()' }),
    /Unsupported data-engine operation/
  )
})
```

- [x] **Step 2: Run the protocol test and confirm failure because the module does not exist**

Run: `node --test electron/data-engine/protocol.test.cjs`

Expected: FAIL with module-not-found for `protocol.cjs`.

- [x] **Step 3: Implement strict envelopes and operation allow-list**

The allow-list contains:

```js
[
  'engine.health',
  'projection.get',
  'projection.refresh',
  'sidecarData.get',
  'sidecarData.replace',
  'settings.update',
  'favorites.set',
  'prompts.save',
  'windowState.get',
  'windowState.save',
  'contextUsage.set',
  'continuation.get',
  'continuation.save',
  'continuation.setUnread',
  'explorations.list',
  'explorations.get',
  'explorations.save',
  'explorations.delete',
  'explorations.replace',
  'codex.request',
  'thread.turnPreviews'
]
```

- [x] **Step 4: Run the protocol test and confirm it passes**

Run: `node --test electron/data-engine/protocol.test.cjs`

- [x] **Step 5: Review checkpoint**

Verify no operation can select an arbitrary object method and oversized serialized messages are rejected before dispatch.

### Task 2: Incremental transcript indexer

**Files:**
- Create: `electron/data-engine/transcript-indexer.cjs`
- Create: `electron/data-engine/transcript-indexer.test.cjs`
- Modify: `electron/account-usage-estimate.cjs`
- Modify: `electron/context-usage.cjs`

**Interfaces:**
- Produces: `createTranscriptIndexer({ readChunk, statFile, chunkSize })`.
- Produces: `indexTranscript({ path, threadId, checkpoint, onFact }) -> Promise<{ checkpoint, factsProcessed }>` where checkpoint is `{ device, inode, offset, trailing, previousTotalTokens, lastDateKey }`.
- Emits facts `{ type: 'tokenDelta' | 'contextUsage' | 'turnLifecycle' | 'lastUserPreview', ... }`.

- [x] **Step 1: Write failing tests for append-only reads, partial lines, malformed lines and file replacement**

Use temporary files and assert literal byte ranges. The append test writes two events, indexes them, appends one event, and asserts the second run's first requested offset equals the first run's persisted offset.

- [x] **Step 2: Run the indexer test and confirm module-not-found failure**

Run: `node --test electron/data-engine/transcript-indexer.test.cjs`

- [x] **Step 3: Implement bounded streaming**

Read at most `256 * 1024` bytes per filesystem request. Preserve an incomplete final line in `checkpoint.trailing`. Reset derived checkpoint state when device/inode changes or file size is less than the checkpoint offset.

- [x] **Step 4: Emit independently testable facts**

Token deltas use the previous cumulative total. Lifecycle recognizes `task_started`, `task_complete` and `turn_aborted`. Context usage reuses `contextUsageFromTranscriptTokenCount`.

- [x] **Step 5: Run indexer and existing usage tests**

Run:

```sh
node --test \
  electron/data-engine/transcript-indexer.test.cjs \
  electron/account-usage-estimate.test.cjs \
  electron/context-usage.test.cjs
```

- [x] **Step 6: Remove production full-file readers**

Keep pure content/event normalizers used by tests. Delete or stop exporting `readLocalTodayTokenEstimateForThread` and `readLatestTranscriptContextUsage` after all production callers have moved.

### Task 3: Atomic schema v2 and projections

**Files:**
- Create: `electron/data-engine/projection-store.cjs`
- Create: `electron/data-engine/projection-store.test.cjs`
- Modify: `electron/sidecar-store.cjs`

**Interfaces:**
- Produces: `prepareEngineDatabase({ sourcePath, enginePath, backupPath })`.
- Produces: `createProjectionStore(enginePath)`.
- Store methods include `getProjection`, `commitProjection`, `getCheckpoint`, `saveCheckpoint`, `acceptHook`, `applyFacts`, and the bounded Sidecar-data methods from Task 1.

- [x] **Step 1: Write a failing migration test**

Create a real v1 database with settings, favorites and an exploration. Run `prepareEngineDatabase`. Assert:

```js
assert.equal(migrated.getSidecarData().settings.themeMode, 'dark')
assert.equal(migrated.listFavorites().length, 1)
assert.equal(migrated.listExplorationRuns().length, 1)
assert.equal(migrated.db.pragma('integrity_check', { simple: true }), 'ok')
assert.equal(fs.existsSync(backupPath), true)
```

- [x] **Step 2: Run the store test and verify RED**

Run: `ELECTRON_RUN_AS_NODE=1 electron --test electron/data-engine/projection-store.test.cjs`

- [x] **Step 3: Implement copy-then-promote migration**

Migration rules:

- Never alter the only v1 file in place.
- Copy v1 to a temporary v2 candidate.
- Create v2 tables in one transaction.
- Set `PRAGMA user_version = 2`.
- Run `integrity_check`.
- Close the candidate before atomic rename.
- Keep one v1 recovery backup.
- If the candidate already passed and was promoted, startup is idempotent.

- [x] **Step 4: Add engine tables**

```sql
hook_inbox(id TEXT PRIMARY KEY, event_name TEXT, payload TEXT, received_at INTEGER, processed_at INTEGER);
runtime_signals(thread_key TEXT PRIMARY KEY, payload TEXT, updated_at INTEGER);
transcript_checkpoints(path TEXT PRIMARY KEY, payload TEXT, updated_at INTEGER);
daily_usage(date_key TEXT PRIMARY KEY, tokens INTEGER, event_count INTEGER, updated_at INTEGER);
thread_projections(thread_id TEXT PRIMARY KEY, payload TEXT, updated_at INTEGER);
projection_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
change_log(revision INTEGER PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
```

- [x] **Step 5: Test transactional revision behavior**

Assert a failed projection transaction changes neither projection rows nor the revision. Assert successful commits increment revision exactly once.

- [x] **Step 6: Run v1 and v2 store tests**

Run:

```sh
ELECTRON_RUN_AS_NODE=1 electron --test \
  electron/sidecar-store.test.cjs \
  electron/data-engine/projection-store.test.cjs
```

### Task 4: Single Codex app-server owner

**Files:**
- Create: `electron/data-engine/codex-rpc-client.cjs`
- Create: `electron/data-engine/codex-rpc-client.test.cjs`

**Interfaces:**
- Produces: `createCodexRpcClient({ resolveExecutable, spawnProcess, clientInfo, onNotification })`.
- Public methods: `connect()`, `request(method, params, timeoutMs)`, `dispose()`, `getStatus()`, `events`.

- [x] **Step 1: Write failing tests**

Cover:

- concurrent `connect()` calls spawn one process;
- identical coalescible read requests share one in-flight promise;
- server-initiated requests receive the read-only `-32601` response;
- process exit rejects all pending requests;
- non-read commands are never coalesced.

- [x] **Step 2: Run the test and verify RED**

Run: `node --test electron/data-engine/codex-rpc-client.test.cjs`

- [x] **Step 3: Extract and harden the current client**

Move current JSON-line parsing into this module. Coalesce only:

```js
new Set([
  'thread/list',
  'thread/read',
  'account/rateLimits/read',
  'account/usage/read'
])
```

The coalescing key contains method plus stable serialized params.

- [x] **Step 4: Run the client test and confirm GREEN**

Run: `node --test electron/data-engine/codex-rpc-client.test.cjs`

### Task 5: Deterministic Codex projection service

**Files:**
- Create: `electron/data-engine/codex-projection-service.cjs`
- Create: `electron/data-engine/codex-projection-service.test.cjs`

**Interfaces:**
- Produces: `createCodexProjectionService({ client, store, indexer, readNativeUnread, clock })`.
- Public methods: `start()`, `refresh(reason)`, `ingestHook(event)`, `getProjection()`, `dispose()`.
- Emits `projection` with `{ revision, codexStore }`.

- [x] **Step 1: Write failing status and monotonicity tests**

Fixtures cover:

- Hook `running` remains visible when app-server returns `notLoaded`;
- matching transcript `task_complete` clears runtime;
- `failed` outranks `waiting`, which outranks `running`;
- repeated identical refresh produces no new revision;
- a refresh requested during an in-flight refresh runs exactly once after it;
- local-today usage reads `daily_usage`, never complete transcript content.

- [x] **Step 2: Run the projection test and verify RED**

Run: `node --test electron/data-engine/codex-projection-service.test.cjs`

- [x] **Step 3: Implement one refresh scheduler**

Use one in-flight promise plus one pending reason set. Notifications and Hook ingestion request refreshes through this scheduler. A periodic reconciliation timer is process-wide and only repairs missed filesystem/app-server notifications.

- [x] **Step 4: Implement bounded thread enrichment**

Use indexed facts for lifecycle, context usage and last-user preview. `thread/read(includeTurns: true)` is not part of periodic projection refresh.

- [x] **Step 5: Run projection tests**

Run: `node --test electron/data-engine/codex-projection-service.test.cjs`

### Task 6: Utility-process service and supervision

**Files:**
- Create: `electron/data-engine/service.cjs`
- Create: `electron/data-engine/supervisor.cjs`
- Create: `electron/data-engine/supervisor.test.cjs`
- Create: `electron/data-engine/service.integration.test.cjs`

**Interfaces:**
- `createDataEngineSupervisor({ forkUtility, entryPath, env, restartPolicy })`.
- Supervisor methods: `start()`, `request(operation, payload)`, `attachSubscriber(port, topics)`, `getHealth()`, `dispose()`.
- Engine emits `ready`, `health`, `event`, `response` and `projection` envelopes.

- [x] **Step 1: Write failing supervisor tests**

Use a behavioral fake child. Assert requests made before readiness wait, a crashed child rejects in-flight requests, restart uses bounded exponential delay, and replacement child receives all active subscriber topics.

- [x] **Step 2: Run supervisor tests and verify RED**

Run: `node --test electron/data-engine/supervisor.test.cjs`

- [x] **Step 3: Implement supervisor**

Restart delays are `250ms`, `1000ms`, `4000ms`, then `15000ms`. More than five exits inside 60 seconds opens the circuit and reports `failed` until the user restarts the app.

- [x] **Step 4: Implement service startup**

Startup order:

1. prepare/migrate the database;
2. open the projection store and purge already-processed inbox rows;
3. start app-server client;
4. commit the first projection;
5. start transcript/app-server/native-unread watchers;
6. emit `ready`;
7. recover the Hook inbox in the background, discarding entries older than 24 hours and collapsing current entries into one projection refresh.

- [x] **Step 5: Run supervisor and service tests**

Run:

```sh
ELECTRON_RUN_AS_NODE=1 electron --test \
  electron/data-engine/supervisor.test.cjs \
  electron/data-engine/service.integration.test.cjs
```

### Task 7: Move main-process persistence and app-server access behind the engine

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/sidecar-store.cjs`
- Add focused tests where extracted main-process adapters expose behavior.

**Interfaces:**
- Main owns one `dataEngine` supervisor.
- Existing UI commands retain their renderer-visible response shapes.
- Existing exploration/continuation code receives an app-server proxy whose `request` method delegates to `codex.request` and whose events come from engine notification envelopes.

- [x] **Step 1: Write failing adapter tests**

Prove settings writes, exploration updates and continuation-result writes call bounded engine operations and return the existing normalized response.

- [x] **Step 2: Initialize engine before windows**

`app.whenReady()` must await engine readiness and initial Sidecar data before creating visible windows. If startup fails, open a small recovery window or dialog containing the migration/engine error; never open the normal UI with empty state.

- [x] **Step 3: Convert synchronous store callers to awaited commands**

Update window state, settings, favorites, prompts, imports/exports, explorations and continuation results. Remove `sidecarStore` and `getSidecarStore()` from main.

- [x] **Step 4: Replace main-owned app-server**

Remove `codexClient`, `createCodexRpcClient` and direct `spawn(... app-server ...)` from main. Keep a compatibility proxy for existing explicit user commands until those commands are separately extracted.

- [x] **Step 5: Remove legacy runtime work**

Delete:

- `processHookEvents()` from main;
- runtime-state read/write/reconciliation from main;
- native unread watchers from main;
- transcript scan and hydration from main;
- `createCodexStore`, `safeCodexStore`, debounce timers and broadcasts from main.

- [x] **Step 6: Run Electron-side behavior tests**

Run the focused Node/Electron tests only; do not run build, lint or typecheck.

### Task 8: Revision stream to renderers

**Files:**
- Modify: `electron/preload.cjs`
- Modify: `src/types/sidecar.ts`
- Modify: `src/env.d.ts`
- Modify: `src/App.vue`
- Create: `electron/data-engine/renderer-stream.test.cjs`

**Interfaces:**
- `window.sidecar.getCodexProjection() -> Promise<{ revision, codexStore, engineHealth }>`
- `window.sidecar.onCodexProjection(callback) -> unsubscribe`
- Callback receives `{ revision, codexStore, engineHealth }`.

- [x] **Step 1: Write failing revision application tests**

Extract a pure `shouldApplyProjection(currentRevision, nextRevision)` helper and assert:

```js
assert.equal(shouldApplyProjection(12, 13), true)
assert.equal(shouldApplyProjection(12, 12), false)
assert.equal(shouldApplyProjection(12, 11), false)
```

The renderer-stream test asserts a replacement MessagePort closes the old port and continues delivery on the new engine generation.

- [x] **Step 2: Run tests and verify RED**

Run: `node --test electron/data-engine/renderer-stream.test.cjs`

- [x] **Step 3: Connect MessagePorts**

Main creates a `MessageChannelMain` per renderer, transfers one port to the engine and one to preload. The engine immediately sends the current projection, then later committed revisions.

- [x] **Step 4: Remove renderer polling**

Delete `refreshTimer`, `codexStoreRequestId`, `refreshCodexStore()` and the 5-second interval. Import completion requests projection refresh through the engine command rather than directly writing renderer state.

- [x] **Step 5: Apply revision guard**

Renderer state updates only if the incoming revision is greater than the current revision. Engine generation changes reset the baseline after the first full projection.

- [x] **Step 6: Run renderer stream and existing UI contract tests**

Run targeted Node tests. Do not run Vite build or TypeScript checks.

### Task 9: Hook durability and single-release migration

**Files:**
- Modify: `electron/sidecar-hooks.cjs`
- Modify: `electron/data-engine/service.cjs`
- Modify: `electron/data-engine/projection-store.cjs`
- Add tests to the corresponding files.

**Interfaces:**
- Hook capture continues writing one JSON file per event.
- Engine accepts a Hook into `hook_inbox` before deleting the source file.
- Processed inbox payloads are removed after source-file deletion.
- Hook recovery never blocks engine `ready`.

- [x] **Step 1: Write failing exactly-once tests**

Assert duplicate filenames/payload IDs produce one runtime transition. Assert a crash after inbox commit but before source deletion is harmless on restart.

- [x] **Step 2: Implement durable inbox ingestion**

Invalid payloads are quarantined with error metadata rather than blocking the queue. Valid source files are deleted only after the inbox transaction commits.
Current files are committed in bounded batches and cause one projection refresh for the replay. Files older than 24 hours are stale recovery artifacts and are deleted without changing runtime state.

- [x] **Step 3: Test v1 runtime import**

On first v2 startup, import `runtime-state.json` before the first projection and mark completion in `projection_meta`. Replay recent pending Hook files after `ready`; app-server and transcript state keep the initial projection authoritative while recovery runs.

- [x] **Step 4: Run Hook and store tests**

Run:

```sh
ELECTRON_RUN_AS_NODE=1 electron --test \
  electron/sidecar-hooks.test.cjs \
  electron/data-engine/projection-store.test.cjs \
  electron/data-engine/service.integration.test.cjs
```

### Task 10: Release gates and documentation

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `electron/packaging-config.test.cjs`
- Modify: `docs/state-model.md`
- Modify: `README.md` only if user-facing recovery behavior needs documentation.

**Interfaces:**
- One signed arm64 asset and one signed x64 asset remain the only production release.
- CI must verify the installed artifact, not only the build directory.

- [x] **Step 1: Write failing packaging behavior tests**

Extend packaging tests to require mounted-DMG or extracted-ZIP verification, `codesign --verify --deep --strict`, `spctl --assess`, and a packaged-app first-launch smoke command that uses a temporary user-data directory.

- [x] **Step 2: Run packaging test and verify RED**

Run: `node --test electron/packaging-config.test.cjs`

- [x] **Step 3: Add release workflow gates**

For each architecture:

- verify packaged bundle signature;
- verify the artifact after extraction/mount;
- run a noninteractive first-launch engine readiness smoke test with temporary user data;
- upload assets only after all checks pass.

- [x] **Step 4: Replace state-model documentation**

Document:

- one app-server owner;
- one SQLite owner;
- Hook inbox;
- transcript byte checkpoints;
- status reducer priority;
- projection revision contract;
- utility-process restart and circuit breaker;
- one-release migration and recovery backup.

- [x] **Step 5: Run all permitted tests**

Run every Node/Electron test directly or through an existing pnpm test script. Do not run development server, build, ESLint, `tsc` or `vue-tsc`.

- [x] **Step 6: Final diff and residue review**

Search for and remove production references to:

```text
setInterval(refreshCodexStore
readLocalTodayTokenEstimateForThread
readLatestTranscriptContextUsage
runtime-state.json as the live state owner
createCodexStore in electron/main.cjs
spawn(codexPath, ['app-server', '--stdio']) in electron/main.cjs
```

Confirm unrelated user changes remain untouched and report any validation that could not be executed under project constraints.

### Task 11: Startup and steady-state performance

**Files:**
- Modify: `electron/data-engine/service.cjs`
- Modify: `electron/data-engine/service.integration.test.cjs`
- Modify: `electron/data-engine/codex-projection-service.cjs`
- Modify: `electron/data-engine/codex-projection-service.test.cjs`
- Modify: `electron/data-engine/transcript-indexer.cjs`
- Modify: `electron/data-engine/transcript-indexer.test.cjs`
- Modify: `electron/data-engine/projection-store.cjs`
- Modify: `electron/data-engine/projection-store.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/packaging-config.test.cjs`
- Modify: `docs/state-model.md`

**Measured baseline (2026-08-10):**

- A fresh temporary v2 database required about `27.8s` to index 413 threads.
- A warm start required about `7.5–8.6s` before engine readiness.
- Each unchanged 30-second reconciliation required about `3.0s`.
- The current development database was `389MB`; about `286MB` was freelist space and the 100-row full-projection change log occupied about `105MB`.

**Acceptance criteria:**

- Database open and the last committed projection make the engine ready without waiting for app-server connection, thread listing or transcript indexing.
- The first projection refresh runs in the background; failures update engine health and do not terminate the service.
- An unchanged transcript at a complete EOF checkpoint is not opened, read or written back to SQLite.
- Rate-limit and account-usage freshness use a lightweight auxiliary refresh that never lists threads or indexes transcripts.
- Full reconciliation is event-driven with one five-minute safety interval instead of every 30 seconds.
- Clean shutdowns skip startup integrity scans; unclean shutdowns run `quick_check`, while migration still runs `integrity_check`.
- The full-projection change log retains at most five rows.
- High-freelist databases are compacted after readiness, never on the window-readiness critical path.
- Packaged smoke mode explicitly waits for one complete projection refresh even though normal window creation does not.

- [x] **Step 1: Write and observe failing startup-readiness tests**

Block the first `thread/list` response in the service fixture. Assert that `ready` is delivered while that response remains blocked and that a later projection notification arrives after the fixture is released.

- [x] **Step 2: Decouple readiness from initial projection**

Start watchers and publish the persisted projection before launching the initial refresh. Retain a shared initial-refresh promise for explicit smoke verification and for background maintenance sequencing.

- [x] **Step 3: Write and observe failing unchanged-transcript tests**

Persist file identity, size and modification time in the checkpoint. Given an EOF checkpoint whose identity, size and modification time still match, assert zero chunk reads and no transcript-batch write.

- [x] **Step 4: Implement the unchanged EOF fast path**

Keep device/inode replacement and truncation as reset conditions. A changed size or modification time must still enter the bounded append reader even when the prior offset was at EOF.

- [x] **Step 5: Write and observe failing scheduling tests**

Call the auxiliary refresh and assert it updates rate limits/account usage without calling `thread/list` or the transcript indexer. Assert the safety reconciliation interval is five minutes.

- [x] **Step 6: Split auxiliary refresh from full reconciliation**

Use app-server and filesystem events for prompt full refreshes, a lightweight timer for auxiliary fields, and one low-frequency full safety reconciliation.

- [x] **Step 7: Write and observe failing database-maintenance tests**

Assert clean restart skips integrity verification, unclean restart performs `quick_check`, projection history stays bounded to five revisions, and conditional compaction reduces a deliberately fragmented test database.

- [x] **Step 8: Implement clean-shutdown recovery and background compaction**

Mark the database dirty when the engine opens and clean only during orderly shutdown. Schedule conditional `VACUUM` after readiness and initial refresh; report maintenance errors through engine health without taking down the renderer stream.

- [x] **Step 9: Preserve the packaged smoke gate**

Make smoke mode explicitly request a complete projection refresh before checking health and database integrity. Normal application startup must continue to create windows after engine readiness alone.

- [x] **Step 10: Update documentation and run permitted verification**

Update the state model, run focused RED/GREEN tests and the full Node/Electron suite, inspect syntax and diff residue, then rerun isolated real-data timing probes. Do not start the development server or run build, lint, `tsc` or `vue-tsc`.

**Verification result (2026-08-10):**

- Fresh temporary database with 415 real threads: engine `ready` in `171ms`; background initial index in `28.272s`.
- Warm temporary database: engine `ready` in `152ms`; background reconciliation in `8.620s`.
- Explicit unchanged full reconciliation remained about `2.8–3.0s`, but now runs only as a five-minute safety pass; 15-second auxiliary refresh does not list threads.
- A SQLite backup of the current development database compacted from `407,666,688` bytes to `8,187,904` bytes; `change_log` dropped from 100 to 5 rows and freelist pages from 73,096 to 0. The live database was not modified by this probe.
- `87` Electron-side tests and `32` script/renderer contract tests passed (`119/119` total). JavaScript syntax checks and both staged/unstaged `git diff --check` passed.
- Project constraints intentionally excluded dev-server startup, build, lint and TypeScript checks; runtime UI confirmation remains for the user.
