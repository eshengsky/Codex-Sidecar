const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const test = require('node:test')

const { createCodexRpcClient } = require('./codex-rpc-client.cjs')

const createFakeAppServer = ({ onRequest } = {}) => {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('exit', 0, null)
  }

  let input = ''
  const messages = []

  child.stdin.on('data', chunk => {
    input += chunk.toString('utf8')

    while (input.includes('\n')) {
      const newline = input.indexOf('\n')
      const line = input.slice(0, newline)
      input = input.slice(newline + 1)

      if (!line.trim()) {
        continue
      }

      const message = JSON.parse(line)
      messages.push(message)

      if (message.method === 'initialize' && message.id) {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: { ready: true } })}\n`)
        continue
      }

      onRequest?.(message, child)
    }
  })

  return {
    child,
    messages
  }
}

const createClientWithFake = fake => createCodexRpcClient({
  resolveExecutable: () => '/tmp/codex',
  spawnProcess: () => fake.child,
  clientInfo: {
    name: 'test',
    title: 'Test',
    version: '1'
  },
  onNotification: () => {}
})

test('concurrent connect calls start one app-server process', async () => {
  const fake = createFakeAppServer()
  let spawnCount = 0
  const client = createCodexRpcClient({
    resolveExecutable: () => '/tmp/codex',
    spawnProcess: () => {
      spawnCount += 1
      return fake.child
    },
    clientInfo: {
      name: 'test',
      title: 'Test',
      version: '1'
    },
    onNotification: () => {}
  })

  await Promise.all([client.connect(), client.connect(), client.connect()])

  assert.equal(spawnCount, 1)
  assert.equal(client.getStatus().connected, true)
  client.dispose()
})

test('identical app-server reads share one in-flight protocol request', async () => {
  const pending = []
  const fake = createFakeAppServer({
    onRequest: message => {
      if (message.method === 'thread/list') {
        pending.push(message)
      }
    }
  })
  const client = createClientWithFake(fake)

  await client.connect()

  const first = client.request('thread/list', { limit: 100 })
  const second = client.request('thread/list', { limit: 100 })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 1)

  fake.child.stdout.write(`${JSON.stringify({
    id: pending[0].id,
    result: {
      data: [{ id: 'thread-1' }]
    }
  })}\n`)

  assert.deepEqual(await first, { data: [{ id: 'thread-1' }] })
  assert.deepEqual(await second, { data: [{ id: 'thread-1' }] })
  client.dispose()
})

test('server-initiated requests receive the read-only observer rejection', async () => {
  const fake = createFakeAppServer()
  const client = createClientWithFake(fake)

  await client.connect()
  fake.child.stdout.write(`${JSON.stringify({
    id: 99,
    method: 'item/requestApproval',
    params: {}
  })}\n`)
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(fake.messages.find(message => message.id === 99), {
    id: 99,
    error: {
      code: -32601,
      message: 'Codex Sidecar is a read-only observer and does not handle server-initiated action requests.'
    }
  })
  client.dispose()
})

test('an app-server exit rejects every pending request', async () => {
  const fake = createFakeAppServer()
  const client = createClientWithFake(fake)

  await client.connect()
  const pending = client.request('account/usage/read', undefined, 1000)

  fake.child.emit('exit', 9, null)

  await assert.rejects(pending, /exited with code 9/)
  assert.equal(client.getStatus().connected, false)
})

test('write operations are never coalesced', async () => {
  const writes = []
  const fake = createFakeAppServer({
    onRequest: (message, child) => {
      if (message.method !== 'turn/start') {
        return
      }

      writes.push(message)
      child.stdout.write(`${JSON.stringify({
        id: message.id,
        result: {
          turn: {
            id: `turn-${message.id}`
          }
        }
      })}\n`)
    }
  })
  const client = createClientWithFake(fake)

  await client.connect()
  const [first, second] = await Promise.all([
    client.request('turn/start', { threadId: 'thread-1', input: [] }),
    client.request('turn/start', { threadId: 'thread-1', input: [] })
  ])

  assert.equal(writes.length, 2)
  assert.notEqual(first.turn.id, second.turn.id)
  client.dispose()
})

test('a successful reconnect clears the previous app-server error', async () => {
  const first = createFakeAppServer()
  const second = createFakeAppServer()
  const servers = [first, second]
  const client = createCodexRpcClient({
    resolveExecutable: () => '/tmp/codex',
    spawnProcess: () => servers.shift().child,
    clientInfo: {
      name: 'test',
      title: 'Test',
      version: '1'
    }
  })

  await client.connect()
  first.child.emit('exit', 9, null)
  assert.match(client.getStatus().lastError, /code 9/)

  await client.connect()

  assert.deepEqual(client.getStatus(), {
    connected: true,
    lastError: null
  })
  client.dispose()
})
