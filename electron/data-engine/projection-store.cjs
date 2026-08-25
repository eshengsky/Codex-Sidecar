const fsp = require('node:fs/promises')
const path = require('node:path')

const Database = require('better-sqlite3')

const { createSidecarStore } = require('../sidecar-store.cjs')
const { deduplicateThreadsById } = require('./thread-collection.cjs')

const ENGINE_SCHEMA_VERSION = 2
const CHANGE_LOG_LIMIT = 5
const CLEAN_SHUTDOWN_META_KEY = 'engineCleanShutdown'

const parseJson = (value, fallback = null) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const pathExists = async filePath => {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

const migrateEngineSchema = db => {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hook_inbox (
        id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        processed_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime_signals (
        thread_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transcript_checkpoints (
        path TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transcript_facts (
        thread_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_usage (
        date_key TEXT PRIMARY KEY,
        tokens INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_daily_usage (
        thread_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, date_key)
      );
      CREATE TABLE IF NOT EXISTS thread_projections (
        thread_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projection_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS change_log (
        revision INTEGER PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schemaVersion',
      String(ENGINE_SCHEMA_VERSION)
    )
    db.pragma(`user_version = ${ENGINE_SCHEMA_VERSION}`)
  })

  migrate()
}

const createProjectionStore = dbPath => {
  const base = createSidecarStore(dbPath)
  const { db } = base

  migrateEngineSchema(db)

  const readMeta = key => {
    const row = db.prepare('SELECT value FROM projection_meta WHERE key = ?').get(key)
    return row?.value ?? null
  }
  const writeMeta = db.prepare(`
    INSERT INTO projection_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  const insertThreadProjection = db.prepare(`
    INSERT INTO thread_projections (thread_id, payload, updated_at)
    VALUES (@threadId, @payload, @updatedAt)
  `)
  const insertChange = db.prepare(`
    INSERT INTO change_log (revision, payload, created_at)
    VALUES (@revision, @payload, @createdAt)
  `)

  const getProjection = () => {
    const revision = Number(readMeta('projectionRevision')) || 0
    const codexStore = parseJson(readMeta('codexStore'), null)

    return {
      revision,
      codexStore
    }
  }

  const commitProjection = codexStore => {
    if (!codexStore || typeof codexStore !== 'object' || Array.isArray(codexStore)) {
      throw new Error('Codex projection must be an object.')
    }

    if (!Array.isArray(codexStore.threads)) {
      throw new Error('Codex projection threads must be an array.')
    }

    const normalizedStore = {
      ...codexStore,
      threads: deduplicateThreadsById(codexStore.threads)
    }
    const serializedStore = JSON.stringify(normalizedStore)
    const currentRevision = Number(readMeta('projectionRevision')) || 0
    const revision = currentRevision + 1
    const projection = {
      revision,
      codexStore: normalizedStore
    }
    const serializedProjection = JSON.stringify(projection)
    const committedAt = Date.now()
    const commit = db.transaction(() => {
      db.prepare('DELETE FROM thread_projections').run()

      for (const thread of normalizedStore.threads) {
        if (!thread || typeof thread.id !== 'string' || !thread.id) {
          continue
        }

        insertThreadProjection.run({
          threadId: thread.id,
          payload: JSON.stringify(thread),
          updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : committedAt
        })
      }

      writeMeta.run('projectionRevision', String(revision))
      writeMeta.run('codexStore', serializedStore)
      insertChange.run({
        revision,
        payload: serializedProjection,
        createdAt: committedAt
      })
      db.prepare(`
        DELETE FROM change_log
        WHERE revision NOT IN (
          SELECT revision
          FROM change_log
          ORDER BY revision DESC
          LIMIT ?
        )
      `).run(CHANGE_LOG_LIMIT)
    })

    commit()
    return projection
  }

  const listChangesAfter = revision => {
    const normalizedRevision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0

    return db.prepare(`
      SELECT revision, payload, created_at
      FROM change_log
      WHERE revision > ?
      ORDER BY revision ASC
    `).all(normalizedRevision).map(row => ({
      revision: row.revision,
      projection: parseJson(row.payload, null),
      createdAt: row.created_at
    }))
  }

  const trimChangeLog = (limit = CHANGE_LOG_LIMIT) => {
    const normalizedLimit = Number.isSafeInteger(limit) && limit >= 0 ? limit : CHANGE_LOG_LIMIT

    return db.prepare(`
      DELETE FROM change_log
      WHERE revision NOT IN (
        SELECT revision
        FROM change_log
        ORDER BY revision DESC
        LIMIT ?
      )
    `).run(normalizedLimit).changes
  }

  const compactIfNeeded = ({
    minPageCount = 4096,
    minFreeRatio = 0.25
  } = {}) => {
    const pageCount = Number(db.pragma('page_count', { simple: true })) || 0
    const freelistCount = Number(db.pragma('freelist_count', { simple: true })) || 0
    const before = {
      pageCount,
      freelistCount,
      freeRatio: pageCount > 0 ? freelistCount / pageCount : 0
    }

    if (pageCount < minPageCount || before.freeRatio < minFreeRatio) {
      return {
        performed: false,
        before,
        after: before
      }
    }

    // VACUUM is intentionally exposed as an explicit maintenance operation.
    // The service schedules it only after ready so reclaiming a large legacy
    // change log cannot delay window creation.
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.exec('VACUUM')

    const afterPageCount = Number(db.pragma('page_count', { simple: true })) || 0
    const afterFreelistCount = Number(db.pragma('freelist_count', { simple: true })) || 0

    return {
      performed: true,
      before,
      after: {
        pageCount: afterPageCount,
        freelistCount: afterFreelistCount,
        freeRatio: afterPageCount > 0 ? afterFreelistCount / afterPageCount : 0
      }
    }
  }

  const getCheckpoint = transcriptPath => {
    const row = db.prepare('SELECT payload FROM transcript_checkpoints WHERE path = ?').get(transcriptPath)
    return row ? parseJson(row.payload, null) : null
  }

  const saveCheckpoint = (transcriptPath, checkpoint) => {
    const normalizedPath = typeof transcriptPath === 'string' ? transcriptPath.trim() : ''

    if (!normalizedPath || !checkpoint || typeof checkpoint !== 'object') {
      throw new Error('Transcript checkpoint is invalid.')
    }

    db.prepare(`
      INSERT INTO transcript_checkpoints (path, payload, updated_at)
      VALUES (@path, @payload, @updatedAt)
      ON CONFLICT(path) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run({
      path: normalizedPath,
      payload: JSON.stringify(checkpoint),
      updatedAt: Date.now()
    })

    return checkpoint
  }

  const acceptHook = ({ id, eventName, payload, receivedAt = Date.now() }) => {
    const normalizedId = typeof id === 'string' ? id.trim() : ''
    const normalizedEventName = typeof eventName === 'string' ? eventName.trim() : ''

    if (!normalizedId || !normalizedEventName || !payload || typeof payload !== 'object') {
      throw new Error('Hook inbox entry is invalid.')
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO hook_inbox (id, event_name, payload, received_at)
      VALUES (@id, @eventName, @payload, @receivedAt)
    `).run({
      id: normalizedId,
      eventName: normalizedEventName,
      payload: JSON.stringify(payload),
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now()
    })

    return result.changes === 1
  }

  const listPendingHooks = () => {
    return db.prepare(`
      SELECT id, event_name, payload, received_at
      FROM hook_inbox
      WHERE processed_at IS NULL
      ORDER BY received_at ASC, id ASC
    `).all().map(row => ({
      id: row.id,
      eventName: row.event_name,
      payload: parseJson(row.payload, null),
      receivedAt: row.received_at
    }))
  }

  const markHookProcessed = (id, { error = null, processedAt = Date.now() } = {}) => {
    db.prepare(`
      UPDATE hook_inbox
      SET processed_at = ?, error = ?
      WHERE id = ?
    `).run(
      Number.isFinite(processedAt) ? processedAt : Date.now(),
      error ? String(error) : null,
      id
    )
  }

  const applyHookBatch = entries => {
    if (!Array.isArray(entries)) {
      throw new Error('Hook inbox batch must be an array.')
    }

    let accepted = 0
    const commit = db.transaction(() => {
      for (const entry of entries) {
        if (!acceptHook(entry)) {
          continue
        }

        if (entry.runtime?.action === 'delete') {
          deleteRuntimeSignal(entry.runtime.key)
        } else if (entry.runtime?.action === 'set') {
          setRuntimeSignal(entry.runtime.key, entry.runtime.signal)
        }

        markHookProcessed(entry.id, {
          processedAt: entry.processedAt
        })
        accepted += 1
      }
    })

    // A Hook file is a durable inbox entry until its runtime mutation and
    // processed marker commit together. Grouping the batch avoids one WAL
    // transaction per historical Hook during recovery.
    commit()
    return accepted
  }

  const deleteHooks = ids => {
    if (!Array.isArray(ids) || ids.length === 0) {
      return 0
    }

    const deleteHook = db.prepare('DELETE FROM hook_inbox WHERE id = ?')
    let deleted = 0
    const commit = db.transaction(() => {
      for (const id of ids) {
        deleted += deleteHook.run(id).changes
      }
    })

    commit()
    return deleted
  }

  const purgeProcessedHooks = () => {
    return db.prepare('DELETE FROM hook_inbox WHERE processed_at IS NOT NULL').run().changes
  }

  const getTranscriptFacts = threadId => {
    const row = db.prepare('SELECT payload FROM transcript_facts WHERE thread_id = ?').get(threadId)
    return row ? parseJson(row.payload, null) : null
  }

  const getDailyUsage = dateKey => {
    const row = db.prepare(`
      SELECT
        date_key,
        SUM(tokens) AS tokens,
        SUM(event_count) AS event_count,
        COUNT(*) AS thread_count,
        MAX(updated_at) AS updated_at
      FROM thread_daily_usage
      WHERE date_key = ?
      GROUP BY date_key
    `).get(dateKey)

    return row
      ? {
          dateKey: row.date_key,
          tokens: row.tokens,
          eventCount: row.event_count,
          threadCount: row.thread_count,
          updatedAt: row.updated_at
        }
      : null
  }

  const addDailyUsage = db.prepare(`
    INSERT INTO thread_daily_usage (thread_id, date_key, tokens, event_count, updated_at)
    VALUES (@threadId, @dateKey, @tokens, 1, @updatedAt)
    ON CONFLICT(thread_id, date_key) DO UPDATE SET
      tokens = thread_daily_usage.tokens + excluded.tokens,
      event_count = thread_daily_usage.event_count + 1,
      updated_at = MAX(thread_daily_usage.updated_at, excluded.updated_at)
  `)
  const saveTranscriptFacts = db.prepare(`
    INSERT INTO transcript_facts (thread_id, payload, updated_at)
    VALUES (@threadId, @payload, @updatedAt)
    ON CONFLICT(thread_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `)
  const saveContextUsage = db.prepare(`
    INSERT INTO context_usage (thread_id, percent, total_tokens, model_context_window, updated_at)
    VALUES (@threadId, @percent, @totalTokens, @modelContextWindow, @updatedAt)
    ON CONFLICT(thread_id) DO UPDATE SET
      percent = excluded.percent,
      total_tokens = excluded.total_tokens,
      model_context_window = excluded.model_context_window,
      updated_at = excluded.updated_at
  `)

  const applyFacts = facts => {
    if (!Array.isArray(facts)) {
      throw new Error('Transcript facts must be an array.')
    }

    const apply = db.transaction(() => {
      const factsByThread = new Map()

      for (const fact of facts) {
        if (!fact || typeof fact !== 'object') {
          continue
        }

        if (fact.type === 'tokenDelta' && fact.dateKey) {
          addDailyUsage.run({
            threadId: fact.threadId,
            dateKey: fact.dateKey,
            tokens: Number.isFinite(fact.tokens) ? Math.max(0, Math.round(fact.tokens)) : 0,
            updatedAt: Number.isFinite(fact.eventTimestamp) ? fact.eventTimestamp : Date.now()
          })
          continue
        }

        if (fact.type === 'contextUsage' && fact.threadId) {
          saveContextUsage.run({
            threadId: fact.threadId,
            percent: fact.percent,
            totalTokens: fact.totalTokens,
            modelContextWindow: fact.modelContextWindow,
            updatedAt: fact.updatedAt
          })
          continue
        }

        if (!fact.threadId || !['turnLifecycle', 'lastUserPreview'].includes(fact.type)) {
          continue
        }

        const existing = factsByThread.get(fact.threadId) || getTranscriptFacts(fact.threadId) || {}
        const next = {
          ...existing
        }

        if (fact.type === 'turnLifecycle') {
          next.latestLifecycle = {
            turnId: fact.turnId,
            lifecycle: fact.lifecycle,
            updatedAt: fact.eventTimestamp
          }
        } else {
          next.lastUserPreview = fact.preview
          next.lastUserPreviewUpdatedAt = fact.eventTimestamp
        }

        factsByThread.set(fact.threadId, next)
      }

      for (const [threadId, payload] of factsByThread) {
        const updatedAt = Math.max(
          Number(payload.latestLifecycle?.updatedAt) || 0,
          Number(payload.lastUserPreviewUpdatedAt) || 0,
          Date.now()
        )

        saveTranscriptFacts.run({
          threadId,
          payload: JSON.stringify(payload),
          updatedAt
        })
      }
    })

    apply()
  }

  const getRuntimeSignals = () => {
    const result = {}

    for (const row of db.prepare('SELECT thread_key, payload FROM runtime_signals').all()) {
      const payload = parseJson(row.payload, null)

      if (payload) {
        result[row.thread_key] = payload
      }
    }

    return result
  }

  const setRuntimeSignal = (threadKey, signal) => {
    if (!threadKey || !signal || typeof signal !== 'object') {
      throw new Error('Runtime signal is invalid.')
    }

    const updatedAt = Number.isFinite(signal.updatedAt) ? signal.updatedAt : Date.now()

    db.prepare(`
      INSERT INTO runtime_signals (thread_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(threadKey, JSON.stringify({ ...signal, updatedAt }), updatedAt)
  }

  const deleteRuntimeSignal = threadKey => {
    db.prepare('DELETE FROM runtime_signals WHERE thread_key = ?').run(threadKey)
  }

  const resetTranscriptFacts = threadId => {
    const reset = db.transaction(() => {
      db.prepare('DELETE FROM transcript_facts WHERE thread_id = ?').run(threadId)
      db.prepare('DELETE FROM thread_daily_usage WHERE thread_id = ?').run(threadId)
      db.prepare('DELETE FROM context_usage WHERE thread_id = ?').run(threadId)
    })

    reset()
  }

  const applyTranscriptBatch = ({
    threadId,
    transcriptPath,
    reset = false,
    facts = [],
    checkpoint
  }) => {
    if (typeof threadId !== 'string' || !threadId) {
      throw new Error('Transcript batch thread id is required.')
    }

    if (typeof transcriptPath !== 'string' || !transcriptPath || !checkpoint || typeof checkpoint !== 'object') {
      throw new Error('Transcript batch checkpoint is invalid.')
    }

    if (!Array.isArray(facts)) {
      throw new Error('Transcript batch facts must be an array.')
    }

    // Facts and their byte offset are one recovery unit. Rolling both back
    // prevents token deltas from being counted twice after a process crash.
    const commit = db.transaction(() => {
      if (reset) {
        resetTranscriptFacts(threadId)
      }

      if (facts.length > 0) {
        applyFacts(facts)
      }

      saveCheckpoint(transcriptPath, checkpoint)
    })

    commit()

    return {
      checkpoint,
      factsProcessed: facts.length,
      reset: Boolean(reset)
    }
  }

  return {
    ...base,
    acceptHook,
    applyFacts,
    applyHookBatch,
    applyTranscriptBatch,
    compactIfNeeded,
    commitProjection,
    deleteHooks,
    deleteRuntimeSignal,
    getCheckpoint,
    getDailyUsage,
    getMeta: readMeta,
    getProjection,
    getRuntimeSignals,
    getSidecarData: () => ({
      ...base.getSidecarData(),
      schemaVersion: ENGINE_SCHEMA_VERSION
    }),
    getTranscriptFacts,
    listChangesAfter,
    listPendingHooks,
    markHookProcessed,
    purgeProcessedHooks,
    resetTranscriptFacts,
    saveCheckpoint,
    setMeta: (key, value) => {
      writeMeta.run(String(key), String(value))
    },
    setRuntimeSignal,
    trimChangeLog
  }
}

const readCleanShutdownMarker = enginePath => {
  const db = new Database(enginePath, {
    readonly: true,
    fileMustExist: true
  })

  try {
    return db.prepare('SELECT value FROM projection_meta WHERE key = ?').get(CLEAN_SHUTDOWN_META_KEY)?.value || null
  } catch {
    return null
  } finally {
    db.close()
  }
}

const verifyEngineDatabase = (enginePath, { mode = 'full' } = {}) => {
  const store = mode === 'full' ? createProjectionStore(enginePath) : null
  const db = store?.db || new Database(enginePath, {
    fileMustExist: true
  })

  try {
    const pragma = mode === 'quick' ? 'quick_check' : 'integrity_check'
    const integrity = db.pragma(pragma, { simple: true })

    if (integrity !== 'ok') {
      throw new Error(`Sidecar v2 database ${pragma} failed: ${integrity}`)
    }

    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    if (store) {
      store.close()
    } else {
      db.close()
    }
  }
}

const prepareEngineDatabase = async ({ sourcePath, enginePath, backupPath }) => {
  if (!enginePath || !backupPath) {
    throw new Error('Engine and backup database paths are required.')
  }

  await fsp.mkdir(path.dirname(enginePath), { recursive: true })

  if (await pathExists(enginePath)) {
    const cleanShutdown = readCleanShutdownMarker(enginePath) === '1'

    if (!cleanShutdown) {
      verifyEngineDatabase(enginePath, {
        mode: 'quick'
      })
    }

    return {
      migrated: false,
      enginePath,
      backupPath,
      verification: cleanShutdown ? 'skipped' : 'quick'
    }
  }

  const candidatePath = `${enginePath}.${process.pid}.${Date.now()}.migrating`
  const sourceExists = Boolean(sourcePath && await pathExists(sourcePath))

  try {
    if (sourceExists) {
      const sourceDb = new Database(sourcePath, {
        readonly: true,
        fileMustExist: true
      })

      try {
        if (!await pathExists(backupPath)) {
          await sourceDb.backup(backupPath)
        }

        await sourceDb.backup(candidatePath)
      } finally {
        sourceDb.close()
      }
    }

    verifyEngineDatabase(candidatePath, {
      mode: 'full'
    })
    await fsp.rename(candidatePath, enginePath)

    return {
      migrated: sourceExists,
      enginePath,
      backupPath,
      verification: 'full'
    }
  } catch (error) {
    await fsp.rm(candidatePath, { force: true }).catch(() => undefined)
    throw error
  }
}

module.exports = {
  ENGINE_SCHEMA_VERSION,
  createProjectionStore,
  prepareEngineDatabase
}
