const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MAX_ENGINE_MESSAGE_BYTES,
  createErrorResponse,
  createRequest,
  createSuccessResponse,
  parseEngineMessage
} = require('./protocol.cjs')

test('accepts a declared data-engine request', () => {
  assert.deepEqual(parseEngineMessage({
    type: 'request',
    id: 7,
    operation: 'projection.get',
    payload: null
  }), {
    type: 'request',
    id: 7,
    operation: 'projection.get',
    payload: null
  })
})

test('rejects undeclared operations before dispatch', () => {
  assert.throws(
    () => parseEngineMessage({
      type: 'request',
      id: 8,
      operation: 'eval',
      payload: 'process.exit()'
    }),
    /Unsupported data-engine operation/
  )
})

test('rejects messages that exceed the protocol byte budget', () => {
  assert.throws(
    () => parseEngineMessage({
      type: 'request',
      id: 9,
      operation: 'projection.get',
      payload: 'x'.repeat(MAX_ENGINE_MESSAGE_BYTES)
    }),
    /exceeds/
  )
})

test('builds structured-clone-safe request and response envelopes', () => {
  assert.deepEqual(createRequest(1, 'engine.health', undefined), {
    type: 'request',
    id: 1,
    operation: 'engine.health',
    payload: null
  })
  assert.deepEqual(createSuccessResponse(1, { ready: true }), {
    type: 'response',
    id: 1,
    ok: true,
    value: { ready: true }
  })
  assert.deepEqual(createErrorResponse(1, new Error('boom')), {
    type: 'response',
    id: 1,
    ok: false,
    error: {
      message: 'boom'
    }
  })
})
