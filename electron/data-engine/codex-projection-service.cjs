const { EventEmitter } = require('node:events')
const os = require('node:os')
const path = require('node:path')

const { normalizeAccountUsageResponse } = require('../account-usage.cjs')
const { deduplicateThreadsById } = require('./thread-collection.cjs')

const RATE_LIMITS_REFRESH_INTERVAL_MS = 15 * 1000
const ACCOUNT_USAGE_REFRESH_INTERVAL_MS = 60 * 1000
const AUXILIARY_REFRESH_INTERVAL_MS = RATE_LIMITS_REFRESH_INTERVAL_MS
const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000
const TERMINAL_LIFECYCLES = new Set(['completed', 'interrupted', 'failed'])
const DEFAULT_CODEX_CONVERSATION_ROOT = path.join(os.homedir(), 'Documents', 'Codex')

const toLocalDateKey = date => {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const startOfLocalDayMs = timestamp => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const normalizeRateLimitWindow = limitWindow => {
  if (!limitWindow) {
    return null
  }

  const usedPercent = Math.round(limitWindow.usedPercent ?? 0)

  return {
    label: typeof limitWindow.label === 'string' ? limitWindow.label : null,
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    windowDurationMins: limitWindow.windowDurationMins ?? null,
    resetsAt: limitWindow.resetsAt ? limitWindow.resetsAt * 1000 : null
  }
}

const normalizeRateLimits = response => {
  const entries = Object.values(response?.rateLimitsByLimitId || {})
  const limit = entries.find(entry => entry?.limitId === 'codex') || response?.rateLimits || entries[0] || null

  if (!limit) {
    return null
  }

  return {
    limitId: limit.limitId || null,
    limitName: limit.limitName || null,
    primary: normalizeRateLimitWindow(limit.primary),
    secondary: normalizeRateLimitWindow(limit.secondary)
  }
}

const statusKindFromThread = thread => {
  if (thread.status?.type === 'systemError') {
    return 'failed'
  }

  if (thread.status?.type === 'active') {
    const flags = Array.isArray(thread.status.activeFlags) ? thread.status.activeFlags : []

    if (flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')) {
      return 'waiting'
    }

    return 'running'
  }

  return 'idle'
}

const sidecarStatusFromSignals = ({
  completedUnread,
  runtimeStatus,
  runtimeTurnId,
  statusKind,
  latestTurnSignal
}) => {
  const failedLatestTurn = Boolean(latestTurnSignal?.failed || latestTurnSignal?.status === 'failed')
  const runtimeMatchesLatestTurn = Boolean(
    runtimeTurnId &&
    latestTurnSignal?.id &&
    runtimeTurnId === latestTurnSignal.id
  )

  if (
    runtimeStatus === 'failed' ||
    statusKind === 'failed' ||
    ((!runtimeStatus || runtimeMatchesLatestTurn) && failedLatestTurn)
  ) {
    return 'failed'
  }

  if (statusKind === 'waiting' || runtimeStatus === 'waiting') {
    return 'waiting'
  }

  if (statusKind === 'running' || runtimeStatus === 'running') {
    return 'running'
  }

  if (completedUnread) {
    return 'completedUnread'
  }

  if (
    statusKind === 'idle' ||
    latestTurnSignal?.status === 'completed' ||
    latestTurnSignal?.status === 'interrupted'
  ) {
    return 'idle'
  }

  return 'unknown'
}

const latestTurnSignalFromFacts = facts => {
  const lifecycle = facts?.latestLifecycle

  if (!lifecycle?.turnId || !lifecycle.lifecycle) {
    return null
  }

  const statusByLifecycle = {
    started: 'running',
    completed: 'completed',
    interrupted: 'interrupted',
    failed: 'failed'
  }
  const status = statusByLifecycle[lifecycle.lifecycle] || null

  return status
    ? {
        id: lifecycle.turnId,
        status,
        error: null,
        failed: status === 'failed',
        emptyCompleted: false,
        hasAgentOutput: status === 'completed'
      }
    : null
}

const runtimeEntryMatchesThread = (entry, thread) => {
  return Boolean(
    (entry.sessionId && (entry.sessionId === thread.sessionId || entry.sessionId === thread.id)) ||
    (entry.transcriptPath && entry.transcriptPath === thread.path)
  )
}

const findRuntimeRecord = (runtimeSignals, thread) => {
  return Object.entries(runtimeSignals)
    .filter(([, entry]) => runtimeEntryMatchesThread(entry, thread))
    .map(([key, entry]) => ({
      key,
      entry
    }))
    .sort((left, right) => (right.entry.updatedAt || 0) - (left.entry.updatedAt || 0))[0] || null
}

const semanticProjectionSignature = codexStore => {
  if (!codexStore) {
    return ''
  }

  return JSON.stringify({
    ...codexStore,
    generatedAt: 0
  })
}

const listAllThreads = async client => {
  const data = []
  let cursor = null

  do {
    const response = await client.request('thread/list', {
      cursor,
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false
    })

    data.push(...(Array.isArray(response?.data) ? response.data : []))
    cursor = response?.nextCursor || null
  } while (cursor)

  return deduplicateThreadsById(data)
}

const getRecentActivity = (thread, latestTurnStatus, sidecarStatus) => {
  if (sidecarStatus === 'running') {
    return '正在运行'
  }

  if (sidecarStatus === 'waiting') {
    return '等待用户处理'
  }

  if (sidecarStatus === 'failed') {
    return '最近一次任务失败'
  }

  if (latestTurnStatus === 'completed') {
    return '最近一次任务已完成'
  }

  if (latestTurnStatus === 'interrupted') {
    return '最近一次任务已中断'
  }

  return thread.preview || '暂无活动摘要'
}

const getProjectName = cwd => {
  if (!cwd || typeof cwd !== 'string') {
    return '无项目对话'
  }

  const normalizedCwd = path.resolve(cwd)
  const relative = path.relative(DEFAULT_CODEX_CONVERSATION_ROOT, normalizedCwd)

  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    const segments = relative.split(path.sep).filter(Boolean)

    if (segments.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(segments[0])) {
      return '普通对话'
    }
  }

  return path.basename(normalizedCwd) || cwd
}

