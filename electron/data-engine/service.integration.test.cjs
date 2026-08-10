const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Database = require('better-sqlite3')

const { createSidecarStore } = require('../sidecar-store.cjs')
const { createDataEngineService } = require('./service.cjs')

const createParentPort = () => {
  const port = new EventEmitter()
  port.sent = []
  port.postMessage = message => {
    port.sent.push(message)
  }
  return port
}

const waitForResponse = async (parentPort, id) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = parentPort.sent.find(message => message.type === 'response' && message.id === id)

    if (response) {
      return response
    }

    await new Promise(resolve => setImmediate(resolve))
  }

  throw new Error(`Timed out waiting for response ${id}.`)
}

const withServiceFixture = async (run, options = {}) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-data-engine-service-'))
  const sourceDbPath = path.join(directory, 'sidecar.sqlite')
  const engineDbPath = path.join(directory, 'sidecar-v2.sqlite')
  const backupDbPath = path.join(directory, 'sidecar-v1.backup.sqlite')
  const hookEventsDir = path.join(directory, 'hook-events')
  const runtimeStatePath = path.join(directory, 'runtime-state.json')
  const globalStatePath = path.join(directory, 'global-state.json')
  const transcriptPath = path.join(directory, 'thread.jsonl')
  const source = createSidecarStore(sourceDbPath)

  source.updateSettings({
    themeMode: 'dark'
  })
  source.close()

  await fsp.mkdir(hookEventsDir, {
    recursive: true
  })
  for (const [fileName, payload] of Object.entries(options.initialHooks || {})) {
    await fsp.writeFile(path.join(hookEventsDir, fileName), `${JSON.stringify(payload)}\n`)
  }
  await fsp.writeFile(runtimeStatePath, `${JSON.stringify({
    schemaVersion: 1,
    threads: {
      'session:thread-1': {
        status: 'running',
        updatedAt: 100,
        eventName: 'PostToolUse',
        sessionId: 'thread-1',
        turnId: 'turn-1',
        transcriptPath,
        cwd: directory
      }
    }
  })}\n`)
  await fsp.writeFile(transcriptPath, `${JSON.stringify({
    timestamp: '2026-08-05T03:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'turn-1',
      last_agent_message: 'done'
    }
  })}\n`)
  await fsp.writeFile(globalStatePath, `${JSON.stringify({
    'electron-persisted-atom-state': {
      'unread-thread-ids-by-host-v1': {
        local: []
      }
    }
  })}\n`)

  const clientEvents = new EventEmitter()
  let releaseFirstConnect
  const firstConnectStarted = new Promise(resolve => {
    clientEvents.once('firstConnectStarted', resolve)
  })
  let releaseFirstThreadList
  const firstThreadListStarted = new Promise(resolve => {
    clientEvents.once('firstThreadListStarted', resolve)
  })
  let releaseSecondThreadList
  const secondThreadListStarted = new Promise(resolve => {
    clientEvents.once('secondThreadListStarted', resolve)
  })
  const client = {
    connectCount: 0,
    threadListCount: 0,
    connect: async () => {
      client.connectCount += 1

      if (options.blockFirstConnect && client.connectCount === 1) {
        clientEvents.emit('firstConnectStarted')
        await new Promise(resolve => {
          releaseFirstConnect = resolve
        })
      }
    },
    dispose: () => {
      releaseFirstConnect?.()
      releaseSecondThreadList?.()
    },
    releaseFirstConnect: () => {
      releaseFirstConnect?.()
    },
    firstConnectStarted,
    events: clientEvents,
    getStatus: () => ({
      connected: true,
      lastError: null
    }),
    request: async method => {
      if (method === 'thread/list') {
        client.threadListCount += 1

        if (options.rejectFirstThreadList && client.threadListCount === 1) {
          throw new Error('fixture app-server unavailable')
        }

        if (options.blockFirstThreadList && client.threadListCount === 1) {
          clientEvents.emit('firstThreadListStarted')
          await new Promise(resolve => {
            releaseFirstThreadList = resolve
          })
        }

        if (options.blockSecondThreadList && client.threadListCount === 2) {
          clientEvents.emit('secondThreadListStarted')
          await new Promise(resolve => {
            releaseSecondThreadList = resolve
          })
        }

        return {
          data: [{
            id: 'thread-1',
            sessionId: 'thread-1',
            name: 'Thread 1',
            preview: 'Preview',
            cwd: directory,
            createdAt: 1_754_358_400,
            updatedAt: 1_754_358_400,
            status: {
              type: 'notLoaded'
            },
            path: transcriptPath
          }],
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

      if (method === 'thread/fork') {
        return {
          thread: {
            id: 'fork-thread',
            turns: [{
              items: [{
                type: 'agentMessage',
                text: 'large response that must stay inside the engine'
              }]
            }]
          }
        }
      }

      throw new Error(`Unexpected app-server method: ${method}`)
    },
    releaseFirstThreadList: () => {
      releaseFirstThreadList?.()
    },
    firstThreadListStarted,
    releaseSecondThreadList: () => {
      releaseSecondThreadList?.()
    },
    secondThreadListStarted
  }
  const parentPort = createParentPort()
  const service = createDataEngineService({
    parentPort,
    paths: {
      sourceDbPath,
      engineDbPath,
      backupDbPath,
      hookEventsDir,
      runtimeStatePath,
      globalStatePath
    },
    createClient: () => client,
    watchFiles: options.watchFiles ?? false,
    maxHookBytes: options.maxHookBytes,
    clock: () => Date.parse('2026-08-05T04:00:00.000Z')
  })

  try {
    await run({
      client,
      directory,
      engineDbPath,
      hookEventsDir,
      parentPort,
      service
    })
  } finally {
    await service.stop()
    await fsp.rm(directory, {
      recursive: true,
      force: true
    })
  }
}

test('creates the Hook inbox before starting filesystem watchers on first launch', async () => {
  await withServiceFixture(async ({ hookEventsDir, service }) => {
    await fsp.rm(hookEventsDir, {
      recursive: true,
      force: true
    })

    const ready = await service.start()
    const inbox = await fsp.stat(hookEventsDir)

    assert.equal(ready.health.status, 'ready')
    assert.equal(ready.health.hookWatcher.status, 'ready')
    assert.equal(inbox.isDirectory(), true)
  }, {
    watchFiles: true
  })
})

test('starts from a v1 database, imports runtime state and publishes the first projection', async () => {
  await withServiceFixture(async ({ parentPort, service }) => {
    const ready = await service.start()
    const readyMessage = parentPort.sent.find(message => message.type === 'ready')
    const refreshed = await service.waitForInitialRefresh()

    assert.equal(ready.projection.codexStore, null)
    assert.equal(readyMessage.projection.revision, 0)
    assert.equal(refreshed.codexStore.threads[0].sidecarStatus, 'idle')

    parentPort.emit('message', {
      data: {
        type: 'request',
        id: 1,
        operation: 'sidecarData.get',
        payload: null
      },
      ports: []
    })
    const response = await waitForResponse(parentPort, 1)

    assert.equal(response.ok, true)
    assert.equal(response.value.settings.themeMode, 'dark')
    assert.equal(response.value.schemaVersion, 2)
  })
})

test('publishes ready without waiting for the first app-server projection', async () => {
  await withServiceFixture(async ({ client, parentPort, service }) => {
    const startPromise = service.start()

    try {
      await client.firstThreadListStarted
      await new Promise(resolve => setImmediate(resolve))

      assert.equal(parentPort.sent.some(message => message.type === 'ready'), true)
    } finally {
      client.releaseFirstThreadList()
      await startPromise
    }
  }, {
    blockFirstThreadList: true
  })
})

test('publishes ready without waiting for app-server connection', async () => {
  await withServiceFixture(async ({ client, parentPort, service }) => {
    const startPromise = service.start()

    try {
      await client.firstConnectStarted
      await new Promise(resolve => setImmediate(resolve))

      assert.equal(parentPort.sent.some(message => message.type === 'ready'), true)
    } finally {
      client.releaseFirstConnect()
      await startPromise
      await service.waitForInitialRefresh()
    }
  }, {
    blockFirstConnect: true
  })
})

test('keeps the engine alive and reports degraded health when background startup fails', async () => {
  await withServiceFixture(async ({ service }) => {
    await service.start()
    await assert.rejects(service.waitForInitialRefresh(), /fixture app-server unavailable/)
    await service.waitForDatabaseMaintenance()

    const health = await service.dispatch('engine.health', null)

    assert.equal(health.status, 'degraded')
    assert.match(health.lastError, /fixture app-server unavailable/)
  }, {
    rejectFirstThreadList: true
  })
})

test('marks the database dirty while running and clean after an orderly stop', async () => {
  await withServiceFixture(async ({ engineDbPath, service }) => {
    await service.start()
    await service.waitForInitialRefresh()

    const runningDatabase = new Database(engineDbPath, {
      readonly: true
    })

    try {
      assert.equal(
        runningDatabase.prepare("SELECT value FROM projection_meta WHERE key = 'engineCleanShutdown'").get().value,
        '0'
      )
    } finally {
      runningDatabase.close()
    }

    await service.stop()

    const stoppedDatabase = new Database(engineDbPath, {
      readonly: true
    })

    try {
      assert.equal(
        stoppedDatabase.prepare("SELECT value FROM projection_meta WHERE key = 'engineCleanShutdown'").get().value,
        '1'
      )
    } finally {
      stoppedDatabase.close()
    }
  })
})

test('runs database maintenance after ready without blocking startup', async () => {
  await withServiceFixture(async ({ parentPort, service }) => {
    await service.start()
    await service.waitForDatabaseMaintenance()

    const readyIndex = parentPort.sent.findIndex(message => message.type === 'ready')
    const maintenanceIndex = parentPort.sent.findIndex(message => message.type === 'health' && message.health?.databaseMaintenance)

    assert.equal(readyIndex >= 0, true)
    assert.equal(maintenanceIndex > readyIndex, true)
  })
})

test('publishes ready before replaying a Hook backlog', async () => {
  await withServiceFixture(async ({ client, parentPort, service }) => {
    const startPromise = service.start()

    try {
      await client.secondThreadListStarted
      const readyBeforeReplayCompleted = parentPort.sent.some(message => message.type === 'ready')

      client.releaseSecondThreadList()
      await startPromise
      assert.equal(readyBeforeReplayCompleted, true)
    } finally {
      client.releaseSecondThreadList()
    }
  }, {
    blockSecondThreadList: true,
    initialHooks: {
      '100.1.UserPromptSubmit.json': {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'thread-1',
        turn_id: 'turn-2'
      }
    }
  })
})

test('serves bounded settings commands and sends projections to subscriber ports', async () => {
  await withServiceFixture(async ({ parentPort, service }) => {
    await service.start()

    const subscriber = createParentPort()
    parentPort.emit('message', {
      data: {
        type: 'subscribe',
        generation: 1,
        topics: ['codexProjection']
      },
      ports: [subscriber]
    })
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(subscriber.sent[0].type, 'projection')
    assert.equal(subscriber.sent[0].generation, 1)

    parentPort.emit('message', {
      data: {
        type: 'request',
        id: 2,
        operation: 'settings.update',
        payload: {
          themeMode: 'light'
        }
      },
      ports: []
    })
    const response = await waitForResponse(parentPort, 2)

    assert.equal(response.ok, true)
    assert.equal(response.value.themeMode, 'light')
  })
})

test('commits Hook files before deletion and safely deduplicates a replay', async () => {
  await withServiceFixture(async ({ hookEventsDir, service }) => {
    await service.start()

    const fileName = '100.1.UserPromptSubmit.json'
    const filePath = path.join(hookEventsDir, fileName)
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'thread-1',
      turn_id: 'turn-2'
    }

    await fsp.writeFile(filePath, `${JSON.stringify(payload)}\n`)
    await service.processHookFiles()

    assert.equal(await fsp.access(filePath).then(() => true, () => false), false)
    assert.equal(service.getProjection().codexStore.threads[0].sidecarStatus, 'running')
    const revisionAfterFirst = service.getProjection().revision

    await fsp.writeFile(filePath, `${JSON.stringify(payload)}\n`)
    await service.processHookFiles()

    assert.equal(await fsp.access(filePath).then(() => true, () => false), false)
    assert.equal(service.getProjection().revision, revisionAfterFirst)
  })
})

