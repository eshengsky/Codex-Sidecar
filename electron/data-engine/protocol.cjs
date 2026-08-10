// Full exploration detail is loaded on demand and is capped by the persistence
// normalizers at about 6.2 MiB. List snapshots remain much smaller.
const MAX_ENGINE_MESSAGE_BYTES = 8 * 1024 * 1024

const ENGINE_OPERATIONS = new Set([
  'engine.health',
  'projection.get',
  'projection.refresh',
  'sidecarData.get',
  'settings.update',
  'favorites.set',
  'prompts.save',
  'windowState.get',
  'windowState.save',
  'continuation.get',
  'continuation.save',
  'continuation.setUnread',
  'data.exportFile',
  'data.importFile',
  'explorations.list',
  'explorations.get',
  'explorations.save',
  'explorations.delete',
  'codex.request',
  'thread.turnPreviews'
])

const assertEnvelopeSize = value => {
  let serialized

  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('Data-engine message must be structured-clone safe.')
  }

  if (serialized == null) {
    throw new Error('Data-engine message must be serializable.')
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_ENGINE_MESSAGE_BYTES) {
    throw new Error(`Data-engine message exceeds ${MAX_ENGINE_MESSAGE_BYTES} bytes.`)
  }
}

const assertMessageId = id => {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('Data-engine message id must be a positive safe integer.')
  }
}

const assertOperation = operation => {
  if (!ENGINE_OPERATIONS.has(operation)) {
    throw new Error(`Unsupported data-engine operation: ${String(operation)}`)
  }
}

const parseEngineMessage = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Data-engine message must be an object.')
  }

  assertEnvelopeSize(value)

  if (value.type === 'request') {
    assertMessageId(value.id)
    assertOperation(value.operation)

    return {
      type: 'request',
      id: value.id,
      operation: value.operation,
      payload: value.payload ?? null
    }
  }

  if (value.type === 'response') {
    assertMessageId(value.id)

    if (value.ok === true) {
      return {
        type: 'response',
        id: value.id,
        ok: true,
        value: value.value ?? null
      }
    }

    if (value.ok === false && typeof value.error?.message === 'string') {
      return {
        type: 'response',
        id: value.id,
        ok: false,
        error: {
          message: value.error.message
        }
      }
    }

    throw new Error('Data-engine response is invalid.')
  }

  if (['ready', 'health', 'event', 'projection'].includes(value.type)) {
    return value
  }

  throw new Error(`Unsupported data-engine message type: ${String(value.type)}`)
}

const createRequest = (id, operation, payload = null) => {
  return parseEngineMessage({
    type: 'request',
    id,
    operation,
    payload
  })
}

const createSuccessResponse = (id, value = null) => {
  return parseEngineMessage({
    type: 'response',
    id,
    ok: true,
    value
  })
}

const createErrorResponse = (id, error) => {
  return parseEngineMessage({
    type: 'response',
    id,
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error || 'Unknown data-engine error.')
    }
  })
}

module.exports = {
  ENGINE_OPERATIONS,
  MAX_ENGINE_MESSAGE_BYTES,
  createErrorResponse,
  createRequest,
  createSuccessResponse,
  parseEngineMessage
}
