const { spawn, spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  createErrorResponse,
  createSuccessResponse,
  parseEngineMessage
} = require('./protocol.cjs')
const { createCodexRpcClient } = require('./codex-rpc-client.cjs')
const { createCodexProjectionService } = require('./codex-projection-service.cjs')
const {
  createProjectionStore,
  prepareEngineDatabase
} = require('./projection-store.cjs')
const { createTranscriptIndexer } = require('./transcript-indexer.cjs')

const CODEX_REQUEST_METHODS = new Set([
  'hooks/list',
  'thread/fork',
  'thread/start',
  'turn/start'
])
const HOOK_PROCESS_DEBOUNCE_MS = 120
const HOOK_PROCESS_BATCH_SIZE = 256
const HOOK_RETENTION_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_HOOK_BYTES = 4 * 1024 * 1024
const EXPLORATION_LIST_PROMPT_MAX_LENGTH = 4000

const resolveCodexExecutable = () => {
  if (process.env.CODEX_CLI_PATH) {
    return process.env.CODEX_CLI_PATH
  }

  const bundleCandidates = [
    '/Applications/Codex.app/Contents/Resources/codex',
    path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex')
  ]

  for (const candidate of bundleCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  if (process.platform === 'darwin') {
    const result = spawnSync('mdfind', ['kMDItemCFBundleIdentifier == "com.openai.codex"'], {
      encoding: 'utf8'
    })

    if (result.status === 0) {
      for (const appPath of result.stdout.split('\n').filter(Boolean)) {
        const candidate = path.join(appPath, 'Contents', 'Resources', 'codex')

        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
    }
  }

  const detected = spawnSync('which', ['codex'], {
    encoding: 'utf8'
  })

  return detected.status === 0 && detected.stdout.trim()
    ? detected.stdout.trim()
    : 'codex'
}

const readNativeUnreadFromPath = statePath => {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const ids = state?.['electron-persisted-atom-state']?.['unread-thread-ids-by-host-v1']?.local

    if (!Array.isArray(ids)) {
      return {
        available: false,
        path: statePath,
        count: 0,
        ids: [],
        error: 'missing unread-thread-ids-by-host-v1.local'
      }
    }

    const normalizedIds = ids.filter(value => typeof value === 'string')

    return {
      available: true,
      path: statePath,
      count: normalizedIds.length,
      ids: normalizedIds,
      error: null
    }
  } catch (error) {
    return {
      available: false,
      path: statePath,
      count: 0,
      ids: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

const createSmokeCodexClient = () => {
  const events = new EventEmitter()

  return {
    connect: async () => {},
    dispose: () => {},
    events,
    getStatus: () => ({
      connected: true,
      lastError: null
    }),
    request: async method => {
      if (method === 'thread/list') {
        return {
          data: [],
          nextCursor: null
        }
      }

      if (method === 'account/rateLimits/read') {
        return {
          rateLimits: null
        }
      }

      if (method === 'account/usage/read') {
        return {
          summary: {
            lifetimeTokens: 0,
            peakDailyTokens: 0,
            longestRunningTurnSec: 0,
            currentStreakDays: 0,
            longestStreakDays: 0
          },
          dailyUsageBuckets: []
        }
      }

      throw new Error(`Unsupported smoke app-server method: ${String(method)}`)
    }
  }
}

const hookEventNameFromFile = fileName => {
  if (typeof fileName !== 'string' || !fileName.endsWith('.json')) {
    return ''
  }

  return fileName.slice(0, -5).split('.')[2] || ''
}

const hookCapturedAtFromFile = fileName => {
  const timestamp = typeof fileName === 'string' ? fileName.split('.')[0] : ''

  if (!/^\d{14}$/.test(timestamp)) {
    return null
  }

  const parts = [
    Number(timestamp.slice(0, 4)),
    Number(timestamp.slice(4, 6)),
    Number(timestamp.slice(6, 8)),
    Number(timestamp.slice(8, 10)),
    Number(timestamp.slice(10, 12)),
    Number(timestamp.slice(12, 14))
  ]
  const parsed = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])

  if (
    parsed.getFullYear() !== parts[0] ||
    parsed.getMonth() !== parts[1] - 1 ||
    parsed.getDate() !== parts[2] ||
    parsed.getHours() !== parts[3] ||
    parsed.getMinutes() !== parts[4] ||
    parsed.getSeconds() !== parts[5]
  ) {
    return null
  }

  return parsed.getTime()
}

const extractThreadTurnPreviews = response => {
  const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : []
  const previews = []

  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : []
    const assistant = [...items].reverse().find(item =>
      item?.type === 'agentMessage' &&
      item.phase === 'final_answer' &&
      typeof item.text === 'string' &&
      item.text.trim()
    )
    const user = items.find(item => item?.type === 'userMessage')

    if (!user) {
      continue
    }

    const text = Array.isArray(user.content)
      ? user.content
        .filter(content => content?.type === 'input_text' && typeof content.text === 'string')
        .map(content => content.text)
        .join(' ')
      : typeof user.text === 'string'
        ? user.text
        : ''
    const preview = text.replace(/\s+/g, ' ').trim()

    if (!preview) {
      continue
    }

    previews.push({
      id: `${turn.id || `turn-${previews.length + 1}`}:${user.id || previews.length}`,
      turnId: turn.id || `turn-${previews.length + 1}`,
      userItemId: user.id || '',
      userPreview: preview.slice(0, 600),
      userSearchText: preview.slice(0, 120),
      assistantItemId: assistant?.id || '',
      assistantPreview: assistant?.text?.replace(/\s+/g, ' ').trim().slice(0, 600) || '',
      createdAt: Number.isFinite(turn.startedAt ?? turn.completedAt)
        ? (turn.startedAt ?? turn.completedAt) * 1000
        : null,
      index: previews.length + 1
    })
  }

  return previews
}

const toContinuationSnapshot = result => ({
  ...result,
  summary: '',
  prompt: ''
})

const toExplorationListItem = run => ({
  ...run,
  prompt: String(run?.prompt || '').slice(0, EXPLORATION_LIST_PROMPT_MAX_LENGTH),
  candidates: Array.isArray(run?.candidates)
    ? run.candidates.map(candidate => ({
        ...candidate,
        output: ''
      }))
    : [],
  summary: {
    ...(run?.summary || {}),
    output: ''
  }
})

const projectCodexMutationResponse = (method, response) => {
  if (method === 'thread/fork' || method === 'thread/start') {
    return {
      thread: {
        id: response?.thread?.id || null
      }
    }
  }

  if (method === 'turn/start') {
    return {
      turn: {
        id: response?.turn?.id || null
      }
    }
  }

  return response
}

const readBoundedUtf8File = async (filePath, maxBytes) => {
  const file = await fsp.open(filePath, 'r')
  const buffer = Buffer.alloc(maxBytes + 1)
  let bytesRead = 0

  try {
    while (bytesRead < buffer.length) {
      const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)

      if (result.bytesRead === 0) {
        break
      }

      bytesRead += result.bytesRead
    }
  } finally {
    await file.close()
  }

  if (bytesRead > maxBytes) {
    throw new Error(`Hook payload exceeds ${maxBytes} bytes.`)
  }

  return buffer.subarray(0, bytesRead).toString('utf8')
}

