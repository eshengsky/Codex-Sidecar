const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createSidecarStore } = require('../sidecar-store.cjs')
const {
  createProjectionStore,
  prepareEngineDatabase
} = require('./projection-store.cjs')

const withDatabasePaths = async run => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-projection-store-'))

  try {
    await run({
      sourcePath: path.join(directory, 'sidecar.sqlite'),
      enginePath: path.join(directory, 'sidecar-v2.sqlite'),
      backupPath: path.join(directory, 'sidecar-v1.backup.sqlite')
    })
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
}

test('atomically migrates v1 data into an integrity-checked v2 database', async () => {
  await withDatabasePaths(async ({ sourcePath, enginePath, backupPath }) => {
    const source = createSidecarStore(sourcePath)

    source.updateSettings({ themeMode: 'dark', languageMode: 'zh' })
    source.setFavorite({
      type: 'thread',
      id: 'thread-1',
      threadId: 'thread-1',
      createdAt: 1
    }, true)
    source.saveExplorationRun({
      id: 'run-1',
      title: 'Migration fixture',
      prompt: 'Compare',
      images: [],
      concurrency: 2,
      sourceThreadId: null,
      sourceThreadTitle: '',
      sourceThreadCwd: '',
      candidates: [],
      summary: {
        status: 'pending',
        output: '',
        error: null,
        threadId: null,
        turnId: null,
        startedAt: null,
        completedAt: null
      },
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      completedAt: null
    })
    source.close()

    const migration = await prepareEngineDatabase({
      sourcePath,
      enginePath,
      backupPath
    })

    assert.equal(migration.migrated, true)
    assert.equal(await fsp.stat(backupPath).then(() => true), true)

    const migrated = createProjectionStore(enginePath)

    try {
      assert.equal(migrated.getSidecarData().settings.themeMode, 'dark')
      assert.equal(migrated.getSidecarData().settings.languageMode, 'zh')
      assert.equal(migrated.listFavorites().length, 1)
      assert.equal(migrated.listExplorationRuns().length, 1)
      assert.equal(migrated.db.pragma('user_version', { simple: true }), 2)
      assert.equal(migrated.db.pragma('integrity_check', { simple: true }), 'ok')
    } finally {
      migrated.close()
    }
  })
})

test('database preparation is idempotent after v2 has been promoted', async () => {
  await withDatabasePaths(async ({ sourcePath, enginePath, backupPath }) => {
    const source = createSidecarStore(sourcePath)
    source.updateSettings({ themeMode: 'dark' })
    source.close()

    const first = await prepareEngineDatabase({ sourcePath, enginePath, backupPath })
    const second = await prepareEngineDatabase({ sourcePath, enginePath, backupPath })

    assert.equal(first.migrated, true)
    assert.equal(first.verification, 'full')
    assert.equal(second.migrated, false)
    assert.equal(second.verification, 'quick')

    const store = createProjectionStore(enginePath)

    try {
      assert.equal(store.getSidecarData().settings.themeMode, 'dark')
    } finally {
      store.close()
    }
  })
})

test('skips recovery verification after a clean shutdown and checks an unclean database', async () => {
  await withDatabasePaths(async ({ enginePath, backupPath }) => {
    const first = await prepareEngineDatabase({ enginePath, backupPath })
    const store = createProjectionStore(enginePath)

    store.setMeta('engineCleanShutdown', '1')
    store.close()

    const cleanRestart = await prepareEngineDatabase({ enginePath, backupPath })
    const reopened = createProjectionStore(enginePath)

    reopened.setMeta('engineCleanShutdown', '0')
    reopened.close()

    const uncleanRestart = await prepareEngineDatabase({ enginePath, backupPath })

    assert.equal(first.verification, 'full')
    assert.equal(cleanRestart.verification, 'skipped')
    assert.equal(uncleanRestart.verification, 'quick')
  })
})

test('commits a projection and its monotonic revision in one transaction', async () => {
  await withDatabasePaths(async ({ enginePath }) => {
    const store = createProjectionStore(enginePath)

    try {
      assert.deepEqual(store.getProjection(), {
        revision: 0,
        codexStore: null
      })

      const codexStore = {
        generatedAt: 100,
        connection: {
          connected: true,
          lastError: null
        },
        nativeUnread: {
          available: true,
          path: '/tmp/state.json',
          count: 0,
          error: null
        },
        rateLimits: null,
        accountUsage: null,
        threads: [{
          id: 'thread-1',
          title: 'Thread 1'
        }]
      }
      const first = store.commitProjection(codexStore)
      const second = store.commitProjection({
        ...codexStore,
        generatedAt: 200,
        threads: [{
          id: 'thread-1',
          title: 'Updated'
        }]
      })

      assert.equal(first.revision, 1)
      assert.equal(second.revision, 2)
      assert.equal(store.getProjection().codexStore.threads[0].title, 'Updated')
      assert.deepEqual(store.listChangesAfter(0).map(change => change.revision), [1, 2])
    } finally {
      store.close()
    }
  })
})