test('refreshes the projection once for a batch of Hook files', async () => {
  await withServiceFixture(async ({ client, hookEventsDir, service }) => {
    await service.start()
    const initialThreadListCount = client.threadListCount

    for (const [index, eventName] of ['UserPromptSubmit', 'PostToolUse'].entries()) {
      await fsp.writeFile(
        path.join(hookEventsDir, `200.${index}.${eventName}.json`),
        `${JSON.stringify({
          hook_event_name: eventName,
          session_id: 'thread-1',
          turn_id: 'turn-2'
        })}\n`
      )
    }

    await service.processHookFiles()

    assert.equal(client.threadListCount, initialThreadListCount + 1)
  })
})

test('discards stale Hook files without rebuilding the projection', async () => {
  await withServiceFixture(async ({ client, hookEventsDir, service }) => {
    await service.start()
    const initialThreadListCount = client.threadListCount
    const filePath = path.join(hookEventsDir, '20260710165057.100.UserPromptSubmit.json')

    await fsp.writeFile(filePath, `${JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'thread-1',
      turn_id: 'stale-turn'
    })}\n`)
    await service.processHookFiles()

    assert.equal(await fsp.access(filePath).then(() => true, () => false), false)
    assert.equal(client.threadListCount, initialThreadListCount)
    assert.equal(service.getProjection().codexStore.threads[0].sidecarStatus, 'idle')
  })
})