const pathsFromEnvironment = () => {
  const userDataPath = process.env.SIDECAR_USER_DATA_PATH

  if (!userDataPath) {
    throw new Error('SIDECAR_USER_DATA_PATH is required for the Sidecar data engine.')
  }

  return {
    sourceDbPath: process.env.SIDECAR_SOURCE_DB_PATH || path.join(userDataPath, 'sidecar.sqlite'),
    engineDbPath: process.env.SIDECAR_ENGINE_DB_PATH || path.join(userDataPath, 'sidecar-v2.sqlite'),
    backupDbPath: process.env.SIDECAR_BACKUP_DB_PATH || path.join(userDataPath, 'sidecar-v1.backup.sqlite'),
    hookEventsDir: process.env.SIDECAR_HOOK_EVENTS_DIR || path.join(userDataPath, 'hook-events'),
    runtimeStatePath: process.env.SIDECAR_RUNTIME_STATE_PATH || path.join(userDataPath, 'runtime-state.json'),
    globalStatePath: process.env.SIDECAR_GLOBAL_STATE_PATH || path.join(os.homedir(), '.codex', '.codex-global-state.json')
  }
}

const createDataEngineService = ({
  parentPort,
  paths,
  createClient,
  watchFiles = true,
  maxHookBytes = DEFAULT_MAX_HOOK_BYTES,
  clock = Date.now
}) => {
  if (!parentPort || !paths?.engineDbPath) {
    throw new Error('Data-engine parent port and paths are required.')
  }

  if (!Number.isSafeInteger(maxHookBytes) || maxHookBytes < 1) {
    throw new Error('Hook payload byte limit must be a positive integer.')
  }

  const subscribers = new Set()
  const watchers = new Set()
  let store = null
  let client = null
  let projectionService = null
  let startPromise = null
  let hookTimer = null
  let hookProcessPromise = null
  let hookProcessRequested = false
  let databaseMaintenancePromise = null
  let stopped = false
  let engineHealth = {
    status: 'starting',
    pid: process.pid,
    lastError: null
  }

  const getSidecarSnapshot = () => {
    const data = store.getSidecarData()
    const continuationResults = {}

    for (const [threadId, result] of Object.entries(data.continuationResults || {})) {
      continuationResults[threadId] = toContinuationSnapshot(result)
    }

    return {
      ...data,
      continuationResults
    }
  }

  const listExplorationSnapshots = () => store.listExplorationRuns().map(toExplorationListItem)

  const assertAbsoluteFilePath = filePath => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('An absolute data file path is required.')
    }

    return filePath
  }

  const writeJsonAtomic = async (filePath, value) => {
    const targetPath = assertAbsoluteFilePath(filePath)
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`

    await fsp.mkdir(path.dirname(targetPath), {
      recursive: true
    })
    await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fsp.rename(tempPath, targetPath)
  }

  const postToParent = message => {
    parentPort.postMessage(message)
  }

  const reportHealth = patch => {
    engineHealth = {
      ...engineHealth,
      ...patch
    }
    postToParent({
      type: 'health',
      health: {
        ...engineHealth
      }
    })
  }

  const broadcastProjection = projection => {
    const message = {
      type: 'projection',
      projection
    }

    postToParent(message)

    for (const subscriber of [...subscribers]) {
      try {
        subscriber.port.postMessage({
          ...message,
          generation: subscriber.generation
        })
      } catch {
        subscribers.delete(subscriber)
      }
    }
  }

  const importRuntimeState = async () => {
    if (store.getMeta('runtimeStateImported') === '1') {
      return
    }

    try {
      const state = JSON.parse(await fsp.readFile(paths.runtimeStatePath, 'utf8'))
      const threads = state?.threads && typeof state.threads === 'object'
        ? state.threads
        : {}

      for (const [threadKey, signal] of Object.entries(threads)) {
        if (signal && typeof signal === 'object' && typeof signal.status === 'string') {
          store.setRuntimeSignal(threadKey, signal)
        }
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error
      }
    }

    store.setMeta('runtimeStateImported', '1')
  }

  const quarantineHookFile = async (fileName, error) => {
    const sourcePath = path.join(paths.hookEventsDir, fileName)
    const quarantineDir = path.join(paths.hookEventsDir, 'quarantine')
    const targetPath = path.join(quarantineDir, fileName)

    await fsp.mkdir(quarantineDir, {
      recursive: true
    })
    store.acceptHook({
      id: fileName,
      eventName: hookEventNameFromFile(fileName) || 'Invalid',
      payload: {
        invalid: true
      },
      receivedAt: clock()
    })
    store.markHookProcessed(fileName, {
      error: error instanceof Error ? error.message : String(error),
      processedAt: clock()
    })
    await fsp.rename(sourcePath, targetPath).catch(async renameError => {
      if (renameError?.code === 'EEXIST') {
        await fsp.rm(sourcePath, {
          force: true
        })
        return
      }

      throw renameError
    })
    store.deleteHooks?.([fileName])
  }

  const processHookSnapshot = async () => {
    await fsp.mkdir(paths.hookEventsDir, {
      recursive: true
    })

    const fileNames = (await fsp.readdir(paths.hookEventsDir))
      .filter(fileName => !fileName.startsWith('.') && fileName.endsWith('.json'))
      .sort()

    if (fileNames.length === 0 || stopped) {
      return projectionService.getProjection()
    }

    const now = clock()
    const staleFileNames = []
    const currentFileNames = []

    for (const fileName of fileNames) {
      const capturedAt = hookCapturedAtFromFile(fileName)

      if (capturedAt !== null && now - capturedAt > HOOK_RETENTION_MS) {
        staleFileNames.push(fileName)
      } else {
        currentFileNames.push(fileName)
      }
    }

    reportHealth({
      hookBacklog: {
        remaining: fileNames.length
      }
    })

    let discardedFileCount = 0

    // Hook captures are a crash-recovery inbox, not a permanent event log.
    // Once they are older than the recovery window, app-server state,
    // transcripts and imported runtime signals are the authoritative sources.
    for (let offset = 0; offset < staleFileNames.length && !stopped; offset += HOOK_PROCESS_BATCH_SIZE) {
      const batch = staleFileNames.slice(offset, offset + HOOK_PROCESS_BATCH_SIZE)

      await Promise.all(batch.map(fileName => {
        return fsp.rm(path.join(paths.hookEventsDir, fileName), {
          force: true
        })
      }))
      store.deleteHooks?.(batch)
      discardedFileCount += batch.length

      if (offset + HOOK_PROCESS_BATCH_SIZE < staleFileNames.length) {
        await new Promise(resolve => setImmediate(resolve))
      }
    }

    let processedFileCount = 0

    for (let offset = 0; offset < currentFileNames.length && !stopped; offset += HOOK_PROCESS_BATCH_SIZE) {
      const batchFileNames = currentFileNames.slice(offset, offset + HOOK_PROCESS_BATCH_SIZE)
      const hooks = []

      for (const fileName of batchFileNames) {
        const filePath = path.join(paths.hookEventsDir, fileName)

        try {
          hooks.push({
            id: fileName,
            eventName: hookEventNameFromFile(fileName),
            payload: JSON.parse(await readBoundedUtf8File(filePath, maxHookBytes)),
            receivedAt: clock()
          })
        } catch (error) {
          await quarantineHookFile(fileName, error)
        }
      }

      if (hooks.length > 0) {
        await projectionService.ingestHooks(hooks, {
          refreshProjection: false
        })

        const deletedHookIds = []

        for (const hook of hooks) {
          await fsp.rm(path.join(paths.hookEventsDir, hook.id), {
            force: true
          })
          deletedHookIds.push(hook.id)
        }

        // The capture file remains the recovery source until both its runtime
        // mutation is committed and the file is deleted. Only then can the
        // payload leave the SQLite inbox instead of growing without bound.
        store.deleteHooks?.(deletedHookIds)
        processedFileCount += deletedHookIds.length
      }

      if (offset + HOOK_PROCESS_BATCH_SIZE < currentFileNames.length) {
        await new Promise(resolve => setImmediate(resolve))
      }
    }

    if (processedFileCount > 0 && !stopped) {
      // A projection refresh lists every thread and checks its transcript.
      // Replaying a backlog must collapse into one refresh, not one per Hook.
      await projectionService.refresh(`hook-replay:${processedFileCount}`)
    }

    reportHealth({
      hookBacklog: {
        discarded: discardedFileCount,
        processed: processedFileCount,
        remaining: 0
      }
    })

    return projectionService.getProjection()
  }

  const processHookFiles = () => {
    hookProcessRequested = true

    if (hookProcessPromise) {
      return hookProcessPromise
    }

    hookProcessPromise = (async () => {
      let projection = projectionService.getProjection()

      do {
        hookProcessRequested = false
        projection = await processHookSnapshot()
      } while (hookProcessRequested && !stopped)

      return projection
    })().finally(() => {
      hookProcessPromise = null
    })

    return hookProcessPromise
  }

  const scheduleHookProcessing = () => {
    if (hookTimer) {
      clearTimeout(hookTimer)
    }

    hookTimer = setTimeout(() => {
      hookTimer = null
      void processHookFiles().catch(error => {
        reportHealth({
          status: 'degraded',
          lastError: error instanceof Error ? error.message : String(error)
        })
      })
    }, HOOK_PROCESS_DEBOUNCE_MS)
    hookTimer.unref?.()
  }

  const scheduleDatabaseMaintenance = () => {
    if (databaseMaintenancePromise) {
      return databaseMaintenancePromise
    }

    databaseMaintenancePromise = projectionService.waitForInitialRefresh()
      .catch(() => undefined)
      .then(() => {
        if (stopped || !store) {
          return null
        }

        const trimmedChanges = store.trimChangeLog()
        const compaction = store.compactIfNeeded()
        const result = {
          trimmedChanges,
          compaction
        }

        reportHealth({
          databaseMaintenance: result
        })

        return result
      })
      .catch(error => {
        reportHealth({
          status: 'degraded',
          lastError: error instanceof Error ? error.message : String(error)
        })

        return null
      })

    return databaseMaintenancePromise
  }

  const startWatchers = () => {
    if (!watchFiles) {
      return
    }

    const hookWatcher = fs.watch(paths.hookEventsDir, {
      persistent: false
    }, scheduleHookProcessing)
    watchers.add(hookWatcher)

    const globalStateDir = path.dirname(paths.globalStatePath)
    const globalStateName = path.basename(paths.globalStatePath)

    try {
      const nativeUnreadWatcher = fs.watch(globalStateDir, {
        persistent: false
      }, (_eventType, changedName) => {
        if (!changedName || changedName.toString() === globalStateName) {
          void projectionService.refresh('native-unread').catch(() => undefined)
        }
      })
      watchers.add(nativeUnreadWatcher)
    } catch {
      // The centralized reconciliation timer remains the correctness fallback
      // when the Codex state directory does not exist yet.
    }
  }

  const dispatch = async (operation, payload) => {
    switch (operation) {
      case 'engine.health':
        return {
          ...engineHealth,
          projectionRevision: projectionService.getProjection().revision
        }
      case 'projection.get':
        return projectionService.getProjection()
      case 'projection.refresh': {
        try {
          const projection = await projectionService.refresh('explicit')

          reportHealth({
            status: 'ready',
            lastError: null
          })
          return projection
        } catch (error) {
          reportHealth({
            status: 'degraded',
            lastError: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }
      case 'sidecarData.get':
        return getSidecarSnapshot()
      case 'settings.update':
        return store.updateSettings(payload)
      case 'favorites.set':
        return store.setFavorite(payload?.item, payload?.favorite)
      case 'prompts.save':
        return store.savePromptTemplates(payload)
      case 'windowState.get':
        return store.getWindowState()
      case 'windowState.save':
        return store.saveWindowState(payload)
      case 'continuation.get':
        return store.getContinuationResult(payload?.threadId)
      case 'continuation.save':
        return store.saveContinuationResult(payload)
      case 'continuation.setUnread': {
        const result = store.setContinuationResultUnread(payload?.threadId, payload?.unread)
        return result ? toContinuationSnapshot(result) : null
      }
      case 'data.exportFile': {
        const filePath = assertAbsoluteFilePath(payload?.filePath)

        await writeJsonAtomic(filePath, {
          ...store.getSidecarData(),
          explorations: store.listExplorationRuns()
        })

        return {
          filePath
        }
      }
      case 'data.importFile': {
        const filePath = assertAbsoluteFilePath(payload?.filePath)
        const imported = JSON.parse(await fsp.readFile(filePath, 'utf8'))

        store.replaceSidecarData(imported)
        store.replaceExplorationRuns(Array.isArray(imported?.explorations) ? imported.explorations : [])

        return {
          filePath,
          sidecarData: getSidecarSnapshot(),
          explorations: listExplorationSnapshots()
        }
      }
      case 'explorations.list':
        return listExplorationSnapshots()
      case 'explorations.get':
        return store.getExplorationRun(payload?.runId)
      case 'explorations.save':
        return store.saveExplorationRun(payload)
      case 'explorations.delete':
        return store.deleteExplorationRun(payload?.runId)
      case 'codex.request': {
        const method = payload?.method

        if (!CODEX_REQUEST_METHODS.has(method)) {
          throw new Error(`Unsupported Codex app-server method: ${String(method)}`)
        }

        await client.connect()
        const response = await client.request(method, payload?.params, payload?.timeoutMs)

        return projectCodexMutationResponse(method, response)
      }
      case 'thread.turnPreviews': {
        const threadId = typeof payload?.threadId === 'string' ? payload.threadId.trim() : ''

        if (!threadId) {
          throw new Error('Thread id is required.')
        }

        await client.connect()
        const response = await client.request('thread/read', {
          threadId,
          includeTurns: true
        }, 15000)

        return {
          threadId,
          turnPreviews: extractThreadTurnPreviews(response)
        }
      }
      default:
        throw new Error(`Unsupported data-engine operation: ${String(operation)}`)
    }
  }

  const handleParentMessage = async event => {
    const rawMessage = event?.data ?? event
    const ports = Array.isArray(event?.ports) ? event.ports : []

    if (rawMessage?.type === 'subscribe') {
      const port = ports[0]

      if (!port) {
        return
      }

      const subscriber = {
        generation: Number(rawMessage.generation) || 0,
        port,
        topics: Array.isArray(rawMessage.topics) ? rawMessage.topics : []
      }

      subscribers.add(subscriber)
      port.on?.('close', () => {
        subscribers.delete(subscriber)
      })
      port.start?.()
      port.postMessage({
        type: 'projection',
        generation: subscriber.generation,
        projection: projectionService.getProjection()
      })
      return
    }

    let message

    try {
      message = parseEngineMessage(rawMessage)
    } catch {
      return
    }

    if (message.type !== 'request') {
      return
    }

    try {
      const value = await dispatch(message.operation, message.payload)
      postToParent(createSuccessResponse(message.id, value))
    } catch (error) {
      postToParent(createErrorResponse(message.id, error))
    }
  }

  const start = () => {
    if (startPromise) {
      return startPromise
    }

    startPromise = (async () => {
      const migration = await prepareEngineDatabase({
        sourcePath: paths.sourceDbPath,
        enginePath: paths.engineDbPath,
        backupPath: paths.backupDbPath
      })

      store = createProjectionStore(paths.engineDbPath)
      // This marker describes the previous process lifetime. It is cleared
      // before any live engine mutation and restored only during orderly stop.
      store.setMeta('engineCleanShutdown', '0')
      store.purgeProcessedHooks?.()
      await importRuntimeState()

      client = createClient
        ? createClient()
        : process.env.SIDECAR_ENGINE_SMOKE === '1'
          ? createSmokeCodexClient()
        : createCodexRpcClient({
            resolveExecutable: resolveCodexExecutable,
            spawnProcess: spawn,
            clientInfo: {
              name: 'codex_sidecar',
              title: 'Codex Sidecar',
              version: process.env.SIDECAR_APP_VERSION || '0.0.0'
            },
            onNotification: message => {
              postToParent({
                type: 'event',
                event: 'codexNotification',
                value: message
              })
            }
          })
      projectionService = createCodexProjectionService({
        client,
        store,
        indexer: createTranscriptIndexer(),
        readNativeUnread: () => readNativeUnreadFromPath(paths.globalStatePath),
        clock
      })
      projectionService.events.on('projection', broadcastProjection)
      parentPort.on('message', handleParentMessage)

      await projectionService.start({
        waitForInitialRefresh: false
      })
      startWatchers()

      engineHealth = {
        ...engineHealth,
        status: 'ready',
        lastError: null,
        migrated: migration.migrated,
        verification: migration.verification
      }
      const result = {
        health: {
          ...engineHealth
        },
        projection: projectionService.getProjection()
      }

      postToParent({
        type: 'ready',
        ...result
      })

      // Window readiness is based on the durable last-good projection. The
      // potentially expensive app-server/index pass continues independently so
      // a slow or unavailable Codex service cannot leave a dock-only app.
      void projectionService.waitForInitialRefresh().catch(error => {
        reportHealth({
          status: 'degraded',
          lastError: error instanceof Error ? error.message : String(error)
        })
      })
      scheduleDatabaseMaintenance()

      // Historical Hook recovery is eventual state reconciliation. It must not
      // delay window creation after the initial last-good projection is ready.
      scheduleHookProcessing()

      return result
    })()

    return startPromise
  }

  const stop = async () => {
    if (stopped) {
      return
    }

    stopped = true

    if (hookTimer) {
      clearTimeout(hookTimer)
      hookTimer = null
    }

    for (const watcher of watchers) {
      watcher.close()
    }

    watchers.clear()

    for (const subscriber of subscribers) {
      subscriber.port.close?.()
    }

    subscribers.clear()
    parentPort.off?.('message', handleParentMessage)

    if (hookProcessPromise) {
      await hookProcessPromise.catch(() => undefined)
    }

    const activeProjectionService = projectionService

    activeProjectionService?.events.off('projection', broadcastProjection)
    activeProjectionService?.dispose()
    await activeProjectionService?.waitForInitialRefresh().catch(() => undefined)
    await databaseMaintenancePromise?.catch(() => undefined)
    projectionService = null
    client = null
    store?.setMeta('engineCleanShutdown', '1')
    store?.db.pragma('wal_checkpoint(TRUNCATE)')
    store?.close()
    store = null
  }

  return {
    dispatch,
    getProjection: () => projectionService?.getProjection() || {
      revision: 0,
      codexStore: null
    },
    processHookFiles,
    start,
    stop,
    waitForDatabaseMaintenance: () => databaseMaintenancePromise || Promise.resolve(null),
    waitForInitialRefresh: () => projectionService?.waitForInitialRefresh() || Promise.resolve(null)
  }
}

const runAsUtilityProcess = async () => {
  if (!process.parentPort) {
    throw new Error('Sidecar data-engine utility process requires process.parentPort.')
  }

  const service = createDataEngineService({
    parentPort: process.parentPort,
    paths: pathsFromEnvironment()
  })

  process.once('SIGTERM', () => {
    void service.stop().finally(() => process.exit(0))
  })
  process.once('SIGINT', () => {
    void service.stop().finally(() => process.exit(0))
  })

  try {
    await service.start()
  } catch (error) {
    await service.stop().catch(() => undefined)
    throw error
  }
}

if (require.main === module) {
  runAsUtilityProcess().catch(error => {
    process.parentPort?.postMessage({
      type: 'health',
      health: {
        status: 'failed',
        lastError: error instanceof Error ? error.message : String(error)
      }
    })
    setImmediate(() => {
      process.exit(1)
    })
  })
}

module.exports = {
  CODEX_REQUEST_METHODS,
  createDataEngineService,
  readNativeUnreadFromPath
}
