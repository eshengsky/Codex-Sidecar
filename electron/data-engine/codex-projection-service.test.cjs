const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createCodexProjectionService,
  sidecarStatusFromSignals
} = require('./codex-projection-service.cjs')

const createMemoryStore = ({ runtimeSignals = {}, dailyUsage = null } = {}) => {
  let projection = {
    revision: 0,
    codexStore: null
  }
  const checkpoints = new Map()
  const transcriptFacts = new Map()
  const runtime = new Map(Object.entries(runtimeSignals))
  const contextUsage = {}
  let commitCount = 0
  let transcriptBatchCount = 0

  return {
    applyTranscriptBatch({
      threadId,
      transcriptPath,
      reset = false,
      facts = [],
      checkpoint
    }) {
      transcriptBatchCount += 1
      if (reset) {
        transcriptFacts.delete(threadId)
        delete contextUsage[threadId]
      }

      this.applyFacts(facts)
      checkpoints.set(transcriptPath, checkpoint)
    },
    applyFacts(facts) {
      for (const fact of facts) {
        if (fact.type === 'turnLifecycle') {
          transcriptFacts.set(fact.threadId, {
            ...(transcriptFacts.get(fact.threadId) || {}),
            latestLifecycle: {
              turnId: fact.turnId,
              lifecycle: fact.lifecycle,
              updatedAt: fact.eventTimestamp
            }
          })
        }

        if (fact.type === 'lastUserPreview') {
          transcriptFacts.set(fact.threadId, {
            ...(transcriptFacts.get(fact.threadId) || {}),
            lastUserPreview: fact.preview,
            lastUserPreviewUpdatedAt: fact.eventTimestamp
          })
        }

        if (fact.type === 'contextUsage') {
          contextUsage[fact.threadId] = {
            percent: fact.percent,
            totalTokens: fact.totalTokens,
            modelContextWindow: fact.modelContextWindow,
            updatedAt: fact.updatedAt
          }
        }
      }
    },
    commitProjection(codexStore) {
      commitCount += 1
      projection = {
        revision: projection.revision + 1,
        codexStore
      }
      return projection
    },
    deleteRuntimeSignal(key) {
      runtime.delete(key)
    },
    getCheckpoint(filePath) {
      return checkpoints.get(filePath) || null
    },
    getCommitCount() {
      return commitCount
    },
    getTranscriptBatchCount() {
      return transcriptBatchCount
    },
    getContextUsageByThread() {
      return {
        ...contextUsage
      }
    },
    getDailyUsage() {
      return dailyUsage
    },
    getProjection() {
      return projection
    },
    getRuntimeSignals() {
      return Object.fromEntries(runtime)
    },
    getTranscriptFacts(threadId) {
      return transcriptFacts.get(threadId) || null
    },
    saveCheckpoint(filePath, checkpoint) {
      checkpoints.set(filePath, checkpoint)
    },
    setRuntimeSignal(key, signal) {
      runtime.set(key, signal)
    }
  }
}

const createClient = requestHandler => {
  const events = new EventEmitter()

  return {
    events,
    connect: async () => {},
    dispose: () => {},
    getStatus: () => ({
      connected: true,
      lastError: null
    }),
    request: requestHandler
  }
}

const createThread = patch => ({
  id: 'thread-1',
  sessionId: 'thread-1',
  name: 'Thread 1',
  preview: 'Preview',
  cwd: '/tmp/project',
  createdAt: 1_754_358_400,
  updatedAt: 1_754_358_400,
  status: {
    type: 'notLoaded'
  },
  path: '/tmp/thread-1.jsonl',
  ...patch
})

const createService = ({
  store,
  thread = createThread(),
  indexTranscript = async () => ({
    checkpoint: {
      offset: 0,
      trailing: ''
    },
    factsProcessed: 0
  }),
  requestHandler,
  connectHandler = async () => {},
  clock = () => Date.parse('2026-08-05T02:00:00.000Z'),
  useDefaultIntervals = false,
  scheduleInterval,
  clearScheduledInterval
}) => {
  const calls = []
  const client = createClient(async (method, params) => {
    calls.push({ method, params })

    if (requestHandler) {
      return requestHandler(method, params)
    }

    if (method === 'thread/list') {
      return {
        data: [thread],
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
          lifetimeTokens: 100,
          peakDailyTokens: 100,
          longestRunningTurnSec: 10,
          currentStreakDays: 1,
          longestStreakDays: 1
        },
        dailyUsageBuckets: []
      }
    }

    throw new Error(`Unexpected method: ${method}`)
  })
  client.connect = connectHandler
  const intervalOptions = useDefaultIntervals
    ? {}
    : {
        reconcileIntervalMs: 0,
        auxiliaryIntervalMs: 0
      }
  const service = createCodexProjectionService({
    client,
    store,
    indexer: {
      indexTranscript
    },
    readNativeUnread: () => ({
      available: true,
      path: '/tmp/global-state.json',
      count: 0,
      ids: [],
      error: null
    }),
    clock,
    scheduleInterval,
    clearScheduledInterval,
    ...intervalOptions
  })

  return {
    calls,
    client,
    service
  }
}

