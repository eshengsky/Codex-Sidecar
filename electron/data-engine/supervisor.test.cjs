const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { createDataEngineSupervisor } = require('./supervisor.cjs')

const createFakeChild = () => {
  const child = new EventEmitter()

  child.messages = []
  child.killed = false
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.postMessage = (message, ports = []) => {
    child.messages.push({ message, ports })
  }
  child.kill = () => {
    child.killed = true
  }
  return child
}

test('preserves the engine-reported startup failure when the child exits', async () => {
  const child = createFakeChild()
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => child,
    entryPath: '/tmp/service.cjs',
    schedule: () => ({
      unref() {}
    }),
    clearSchedule: () => {}
  })
  const started = supervisor.start()

  child.emit('message', {
    type: 'health',
    health: {
      status: 'failed',
      lastError: "ENOENT: no such file or directory, watch '/tmp/hook-events'"
    }
  })
  child.emit('exit', 1)

  await assert.rejects(started, /ENOENT: no such file or directory/)
  assert.equal(
    supervisor.getHealth().lastError,
    "ENOENT: no such file or directory, watch '/tmp/hook-events'"
  )
  assert.equal(supervisor.getHealth().lastFailure.exitCode, 1)
  supervisor.dispose()
})

test('uses a bounded stderr tail when a child exits without structured health', async () => {
  const child = createFakeChild()
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => child,
    entryPath: '/tmp/service.cjs',
    schedule: () => ({
      unref() {}
    }),
    clearSchedule: () => {}
  })
  const started = supervisor.start()

  child.stderr.emit('data', Buffer.from(`${'x'.repeat(20_000)}native loader failure\n`))
  child.emit('exit', 1)

  await assert.rejects(started, /native loader failure/)
  assert.ok(supervisor.getHealth().lastFailure.stderr.length <= 16 * 1024)
  assert.match(supervisor.getHealth().lastFailure.stderr, /native loader failure/)
  supervisor.dispose()
})

test('records Electron utility-process fatal error details', async () => {
  const child = createFakeChild()
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => child,
    entryPath: '/tmp/service.cjs',
    schedule: () => ({
      unref() {}
    }),
    clearSchedule: () => {}
  })
  const started = supervisor.start()

  child.emit('error', 'FatalError', 'node_service.cc:42', 'diagnostic report')
  child.emit('exit', 1)

  await assert.rejects(started, /FatalError at node_service\.cc:42/)
  assert.equal(supervisor.getHealth().lastFailure.fatalReport, 'diagnostic report')
  supervisor.dispose()
})

test('requests wait for engine readiness and resolve from the correlated response', async () => {
  const child = createFakeChild()
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => child,
    entryPath: '/tmp/service.cjs'
  })

  const started = supervisor.start()
  const request = supervisor.request('engine.health', null)

  assert.equal(child.messages.length, 0)

  child.emit('message', {
    type: 'ready',
    health: {
      status: 'ready'
    }
  })
  await started
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(child.messages.length, 1)
  assert.equal(child.messages[0].message.operation, 'engine.health')

  child.emit('message', {
    type: 'response',
    id: child.messages[0].message.id,
    ok: true,
    value: {
      status: 'ready'
    }
  })

  assert.deepEqual(await request, {
    status: 'ready'
  })
  supervisor.dispose()
})

test('a crashed engine rejects in-flight requests and schedules a bounded restart', async () => {
  const children = []
  const scheduled = []
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => {
      const child = createFakeChild()
      children.push(child)
      return child
    },
    entryPath: '/tmp/service.cjs',
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay })
      return {
        unref() {}
      }
    },
    clearSchedule: () => {}
  })

  const started = supervisor.start()
  children[0].emit('message', {
    type: 'ready',
    health: {
      status: 'ready'
    }
  })
  await started

  const request = supervisor.request('projection.get', null)
  await new Promise(resolve => setImmediate(resolve))
  children[0].emit('exit', 9)

  await assert.rejects(request, /exited with code 9/)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 250)

  scheduled[0].callback()
  assert.equal(children.length, 2)
  supervisor.dispose()
})

test('registered renderer subscribers are reattached to every ready engine generation', async () => {
  const children = []
  const scheduled = []
  const attachments = []
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => {
      const child = createFakeChild()
      children.push(child)
      return child
    },
    entryPath: '/tmp/service.cjs',
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay })
      return {
        unref() {}
      }
    },
    clearSchedule: () => {}
  })

  supervisor.registerSubscriber({
    id: 'window-1',
    topics: ['codexProjection'],
    attach: ({ child, generation, topics }) => {
      attachments.push({
        child,
        generation,
        topics
      })
    }
  })

  const started = supervisor.start()
  children[0].emit('message', {
    type: 'ready',
    health: {
      status: 'ready'
    }
  })
  await started

  children[0].emit('exit', 1)
  scheduled[0].callback()
  children[1].emit('message', {
    type: 'ready',
    health: {
      status: 'ready'
    }
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(attachments.map(item => ({
    generation: item.generation,
    topics: item.topics
  })), [
    {
      generation: 1,
      topics: ['codexProjection']
    },
    {
      generation: 2,
      topics: ['codexProjection']
    }
  ])
  supervisor.dispose()
})

test('opens the restart circuit after repeated exits in one minute', async () => {
  const children = []
  const scheduled = []
  let now = 1000
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => {
      const child = createFakeChild()
      children.push(child)
      return child
    },
    entryPath: '/tmp/service.cjs',
    clock: () => now,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay })
      return {
        unref() {}
      }
    },
    clearSchedule: () => {}
  })

  const started = supervisor.start()
  children[0].emit('message', {
    type: 'ready',
    health: {
      status: 'ready'
    }
  })
  await started

  for (let index = 0; index < 6; index += 1) {
    const child = children[children.length - 1]
    child.emit('exit', 1)
    now += 100

    const restart = scheduled.shift()

    if (restart) {
      restart.callback()
      children[children.length - 1].emit('message', {
        type: 'ready',
        health: {
          status: 'ready'
        }
      })
    }
  }

  assert.equal(supervisor.getHealth().status, 'failed')
  assert.match(supervisor.getHealth().lastError, /restart limit/)
  supervisor.dispose()
})

test('a failed renderer reattachment does not block engine readiness or other subscribers', async () => {
  const child = createFakeChild()
  const attached = []
  const supervisor = createDataEngineSupervisor({
    forkUtility: () => child,
    entryPath: '/tmp/service.cjs'
  })

  supervisor.registerSubscriber({
    id: 'broken',
    topics: ['codexProjection'],
    attach: () => {
      throw new Error('window was destroyed')
    }
  })
  supervisor.registerSubscriber({
    id: 'healthy',
    topics: ['codexProjection'],
    attach: ({ generation }) => {
      attached.push(generation)
    }
  })

  const started = supervisor.start()

  assert.doesNotThrow(() => {
    child.emit('message', {
      type: 'ready',
      health: {
        status: 'ready'
      }
    })
  })
  await started

  assert.deepEqual(attached, [1])
  supervisor.dispose()
})
