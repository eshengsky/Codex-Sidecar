const { EventEmitter } = require('node:events')
const readline = require('node:readline')

const COALESCIBLE_READ_METHODS = new Set([
  'thread/list',
  'thread/read',
  'account/rateLimits/read',
  'account/usage/read'
])

const stableSerialize = value => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

const createCodexRpcClient = ({
  resolveExecutable,
  spawnProcess,
  clientInfo,
  onNotification = () => {}
}) => {
  if (typeof resolveExecutable !== 'function' || typeof spawnProcess !== 'function') {
    throw new Error('Codex executable resolver and process spawner are required.')
  }

  const events = new EventEmitter()
  const pending = new Map()
  const inFlightReads = new Map()
  let proc = null
  let nextId = 1
  let connected = false
  let connectPromise = null
  let lastError = null
  let stderrTail = ''

  const sendMessage = message => {
    if (!proc || !proc.stdin?.writable) {
      throw new Error('Codex app-server is not connected.')
    }

    proc.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const settlePending = error => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }

    pending.clear()
    inFlightReads.clear()
  }

  const respondToServerRequest = message => {
    sendMessage({
      id: message.id,
      error: {
        code: -32601,
        message: 'Codex Sidecar is a read-only observer and does not handle server-initiated action requests.'
      }
    })
  }

  const handleMessage = message => {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(entry.timer)

      if (message.error) {
        entry.reject(new Error(message.error.message || 'Codex app-server request failed.'))
        return
      }

      entry.resolve(message.result)
      return
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      respondToServerRequest(message)
      return
    }

    if (message.method) {
      onNotification(message)
      events.emit('notification', message)
    }
  }

  const rawRequest = (method, params, timeoutMs = 12000) => new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1

    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timed out waiting for app-server response to ${method}.`))
    }, timeoutMs)

    pending.set(id, {
      method,
      reject,
      resolve,
      timer
    })

    try {
      sendMessage({
        method,
        id,
        params
      })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error)
    }
  })

  const request = (method, params, timeoutMs = 12000) => {
    if (!COALESCIBLE_READ_METHODS.has(method)) {
      return rawRequest(method, params, timeoutMs)
    }

    const key = `${method}:${stableSerialize(params ?? null)}`
    const existing = inFlightReads.get(key)

    if (existing) {
      return existing
    }

    const promise = rawRequest(method, params, timeoutMs).finally(() => {
      if (inFlightReads.get(key) === promise) {
        inFlightReads.delete(key)
      }
    })

    inFlightReads.set(key, promise)
    return promise
  }

  const connectOnce = () => new Promise((resolve, reject) => {
    const codexPath = resolveExecutable()
    const child = spawnProcess(codexPath, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env
      }
    })

    proc = child
    connected = false
    stderrTail = ''

    const lineReader = readline.createInterface({
      input: child.stdout
    })

    lineReader.on('line', line => {
      if (!line.trim()) {
        return
      }

      try {
        handleMessage(JSON.parse(line))
      } catch (error) {
        lastError = error
      }
    })

    child.stderr?.on('data', chunk => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4000)
    })

    child.on('error', error => {
      lastError = error

      if (proc === child) {
        connected = false
        proc = null
        settlePending(error)
      }

      reject(error)
    })

    child.on('exit', (code, signal) => {
      const detail = signal ? ` signal ${signal}` : ` code ${code}`
      const error = new Error(`codex app-server exited with${detail}. ${stderrTail}`.trim())

      lineReader.close()

      if (proc === child) {
        connected = false
        proc = null
        lastError = error
        settlePending(error)
        events.emit('close', error)
      }
    })

    rawRequest('initialize', {
      clientInfo,
      capabilities: {
        experimentalApi: true
      }
    }, 8000)
      .then(result => {
        if (proc !== child) {
          reject(new Error('Codex app-server connection was replaced before initialization completed.'))
          return
        }

        sendMessage({
          method: 'initialized',
          params: {}
        })
        connected = true
        lastError = null
        resolve(result)
      })
      .catch(error => {
        lastError = error

        if (proc === child) {
          child.kill()
        }

        reject(error)
      })
  })

  const connect = async () => {
    if (connected) {
      return
    }

    if (!connectPromise) {
      connectPromise = connectOnce().finally(() => {
        connectPromise = null
      })
    }

    await connectPromise
  }

  const dispose = () => {
    const currentProc = proc

    connected = false
    connectPromise = null
    proc = null
    settlePending(new Error('Codex app-server connection closed.'))

    if (currentProc) {
      currentProc.kill()
    }
  }

  return {
    connect,
    dispose,
    events,
    getStatus: () => ({
      connected,
      lastError: lastError instanceof Error
        ? lastError.message
        : lastError
          ? String(lastError)
          : null
    }),
    request
  }
}

module.exports = {
  COALESCIBLE_READ_METHODS,
  createCodexRpcClient
}
