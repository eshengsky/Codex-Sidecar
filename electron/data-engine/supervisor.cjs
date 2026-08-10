const { EventEmitter } = require('node:events')

const {
  createRequest,
  parseEngineMessage
} = require('./protocol.cjs')

const DEFAULT_REQUEST_TIMEOUT_MS = 15000
const RESTART_DELAYS_MS = [250, 1000, 4000, 15000]
const RESTART_WINDOW_MS = 60 * 1000
const RESTART_LIMIT = 5

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  // A replacement generation may fail before any caller explicitly awaits it.
  // Attach a handler so supervision failures do not become process-level
  // unhandled rejections.
  promise.catch(() => undefined)

  return {
    promise,
    reject,
    resolve
  }
}

const createDataEngineSupervisor = ({
  forkUtility,
  entryPath,
  env = process.env,
  clock = Date.now,
  schedule = setTimeout,
  clearSchedule = clearTimeout,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
}) => {
  if (typeof forkUtility !== 'function' || !entryPath) {
    throw new Error('Data-engine utility spawner and entry path are required.')
  }

  const events = new EventEmitter()
  const pending = new Map()
  const subscribers = new Map()
  let child = null
  let generation = 0
  let nextRequestId = 1
  let ready = null
  let restartTimer = null
  let disposed = false
  let exitTimes = []
  let health = {
    status: 'idle',
    generation: 0,
    lastError: null,
    engine: null
  }

  const setHealth = patch => {
    health = {
      ...health,
      ...patch
    }
    events.emit('health', {
      ...health
    })
  }

  const rejectPending = error => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }

    pending.clear()
  }

  const attachSubscriber = (subscriber, currentChild) => {
    try {
      subscriber.attach({
        child: currentChild,
        generation,
        topics: [...subscriber.topics]
      })
    } catch (error) {
      subscribers.delete(subscriber.id)
      events.emit('subscriberError', {
        id: subscriber.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const attachSubscribers = currentChild => {
    for (const subscriber of subscribers.values()) {
      attachSubscriber(subscriber, currentChild)
    }
  }

  const handleMessage = (currentChild, rawMessage) => {
    if (child !== currentChild || disposed) {
      return
    }

    if (rawMessage?.type === 'ready') {
      setHealth({
        status: 'ready',
        generation,
        lastError: null,
        engine: rawMessage.health || null
      })
      ready?.resolve({
        generation,
        health: rawMessage.health || null,
        projection: rawMessage.projection || null
      })
      attachSubscribers(currentChild)
      events.emit('ready', {
        generation,
        health: rawMessage.health || null,
        projection: rawMessage.projection || null
      })
      return
    }

    let message

    try {
      message = parseEngineMessage(rawMessage)
    } catch (error) {
      setHealth({
        lastError: error.message
      })
      return
    }

    if (message.type === 'response') {
      const entry = pending.get(message.id)

      if (!entry) {
        return
      }

      pending.delete(message.id)
      clearTimeout(entry.timer)

      if (message.ok) {
        entry.resolve(message.value)
      } else {
        entry.reject(new Error(message.error.message))
      }

      return
    }

    if (message.type === 'health') {
      setHealth({
        engine: message.health || message.value || null
      })
      return
    }

    events.emit(message.type, message)
  }

  const spawnGeneration = () => {
    if (disposed) {
      return
    }

    generation += 1
    ready = createDeferred()
    setHealth({
      status: generation === 1 ? 'starting' : 'restarting',
      generation,
      engine: null
    })

    const currentChild = forkUtility(entryPath, [], {
      env: {
        ...env
      },
      serviceName: 'Sidecar Data Engine',
      stdio: 'pipe'
    })

    child = currentChild

    currentChild.on('message', message => {
      handleMessage(currentChild, message)
    })

    currentChild.on('error', error => {
      if (child === currentChild) {
        setHealth({
          lastError: error instanceof Error ? error.message : String(error)
        })
      }
    })

    currentChild.on('exit', code => {
      if (child !== currentChild || disposed) {
        return
      }

      child = null
      const error = new Error(`Sidecar data engine exited with code ${code}.`)

      rejectPending(error)
      ready?.reject(error)

      const now = clock()
      exitTimes = exitTimes.filter(timestamp => now - timestamp <= RESTART_WINDOW_MS)
      exitTimes.push(now)

      if (exitTimes.length > RESTART_LIMIT) {
        setHealth({
          status: 'failed',
          lastError: `Sidecar data engine restart limit exceeded (${RESTART_LIMIT} exits in 60 seconds).`,
          engine: null
        })
        return
      }

      const delay = RESTART_DELAYS_MS[Math.min(exitTimes.length - 1, RESTART_DELAYS_MS.length - 1)]

      setHealth({
        status: 'restarting',
        lastError: error.message,
        engine: null
      })
      restartTimer = schedule(() => {
        restartTimer = null
        spawnGeneration()
      }, delay)
      restartTimer?.unref?.()
    })
  }

  const start = () => {
    if (disposed) {
      return Promise.reject(new Error('Sidecar data-engine supervisor is disposed.'))
    }

    if (!child && health.status !== 'failed') {
      spawnGeneration()
    }

    if (health.status === 'failed') {
      return Promise.reject(new Error(health.lastError || 'Sidecar data engine failed.'))
    }

    return ready.promise
  }

  const request = async (operation, payload, options = {}) => {
    await start()

    if (!child || health.status !== 'ready') {
      throw new Error('Sidecar data engine is not ready.')
    }

    const id = nextRequestId
    nextRequestId += 1
    const requestMessage = createRequest(id, operation, payload)
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : requestTimeoutMs

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for data-engine operation ${operation}.`))
      }, timeoutMs)

      timer.unref?.()
      pending.set(id, {
        operation,
        reject,
        resolve,
        timer
      })

      try {
        child.postMessage(requestMessage)
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error)
      }
    })
  }

  const registerSubscriber = ({ id, topics, attach }) => {
    const normalizedId = typeof id === 'string' ? id.trim() : ''

    if (!normalizedId || !Array.isArray(topics) || typeof attach !== 'function') {
      throw new Error('Data-engine subscriber id, topics and attach callback are required.')
    }

    subscribers.set(normalizedId, {
      id: normalizedId,
      topics: [...new Set(topics.filter(topic => typeof topic === 'string' && topic))],
      attach
    })

    if (child && health.status === 'ready') {
      attachSubscriber(subscribers.get(normalizedId), child)
    }

    return () => {
      subscribers.delete(normalizedId)
    }
  }

  const dispose = () => {
    disposed = true

    if (restartTimer) {
      clearSchedule(restartTimer)
      restartTimer = null
    }

    const currentChild = child
    child = null
    rejectPending(new Error('Sidecar data-engine supervisor closed.'))
    ready?.reject(new Error('Sidecar data-engine supervisor closed.'))
    subscribers.clear()

    if (currentChild) {
      currentChild.kill()
    }

    setHealth({
      status: 'stopped',
      engine: null
    })
  }

  return {
    dispose,
    events,
    getGeneration: () => generation,
    getHealth: () => ({
      ...health
    }),
    registerSubscriber,
    request,
    start
  }
}

module.exports = {
  createDataEngineSupervisor
}