test('removes processed Hook payloads after deleting their durable files', async () => {
  await withServiceFixture(async ({ engineDbPath, hookEventsDir, service }) => {
    await service.start()
    await fsp.writeFile(
      path.join(hookEventsDir, '250.1.PostToolUse.json'),
      `${JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 'thread-1',
        turn_id: 'turn-2',
        output: 'large payload'.repeat(100)
      })}\n`
    )

    await service.processHookFiles()

    const database = new Database(engineDbPath, {
      readonly: true
    })

    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM hook_inbox').get().count, 0)
    } finally {
      database.close()
    }
  })
})

test('keeps list snapshots small while export retains full continuation and exploration content', async () => {
  await withServiceFixture(async ({ directory, service }) => {
    await service.start()
    const longText = 'detail '.repeat(2000)

    await service.dispatch('continuation.save', {
      threadId: 'thread-1',
      sourceUpdatedAt: 100,
      summary: longText,
      prompt: longText,
      completedAt: 200,
      unread: true
    })
    await service.dispatch('explorations.save', {
      id: 'run-1',
      title: 'Large run',
      prompt: longText,
      images: [],
      concurrency: 2,
      sourceThreadId: null,
      sourceThreadTitle: '',
      sourceThreadCwd: '',
      candidates: [{
        id: 'candidate-1',
        index: 0,
        status: 'completed',
        output: longText,
        error: null,
        threadId: 'candidate-thread',
        turnId: 'candidate-turn',
        startedAt: 100,
        completedAt: 200
      }],
      summary: {
        status: 'completed',
        output: longText,
        error: null,
        threadId: 'summary-thread',
        turnId: 'summary-turn',
        startedAt: 100,
        completedAt: 200
      },
      status: 'completed',
      createdAt: 100,
      updatedAt: 200,
      completedAt: 200
    })

    const sidecarData = await service.dispatch('sidecarData.get', null)
    const explorations = await service.dispatch('explorations.list', null)

    assert.equal(sidecarData.continuationResults['thread-1'].summary, '')
    assert.equal(sidecarData.continuationResults['thread-1'].prompt, '')
    assert.equal(explorations[0].prompt.length, 4000)
    assert.equal(explorations[0].candidates[0].output, '')
    assert.equal(explorations[0].summary.output, '')

    const exportPath = path.join(directory, 'export.json')
    await service.dispatch('data.exportFile', {
      filePath: exportPath
    })
    const exported = JSON.parse(await fsp.readFile(exportPath, 'utf8'))

    assert.equal(exported.continuationResults['thread-1'].summary, longText)
    assert.equal(exported.explorations[0].candidates[0].output, longText)
  })
})

test('reconnects and projects app-server mutation responses before crossing into the main process', async () => {
  await withServiceFixture(async ({ client, service }) => {
    await service.start()

    const response = await service.dispatch('codex.request', {
      method: 'thread/fork',
      params: {
        threadId: 'thread-1'
      },
      timeoutMs: 1000
    })

    assert.deepEqual(response, {
      thread: {
        id: 'fork-thread'
      }
    })
    assert.equal(client.connectCount, 2)
  })
})

test('quarantines an oversized Hook without reading it into an unbounded buffer', async () => {
  await withServiceFixture(async ({ hookEventsDir, service }) => {
    await service.start()
    const fileName = '300.1.PostToolUse.json'
    const filePath = path.join(hookEventsDir, fileName)

    await fsp.writeFile(filePath, JSON.stringify({
      hook_event_name: 'PostToolUse',
      session_id: 'thread-1',
      output: 'x'.repeat(1000)
    }))
    await service.processHookFiles()

    assert.equal(await fsp.access(filePath).then(() => true, () => false), false)
    assert.equal(
      await fsp.access(path.join(hookEventsDir, 'quarantine', fileName)).then(() => true, () => false),
      true
    )
  }, {
    maxHookBytes: 128
  })
})
