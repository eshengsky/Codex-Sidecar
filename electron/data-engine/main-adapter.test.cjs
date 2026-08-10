const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const {
  createCodexClientProxy,
  createDataEngineStoreClient
} = require('./main-adapter.cjs')

const createSupervisor = () => {
  const events = new EventEmitter()
  const calls = []

  return {
    calls,
    events,
    getHealth: () => ({
      status: 'ready'
    }),
    request: async (operation, payload, options) => {
      calls.push({
        operation,
        options,
        payload
      })

      return {
        operation,
        payload
      }
    },
    start: async () => ({
      generation: 1
    })
  }
}

test('maps Sidecar persistence methods to bounded engine operations', async () => {
  const supervisor = createSupervisor()
  const store = createDataEngineStoreClient(supervisor)

  await store.getSidecarData()
  await store.updateSettings({
    themeMode: 'dark'
  })
  await store.setFavorite({
    type: 'thread',
    id: 'thread-1',
    threadId: 'thread-1'
  }, true)
  await store.saveExplorationRun({
    id: 'run-1'
  })

  assert.deepEqual(supervisor.calls.map(call => ({
    operation: call.operation,
    payload: call.payload
  })), [
    {
      operation: 'sidecarData.get',
      payload: null
    },
    {
      operation: 'settings.update',
      payload: {
        themeMode: 'dark'
      }
    },
    {
      operation: 'favorites.set',
      payload: {
        item: {
          type: 'thread',
          id: 'thread-1',
          threadId: 'thread-1'
        },
        favorite: true
      }
    },
    {
      operation: 'explorations.save',
      payload: {
        id: 'run-1'
      }
    }
  ])
})

test('Codex proxy delegates requests and forwards engine notifications', async () => {
  const supervisor = createSupervisor()
  const client = createCodexClientProxy(supervisor)
  const notifications = []

  client.events.on('notification', message => {
    notifications.push(message)
  })

  await client.connect()
  await client.request('thread/fork', {
    threadId: 'thread-1'
  }, 30000)
  supervisor.events.emit('event', {
    type: 'event',
    event: 'codexNotification',
    value: {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1'
      }
    }
  })

  assert.deepEqual(supervisor.calls[0], {
    operation: 'codex.request',
    payload: {
      method: 'thread/fork',
      params: {
        threadId: 'thread-1'
      },
      timeoutMs: 30000
    },
    options: {
      timeoutMs: 31000
    }
  })
  assert.equal(notifications[0].method, 'turn/completed')
  assert.equal(client.getStatus().connected, true)
  client.dispose()
})
