const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const { createRendererProjectionStream } = require('./renderer-stream.cjs')

const createFakePort = () => {
  const port = new EventEmitter()
  port.closed = false
  port.started = false
  port.close = () => {
    port.closed = true
  }
  port.start = () => {
    port.started = true
  }
  port.send = data => {
    port.emit('message', {
      data
    })
  }
  return port
}

test('replacing an engine port closes the old generation and continues projection delivery', () => {
  const stream = createRendererProjectionStream()
  const received = []
  const firstPort = createFakePort()
  const secondPort = createFakePort()
  const unsubscribe = stream.subscribe(projection => {
    received.push(projection)
  })

  stream.replacePort(firstPort, 1)
  firstPort.send({
    type: 'projection',
    generation: 1,
    projection: {
      revision: 1
    }
  })
  stream.replacePort(secondPort, 2)
  firstPort.send({
    type: 'projection',
    generation: 1,
    projection: {
      revision: 2
    }
  })
  secondPort.send({
    type: 'projection',
    generation: 2,
    projection: {
      revision: 1
    }
  })

  assert.equal(firstPort.closed, true)
  assert.equal(secondPort.started, true)
  assert.deepEqual(received, [
    {
      generation: 1,
      revision: 1
    },
    {
      generation: 2,
      revision: 1
    }
  ])

  unsubscribe()
  stream.dispose()
  assert.equal(secondPort.closed, true)
})

test('applies only increasing revisions inside the same engine generation', async () => {
  const moduleUrl = pathToFileURL(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'utils',
    'codex-projection.js'
  )).href
  const { hasUsableCodexProjection, shouldApplyProjection } = await import(moduleUrl)

  assert.equal(hasUsableCodexProjection(null), false)
  assert.equal(hasUsableCodexProjection({ threads: [] }), true)

  assert.equal(shouldApplyProjection({
    currentGeneration: 1,
    currentRevision: 12,
    nextGeneration: 1,
    nextRevision: 13
  }), true)
  assert.equal(shouldApplyProjection({
    currentGeneration: 1,
    currentRevision: 12,
    nextGeneration: 1,
    nextRevision: 12
  }), false)
  assert.equal(shouldApplyProjection({
    currentGeneration: 1,
    currentRevision: 12,
    nextGeneration: 1,
    nextRevision: 11
  }), false)
  assert.equal(shouldApplyProjection({
    currentGeneration: 1,
    currentRevision: 12,
    nextGeneration: 2,
    nextRevision: 1
  }), true)
})