test('retains only the five most recent full projection changes', async () => {
  await withDatabasePaths(async ({ enginePath }) => {
    const store = createProjectionStore(enginePath)

    try {
      for (let revision = 1; revision <= 8; revision += 1) {
        store.commitProjection({
          generatedAt: revision,
          connection: { connected: true, lastError: null },
          nativeUnread: { available: true, path: '', count: 0, error: null },
          rateLimits: null,
          accountUsage: null,
          threads: [{
            id: 'thread-1',
            title: `Revision ${revision}`
          }]
        })
      }

      assert.deepEqual(store.listChangesAfter(0).map(change => change.revision), [4, 5, 6, 7, 8])
    } finally {
      store.close()
    }
  })
})

test('compacts a fragmented database only after the configured threshold is met', async () => {
  await withDatabasePaths(async ({ enginePath }) => {
    const store = createProjectionStore(enginePath)

    try {
      store.db.exec('CREATE TABLE compaction_fixture (payload TEXT NOT NULL)')
      const insert = store.db.prepare('INSERT INTO compaction_fixture (payload) VALUES (?)')
      const fill = store.db.transaction(() => {
        for (let index = 0; index < 300; index += 1) {
          insert.run(`${index}:${'x'.repeat(16 * 1024)}`)
        }
      })

      fill()
      store.db.exec('DELETE FROM compaction_fixture')

      const compacted = store.compactIfNeeded({
        minPageCount: 1,
        minFreeRatio: 0.01
      })

      assert.equal(compacted.performed, true)
      assert.equal(compacted.before.freelistCount > 0, true)
      assert.equal(compacted.after.freelistCount, 0)
      assert.equal(compacted.after.pageCount < compacted.before.pageCount, true)
    } finally {
      store.close()
    }
  })
})

test('a rejected projection leaves both rows and revision unchanged', async () => {
  await withDatabasePaths(async ({ enginePath }) => {
    const store = createProjectionStore(enginePath)

    try {
      const accepted = store.commitProjection({
        generatedAt: 100,
        connection: { connected: false, lastError: null },
        nativeUnread: { available: false, path: '', count: 0, error: null },
        rateLimits: null,
        accountUsage: null,
        threads: []
      })

      assert.throws(
        () => store.commitProjection({
          generatedAt: 200,
          threads: 'not-an-array'
        }),
        /threads must be an array/
      )
      assert.equal(store.getProjection().revision, accepted.revision)
      assert.equal(store.listChangesAfter(0).length, 1)
    } finally {
      store.close()
    }
  })
})

test('persists transcript checkpoints, daily usage and deduplicated Hook inbox entries', async () => {
  await withDatabasePaths(async ({ enginePath }) => {
    const store = createProjectionStore(enginePath)

    try {
      const accepted = store.acceptHook({
        id: 'hook-1',
        eventName: 'Stop',
        payload: { session_id: 'thread-1' },
        receivedAt: 100
      })
      const duplicate = store.acceptHook({
        id: 'hook-1',
        eventName: 'Stop',
        payload: { session_id: 'thread-1' },
        receivedAt: 200
      })

      store.saveCheckpoint('/tmp/thread.jsonl', {
        offset: 42,
        trailing: '',
        previousTotalTokens: 100
      })
      store.applyFacts([
        {
          type: 'tokenDelta',
          threadId: 'thread-1',
          dateKey: '2026-08-05',
          tokens: 25,
          eventTimestamp: 100
        },
        {
          type: 'tokenDelta',
          threadId: 'thread-1',
          dateKey: '2026-08-05',
          tokens: 10,
          eventTimestamp: 200
        }
      ])

      assert.equal(accepted, true)
      assert.equal(duplicate, false)
      assert.equal(store.getCheckpoint('/tmp/thread.jsonl').offset, 42)
      assert.deepEqual(store.getDailyUsage('2026-08-05'), {
        dateKey: '2026-08-05',
        tokens: 35,
        eventCount: 2,
        threadCount: 1,
        updatedAt: 200
      })

      store.resetTranscriptFacts('thread-1')
      assert.equal(store.getDailyUsage('2026-08-05'), null)

      store.setMeta('runtimeStateImported', '1')
      assert.equal(store.getMeta('runtimeStateImported'), '1')
    } finally {
      store.close()
    }
  })
})

test('commits transcript facts and their checkpoint atomically', async () => {
  await withDatabasePaths(async ({ enginePath }) => {
    const store = createProjectionStore(enginePath)
    const batch = {
      threadId: 'thread-1',
      transcriptPath: '/tmp/thread-1.jsonl',
      reset: false,
      facts: [{
        type: 'tokenDelta',
        threadId: 'thread-1',
        dateKey: '2026-08-05',
        tokens: 25,
        eventTimestamp: 100
      }],
      checkpoint: {
        offset: 42,
        trailing: '',
        previousTotalTokens: 25
      }
    }

    try {
      store.db.exec(`
        CREATE TRIGGER reject_test_checkpoint
        BEFORE INSERT ON transcript_checkpoints
        BEGIN
          SELECT RAISE(ABORT, 'checkpoint rejected');
        END;
      `)

      assert.throws(() => store.applyTranscriptBatch(batch), /checkpoint rejected/)
      assert.equal(store.getDailyUsage('2026-08-05'), null)
      assert.equal(store.getCheckpoint(batch.transcriptPath), null)

      store.db.exec('DROP TRIGGER reject_test_checkpoint')
      store.applyTranscriptBatch(batch)

      assert.equal(store.getDailyUsage('2026-08-05').tokens, 25)
      assert.equal(store.getCheckpoint(batch.transcriptPath).offset, 42)
    } finally {
      store.close()
    }
  })
})