const normalizeHookEventName = value => {
  const normalized = String(value || '').replace(/[_\-\s]/g, '').toLowerCase()
  const names = {
    userpromptsubmit: 'UserPromptSubmit',
    pretooluse: 'PreToolUse',
    permissionrequest: 'PermissionRequest',
    posttooluse: 'PostToolUse',
    stop: 'Stop'
  }

  return names[normalized] || null
}

const readStringField = (value, keys) => {
  if (!value || typeof value !== 'object') {
    return null
  }

  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key]
    }
  }

  return null
}

const extractHookRuntimeMeta = payload => ({
  eventName: normalizeHookEventName(readStringField(payload, ['hook_event_name', 'hookEventName'])),
  sessionId: readStringField(payload, ['session_id', 'sessionId']),
  turnId: readStringField(payload, ['turn_id', 'turnId']),
  transcriptPath: readStringField(payload, ['transcript_path', 'transcriptPath']),
  cwd: readStringField(payload, ['cwd', 'current_working_directory', 'currentWorkingDirectory'])
})

const hasStructuredFailureMarker = (value, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 10) {
    return false
  }

  if (Array.isArray(value)) {
    return value.some(item => hasStructuredFailureMarker(item, depth + 1))
  }

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey).replace(/[_\-\s]/g, '').toLowerCase()

    if (['status', 'state', 'outcome', 'result'].includes(key) && ['failed', 'failure', 'error', 'exception'].includes(String(rawValue).toLowerCase())) {
      return true
    }

    if (['exitcode', 'exitstatus', 'code'].includes(key) && Number.isFinite(rawValue) && rawValue !== 0) {
      return true
    }

    if (['success', 'ok'].includes(key) && rawValue === false) {
      return true
    }

    if (['failed', 'error', 'failure', 'exception', 'toolerror'].includes(key)) {
      if (rawValue === true || (typeof rawValue === 'string' && rawValue.trim())) {
        return true
      }

      if (rawValue && typeof rawValue === 'object' && Object.keys(rawValue).length > 0) {
        return true
      }
    }

    if (hasStructuredFailureMarker(rawValue, depth + 1)) {
      return true
    }
  }

  return false
}