test('keeps a Hook-derived running thread visible when thread/list is notLoaded', async () => {
  const store = createMemoryStore({
    runtimeSignals: {
      'session:thread-1': {
        status: 'running',
        sessionId: 'thread-1',
        turnId: 'turn-1',
        transcriptPath: '/tmp/thread-1.jsonl',
        updatedAt: 100
      }
    }
  })
  const { calls, service } = createService({ store })

  await service.refresh('test')

  const projection = service.getProjection()

  assert.equal(projection.codexStore.threads[0].sidecarStatus, 'running')
  assert.equal(calls.some(call => call.method === 'thread/read'), false)
  service.dispose()
})

test('deduplicates overlapping thread pages and keeps the newest record', async () => {
  const store = createMemoryStore()
  const { service } = createService({
    store,
    requestHandler: async (method, params) => {
      if (method === 'thread/list') {
        return params.cursor
          ? {
              data: [
                createThread({
                  id: 'thread-1',
                  name: 'Older duplicate',
                  updatedAt: 1_754_358_300
                }),
                createThread({
                  id: 'thread-2',
                  sessionId: 'thread-2',
                  name: 'Second thread',
                  path: '/tmp/thread-2.jsonl'
                })
              ],
              nextCursor: null
            }
          : {
              data: [createThread({
                id: 'thread-1',
                name: 'Newest record',
                updatedAt: 1_754_358_500
              })],
              nextCursor: 'page-2'
            }
      }

      if (method === 'account/rateLimits/read') {
        return { rateLimits: null }
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

      throw new Error(`Unexpected method: ${method}`)
    }
  })

  await service.refresh('test')

  assert.deepEqual(
    service.getProjection().codexStore.threads.map(thread => [thread.id, thread.title]),
    [
      ['thread-1', 'Newest record'],
      ['thread-2', 'Second thread']
    ]
  )
  service.dispose()
})

test('publishes an error projection when the initial Codex refresh fails', async () => {
  const store = createMemoryStore()
  const { service } = createService({
    store,
    connectHandler: async () => {
      throw new Error('fixture app-server unavailable')
    }
  })
  const projections = []

  service.events.on('projection', projection => {
    projections.push(projection)
  })

  await assert.rejects(service.refresh('test'), /fixture app-server unavailable/)

  assert.equal(service.getProjection().codexStore.error, 'fixture app-server unavailable')
  assert.deepEqual(service.getProjection().codexStore.threads, [])
  assert.equal(projections.length, 1)
  service.dispose()
})

test('a matching transcript terminal fact clears stale Hook runtime', async () => {
  const store = createMemoryStore({
    runtimeSignals: {
      'session:thread-1': {
        status: 'running',
        sessionId: 'thread-1',
        turnId: 'turn-1',
        transcriptPath: '/tmp/thread-1.jsonl',
        updatedAt: 100
      }
    }
  })
  const { service } = createService({
    store,
    indexTranscript: async ({ onFact }) => {
      await onFact({
        type: 'turnLifecycle',
        threadId: 'thread-1',
        turnId: 'turn-1',
        lifecycle: 'completed',
        eventTimestamp: 200
      })

      return {
        checkpoint: {
          offset: 200,
          trailing: ''
        },
        factsProcessed: 1
      }
    }
  })

  await service.refresh('test')

  assert.deepEqual(store.getRuntimeSignals(), {})
  assert.equal(service.getProjection().codexStore.threads[0].sidecarStatus, 'idle')
  service.dispose()
})

test('status priority remains failed, waiting, running, completed unread, idle', () => {
  assert.equal(sidecarStatusFromSignals({
    completedUnread: true,
    runtimeStatus: 'waiting',
    statusKind: 'failed',
    latestTurnSignal: null
  }), 'failed')
  assert.equal(sidecarStatusFromSignals({
    completedUnread: true,
    runtimeStatus: 'waiting',
    statusKind: 'idle',
    latestTurnSignal: null
  }), 'waiting')
  assert.equal(sidecarStatusFromSignals({
    completedUnread: true,
    runtimeStatus: 'running',
    statusKind: 'idle',
    latestTurnSignal: null
  }), 'running')
  assert.equal(sidecarStatusFromSignals({
    completedUnread: true,
    runtimeStatus: null,
    statusKind: 'idle',
    latestTurnSignal: { status: 'completed', failed: false }
  }), 'completedUnread')
  assert.equal(sidecarStatusFromSignals({
    completedUnread: false,
    runtimeStatus: null,
    statusKind: 'idle',
    latestTurnSignal: { status: 'completed', failed: false }
  }), 'idle')
})

test('an identical refresh does not create a new projection revision', async () => {
  const store = createMemoryStore()
  const { service } = createService({ store })

  await service.refresh('first')
  await service.refresh('second')

  assert.equal(store.getCommitCount(), 1)
  assert.equal(service.getProjection().revision, 1)
  service.dispose()
})

test('does not write a transcript batch when the EOF checkpoint is unchanged', async () => {
  const store = createMemoryStore()
  let indexCount = 0
  const { service } = createService({
    store,
    indexTranscript: async () => {
      indexCount += 1

      return {
        checkpoint: {
          offset: 100,
          trailing: ''
        },
        factsProcessed: indexCount === 1 ? 1 : 0,
        unchanged: indexCount > 1
      }
    }
  })

  await service.refresh('first')
  await service.refresh('second')

  assert.equal(store.getTranscriptBatchCount(), 1)
  service.dispose()
})

test('periodic reconciliation does not emit a revision solely because the clock advanced', async () => {
  const store = createMemoryStore()
  let now = Date.parse('2026-08-05T02:00:00.000Z')
  const { service } = createService({
    store,
    clock: () => now
  })

  await service.refresh('first')
  now += 30_000
  await service.refresh('periodic-reconciliation')

  assert.equal(store.getCommitCount(), 1)
  service.dispose()
})

test('refreshes rate limits every 15 seconds and account usage every 60 seconds', async () => {
  const store = createMemoryStore()
  let now = Date.parse('2026-08-05T02:00:00.000Z')
  const { calls, service } = createService({
    store,
    clock: () => now
  })

  await service.refresh('first')
  now += 20_000
  await service.refreshAuxiliaryProjection('auxiliary-timer')

  assert.equal(calls.filter(call => call.method === 'account/rateLimits/read').length, 2)
  assert.equal(calls.filter(call => call.method === 'account/usage/read').length, 1)
  assert.equal(calls.filter(call => call.method === 'thread/list').length, 1)
  service.dispose()
})

test('schedules lightweight auxiliary refreshes and a five-minute safety reconciliation', async () => {
  const store = createMemoryStore()
  const intervals = []
  const cleared = []
  const scheduleInterval = (callback, delay) => {
    const timer = {
      callback,
      delay,
      unref() {}
    }

    intervals.push(timer)
    return timer
  }
  const { service } = createService({
    store,
    useDefaultIntervals: true,
    scheduleInterval,
    clearScheduledInterval: timer => cleared.push(timer)
  })

  await service.start()

  assert.deepEqual(intervals.map(timer => timer.delay).sort((left, right) => left - right), [
    15_000,
    5 * 60 * 1000
  ])

  service.dispose()
  assert.equal(cleared.length, 2)
})

test('refresh requests received during an in-flight refresh coalesce into one follow-up pass', async () => {
  const store = createMemoryStore()
  let releaseFirstList
  let threadListCount = 0
  const firstListBlocked = new Promise(resolve => {
    releaseFirstList = resolve
  })
  const { service } = createService({
    store,
    requestHandler: async method => {
      if (method === 'thread/list') {
        threadListCount += 1

        if (threadListCount === 1) {
          await firstListBlocked
        }

        return {
          data: [createThread()],
          nextCursor: null
        }
      }

      if (method === 'account/rateLimits/read') {
        return { rateLimits: null }
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

      throw new Error(`Unexpected method: ${method}`)
    }
  })

  const first = service.refresh('first')
  const second = service.refresh('second')
  const third = service.refresh('third')

  releaseFirstList()
  await Promise.all([first, second, third])

  assert.equal(threadListCount, 2)
  service.dispose()
})

test('local today usage comes from the persisted daily aggregate', async () => {
  const store = createMemoryStore({
    dailyUsage: {
      dateKey: '2026-08-05',
      tokens: 4321,
      eventCount: 9,
      threadCount: 1,
      updatedAt: 100
    }
  })
  const { service } = createService({ store })

  await service.refresh('test')

  assert.deepEqual(service.getProjection().codexStore.accountUsage.localTodayEstimate, {
    date: '2026-08-05',
    tokens: 4321,
    source: 'localTranscript',
    threadCount: 1,
    eventCount: 9,
    updatedAt: 100
  })
  service.dispose()
})

test('keeps the existing projectless Codex conversation label', async () => {
  const store = createMemoryStore()
  const { service } = createService({
    store,
    thread: createThread({
      cwd: path.join(os.homedir(), 'Documents', 'Codex', '2026-08-05', 'generated-slug')
    })
  })

  await service.refresh('test')

  assert.equal(service.getProjection().codexStore.threads[0].projectName, '普通对话')
  service.dispose()
})

test('each centralized refresh reconnects app-server after a child exit', async () => {
  const store = createMemoryStore()
  let connected = false
  let connectCount = 0
  const { service } = createService({
    store,
    connectHandler: async () => {
      connectCount += 1
      connected = true
    },
    requestHandler: async method => {
      if (!connected) {
        throw new Error('app-server disconnected')
      }

      if (method === 'thread/list') {
        return {
          data: [createThread()],
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

      throw new Error(`Unexpected method: ${method}`)
    }
  })

  await service.start()
  connected = false
  await service.refresh('after-exit')

  assert.equal(connectCount, 2)
  service.dispose()
})

test('an app-server close notification schedules an immediate reconnect', async () => {
  const store = createMemoryStore()
  let connectCount = 0
  const { client, service } = createService({
    store,
    connectHandler: async () => {
      connectCount += 1
    }
  })

  await service.start()
  client.events.emit('close', new Error('app-server exited'))
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(connectCount, 2)
  service.dispose()
})