const runtimeStatusFromHook = (eventName, payload) => {
  if (eventName === 'PermissionRequest') {
    return 'waiting'
  }

  if (eventName === 'UserPromptSubmit' || eventName === 'PreToolUse') {
    return 'running'
  }

  if (eventName === 'PostToolUse') {
    return hasStructuredFailureMarker(payload?.tool_response ?? payload) ? 'failed' : 'running'
  }

  if (eventName === 'Stop') {
    return hasStructuredFailureMarker(payload) ? 'failed' : 'idle'
  }

  return null
}

const createCodexProjectionService = ({
  client,
  store,
  indexer,
  readNativeUnread,
  clock = Date.now,
  reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  auxiliaryIntervalMs = AUXILIARY_REFRESH_INTERVAL_MS,
  scheduleInterval = setInterval,
  clearScheduledInterval = clearInterval
}) => {
  const events = new EventEmitter()
  const persistedCodexStore = store.getProjection()?.codexStore || null
  let refreshPromise = null
  let refreshRequested = false
  let auxiliaryRefreshPromise = null
  let reconcileTimer = null
  let auxiliaryTimer = null
  let initialRefreshPromise = null
  let started = false
  let disposed = false
  let cachedRateLimits = persistedCodexStore?.rateLimits || null
  let cachedAccountUsage = persistedCodexStore?.accountUsage || null
  let rateLimitsUpdatedAt = 0
  let accountUsageUpdatedAt = 0

  const refreshAuxiliary = () => {
    if (auxiliaryRefreshPromise) {
      return auxiliaryRefreshPromise
    }

    auxiliaryRefreshPromise = (async () => {
      const now = clock()
      const shouldRefreshRateLimits = !rateLimitsUpdatedAt || now - rateLimitsUpdatedAt >= RATE_LIMITS_REFRESH_INTERVAL_MS
      const shouldRefreshAccountUsage = !accountUsageUpdatedAt || now - accountUsageUpdatedAt >= ACCOUNT_USAGE_REFRESH_INTERVAL_MS

      if (!shouldRefreshRateLimits && !shouldRefreshAccountUsage) {
        return
      }

      const [rateLimitsResult, accountUsageResult] = await Promise.allSettled([
        shouldRefreshRateLimits
          ? client.request('account/rateLimits/read', undefined, 12000)
          : Promise.resolve(null),
        shouldRefreshAccountUsage
          ? client.request('account/usage/read', undefined, 12000)
          : Promise.resolve(null)
      ])

      if (shouldRefreshRateLimits && rateLimitsResult.status === 'fulfilled') {
        cachedRateLimits = normalizeRateLimits(rateLimitsResult.value)
        rateLimitsUpdatedAt = now
      }

      if (shouldRefreshAccountUsage && accountUsageResult.status === 'fulfilled') {
        cachedAccountUsage = normalizeAccountUsageResponse(accountUsageResult.value, now) || cachedAccountUsage
        accountUsageUpdatedAt = now
      }
    })().finally(() => {
      auxiliaryRefreshPromise = null
    })

    return auxiliaryRefreshPromise
  }

  const indexThreads = async threads => {
    for (const thread of threads) {
      if (!thread?.id || !thread?.path) {
        continue
      }

      const facts = []

      try {
        const result = await indexer.indexTranscript({
          path: thread.path,
          threadId: thread.id,
          threadCreatedAtMs: Number.isFinite(thread.createdAt) ? thread.createdAt * 1000 : null,
          checkpoint: store.getCheckpoint(thread.path),
          onFact: fact => {
            facts.push(fact)
          }
        })

        if (result.unchanged) {
          continue
        }

        store.applyTranscriptBatch({
          threadId: thread.id,
          transcriptPath: thread.path,
          reset: result.reset,
          facts,
          checkpoint: result.checkpoint
        })
      } catch {
        // A missing or temporarily locked transcript must not make the whole
        // projection unavailable; the next centralized reconciliation retries it.
      }
    }
  }

  const reconcileTerminalRuntime = threads => {
    const runtimeSignals = store.getRuntimeSignals()

    for (const thread of threads) {
      const runtime = findRuntimeRecord(runtimeSignals, thread)

      if (!runtime?.entry?.turnId) {
        continue
      }

      const lifecycle = store.getTranscriptFacts(thread.id)?.latestLifecycle

      if (
        lifecycle?.turnId === runtime.entry.turnId &&
        TERMINAL_LIFECYCLES.has(lifecycle.lifecycle)
      ) {
        store.deleteRuntimeSignal(runtime.key)
        delete runtimeSignals[runtime.key]
      }
    }

    return runtimeSignals
  }

  const createLocalTodayEstimate = threads => {
    const now = clock()
    const dateKey = toLocalDateKey(new Date(now))
    const usage = store.getDailyUsage(dateKey)

    return {
      date: dateKey,
      tokens: usage?.tokens || 0,
      source: 'localTranscript',
      threadCount: usage?.threadCount || 0,
      eventCount: usage?.eventCount || 0,
      // An empty aggregate is stable for the day. Using the current clock here
      // would create a new projection revision every reconciliation cycle.
      updatedAt: usage?.updatedAt || startOfLocalDayMs(now)
    }
  }

  const buildProjection = async () => {
    await client.connect()
    const threads = await listAllThreads(client)

    await indexThreads(threads)
    const runtimeSignals = reconcileTerminalRuntime(threads)
    await refreshAuxiliary()

    const nativeUnread = readNativeUnread()
    const unreadSet = new Set(nativeUnread?.available && Array.isArray(nativeUnread.ids) ? nativeUnread.ids : [])
    const contextUsageByThread = store.getContextUsageByThread()
    const summaries = threads.map(thread => {
      const transcriptFacts = store.getTranscriptFacts(thread.id) || {}
      const latestTurnSignal = latestTurnSignalFromFacts(transcriptFacts)
      const runtime = findRuntimeRecord(runtimeSignals, thread)?.entry || null
      const statusKind = statusKindFromThread(thread)
      const unread = Boolean(nativeUnread?.available && unreadSet.has(thread.id))
      const completedUnread = Boolean(
        unread &&
        latestTurnSignal?.status === 'completed' &&
        !latestTurnSignal.failed
      )
      const sidecarStatus = sidecarStatusFromSignals({
        completedUnread,
        runtimeStatus: runtime?.status || null,
        runtimeTurnId: runtime?.turnId || null,
        statusKind,
        latestTurnSignal
      })
      const latestTurnStatus = latestTurnSignal?.status || null

      return {
        id: thread.id,
        sessionId: thread.sessionId,
        title: thread.name || thread.preview || '未命名对话',
        codexTitle: thread.name || thread.preview || '未命名对话',
        preview: thread.preview || '',
        cwd: thread.cwd || '',
        projectName: getProjectName(thread.cwd),
        createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt * 1000 : null,
        updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt * 1000 : null,
        status: thread.status || {
          type: 'notLoaded'
        },
        statusKind,
        sidecarStatus,
        latestTurnStatus,
        lastUserMessagePreview: transcriptFacts.lastUserPreview || thread.preview || '',
        recentActivity: getRecentActivity(thread, latestTurnStatus, sidecarStatus),
        unread,
        completedUnread,
        contextUsage: contextUsageByThread[thread.id] || (
          thread.sessionId ? contextUsageByThread[thread.sessionId] : null
        ) || null,
        gitBranch: thread.gitInfo?.branch || null,
        source: thread.source || null,
        path: thread.path || null
      }
    })
    const localTodayEstimate = createLocalTodayEstimate(threads)
    const accountUsage = {
      ...(cachedAccountUsage || {
        summary: {
          lifetimeTokens: 0,
          peakDailyTokens: 0,
          longestRunningTurnSec: 0,
          currentStreakDays: 0,
          longestStreakDays: 0
        },
        dailyUsageBuckets: [],
        updatedAt: startOfLocalDayMs(clock())
      }),
      localTodayEstimate
    }

    return {
      generatedAt: clock(),
      connection: client.getStatus(),
      nativeUnread: {
        available: Boolean(nativeUnread?.available),
        path: nativeUnread?.path || '',
        count: Number(nativeUnread?.count) || 0,
        error: nativeUnread?.error || null
      },
      rateLimits: cachedRateLimits,
      accountUsage,
      threads: summaries
    }
  }

  const commitIfChanged = codexStore => {
    const current = store.getProjection()

    if (semanticProjectionSignature(current.codexStore) === semanticProjectionSignature(codexStore)) {
      return current
    }

    const committed = store.commitProjection(codexStore)
    events.emit('projection', committed)
    return committed
  }

  const performRefresh = async () => {
    try {
      return commitIfChanged(await buildProjection())
    } catch (error) {
      const current = store.getProjection().codexStore
      const message = error instanceof Error ? error.message : String(error)

      // A failed first app-server read still needs to publish a usable shape.
      // Otherwise the renderer cannot distinguish failure from startup and
      // leaves users on an indefinite skeleton with no recovery feedback.
      try {
        commitIfChanged({
          generatedAt: clock(),
          connection: client.getStatus(),
          nativeUnread: current?.nativeUnread || {
            available: false,
            path: '',
            count: 0,
            error: null
          },
          rateLimits: current?.rateLimits ?? cachedRateLimits ?? null,
          accountUsage: current?.accountUsage ?? cachedAccountUsage ?? null,
          threads: current?.threads || [],
          error: message
        })
      } catch {
        // Preserve the original read failure in health reporting when even the
        // defensive error projection cannot be persisted.
      }

      throw error
    }
  }

  const refreshAuxiliaryProjection = async () => {
    const current = store.getProjection()

    if (!current.codexStore) {
      return current
    }

    await client.connect()
    await refreshAuxiliary()

    // Re-read after the requests because a concurrent full refresh may have
    // committed newer thread state while the lightweight requests were in flight.
    const latest = store.getProjection()
    const localTodayEstimate = latest.codexStore?.accountUsage?.localTodayEstimate ||
      createLocalTodayEstimate(latest.codexStore?.threads || [])
    const accountUsage = {
      ...(cachedAccountUsage || latest.codexStore.accountUsage),
      localTodayEstimate
    }

    return commitIfChanged({
      ...latest.codexStore,
      generatedAt: clock(),
      connection: client.getStatus(),
      rateLimits: cachedRateLimits,
      accountUsage
    })
  }

  const refresh = () => {
    refreshRequested = true

    if (refreshPromise) {
      return refreshPromise
    }

    refreshPromise = (async () => {
      let result = store.getProjection()

      while (refreshRequested && !disposed) {
        refreshRequested = false
        result = await performRefresh()
      }

      return result
    })().finally(() => {
      refreshPromise = null
    })

    return refreshPromise
  }

  const handleNotification = message => {
    if (message?.method) {
      void refresh(`app-server:${message.method}`).catch(() => undefined)
    }
  }

  const handleClientClose = () => {
    void refresh('app-server:close').catch(() => undefined)
  }

  const start = ({ waitForInitialRefresh = true } = {}) => {
    if (!started) {
      started = true
      client.events.on('notification', handleNotification)
      client.events.on('close', handleClientClose)
      initialRefreshPromise = refresh('startup')

      // Background startup is allowed to fail without producing a process-level
      // unhandled rejection. Callers can still await the original promise to
      // surface the error in health reporting or packaged smoke verification.
      initialRefreshPromise.catch(() => undefined)

      if (reconcileIntervalMs > 0) {
        reconcileTimer = scheduleInterval(() => {
          void refresh('periodic-reconciliation').catch(() => undefined)
        }, reconcileIntervalMs)
        reconcileTimer.unref?.()
      }

      if (auxiliaryIntervalMs > 0) {
        auxiliaryTimer = scheduleInterval(() => {
          void refreshAuxiliaryProjection().catch(() => undefined)
        }, auxiliaryIntervalMs)
        auxiliaryTimer.unref?.()
      }
    }

    return waitForInitialRefresh
      ? initialRefreshPromise
      : Promise.resolve(store.getProjection())
  }

  const normalizeHookMutation = ({ id, eventName: rawEventName, payload, receivedAt = clock() }) => {
    const meta = extractHookRuntimeMeta(payload)
    const eventName = normalizeHookEventName(meta.eventName || rawEventName)
    const status = runtimeStatusFromHook(eventName, payload)
    const key = meta.sessionId
      ? `session:${meta.sessionId}`
      : meta.transcriptPath
        ? `transcript:${meta.transcriptPath}`
        : null

    let runtime = null

    if (key && status === 'idle') {
      runtime = {
        action: 'delete',
        key
      }
    } else if (key && status) {
      runtime = {
        action: 'set',
        key,
        signal: {
          status,
          updatedAt: receivedAt,
          eventName,
          sessionId: meta.sessionId,
          turnId: meta.turnId,
          transcriptPath: meta.transcriptPath,
          cwd: meta.cwd
        }
      }
    }

    return {
      id,
      eventName: eventName || rawEventName || 'Unknown',
      payload,
      receivedAt,
      processedAt: clock(),
      runtime
    }
  }

  const applyHookMutations = mutations => {
    if (store.applyHookBatch) {
      return store.applyHookBatch(mutations)
    }

    let accepted = 0

    for (const mutation of mutations) {
      if (store.acceptHook && !store.acceptHook(mutation)) {
        continue
      }

      if (mutation.runtime?.action === 'delete') {
        store.deleteRuntimeSignal(mutation.runtime.key)
      } else if (mutation.runtime?.action === 'set') {
        store.setRuntimeSignal(mutation.runtime.key, mutation.runtime.signal)
      }

      store.markHookProcessed?.(mutation.id, {
        processedAt: mutation.processedAt
      })
      accepted += 1
    }

    return accepted
  }

  const ingestHooks = async (hooks, { refreshProjection = true } = {}) => {
    if (!Array.isArray(hooks) || hooks.length === 0) {
      return store.getProjection()
    }

    const mutations = hooks.map(normalizeHookMutation)
    const accepted = applyHookMutations(mutations)

    if (!refreshProjection || accepted === 0) {
      return store.getProjection()
    }

    return refresh(`hook-batch:${accepted}`)
  }

  const ingestHook = async hook => {
    return ingestHooks([hook])
  }

  const dispose = () => {
    disposed = true

    if (reconcileTimer) {
      clearScheduledInterval(reconcileTimer)
      reconcileTimer = null
    }

    if (auxiliaryTimer) {
      clearScheduledInterval(auxiliaryTimer)
      auxiliaryTimer = null
    }

    client.events.off('notification', handleNotification)
    client.events.off('close', handleClientClose)
    client.dispose()
  }

  return {
    dispose,
    events,
    getProjection: () => store.getProjection(),
    ingestHook,
    ingestHooks,
    refresh,
    refreshAuxiliaryProjection,
    start,
    waitForInitialRefresh: () => initialRefreshPromise || Promise.resolve(store.getProjection())
  }
}

module.exports = {
  createCodexProjectionService,
  sidecarStatusFromSignals,
  statusKindFromThread
}
