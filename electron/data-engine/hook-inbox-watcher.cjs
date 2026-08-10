const fs = require('node:fs')
const fsp = require('node:fs/promises')

const DEFAULT_RETRY_DELAYS_MS = [250, 1000, 4000, 15000]
const DEFAULT_WATCHDOG_INTERVAL_MS = 30 * 1000

const normalizeError = error => error instanceof Error ? error.message : String(error || 'Unknown watcher error.')

const identityFromStats = stats => `${String(stats.dev)}:${String(stats.ino)}`

const createHookInboxWatcher = ({
  directoryPath,
  onChange,
  onStateChange = () => {},
  watchDirectory = fs.watch,
  makeDirectory = fsp.mkdir,
  statPath = fsp.stat,
  scheduleRetry = setTimeout,
  clearRetry = clearTimeout,
  scheduleWatchdog = setInterval,
  clearWatchdog = clearInterval,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  watchdogIntervalMs = DEFAULT_WATCHDOG_INTERVAL_MS
}) => {
  if (!directoryPath || typeof onChange !== 'function') {
    throw new Error('Hook inbox path and change handler are required.')
  }

  let nativeWatcher = null
  let watchedIdentity = null
  let retryTimer = null
  let watchdogTimer = null
  let retryIndex = 0
  let ensurePromise = null
  let started = false
  let stopped = false

  const reportState = state => {
    try {
      onStateChange(state)
    } catch {
      // Watcher health reporting must not interfere with Hook ingestion.
    }
  }

  const notifyChange = () => {
    try {
      const result = onChange()

      Promise.resolve(result).catch(error => {
        reportState({
          status: 'degraded',
          lastError: normalizeError(error)
        })
      })
    } catch (error) {
      reportState({
        status: 'degraded',
        lastError: normalizeError(error)
      })
    }
  }

  const detachNativeWatcher = () => {
    const current = nativeWatcher

    nativeWatcher = null
    watchedIdentity = null

    if (!current) {
      return
    }

    current.off?.('error', handleWatcherError)
    current.close?.()
  }

  const scheduleRecovery = error => {
    if (stopped || retryTimer) {
      return
    }

    const delay = retryDelaysMs[Math.min(retryIndex, retryDelaysMs.length - 1)]

    retryIndex += 1
    reportState({
      status: 'retrying',
      lastError: normalizeError(error),
      retryInMs: delay
    })
    retryTimer = scheduleRetry(() => {
      retryTimer = null
      return ensureAttached()
    }, delay)
    retryTimer?.unref?.()
  }

  function handleWatcherError(error) {
    detachNativeWatcher()
    scheduleRecovery(error)
  }

  const attach = async () => {
    await makeDirectory(directoryPath, {
      recursive: true
    })

    if (stopped) {
      return
    }

    const stats = await statPath(directoryPath)
    const nextWatcher = watchDirectory(directoryPath, {
      persistent: false
    }, () => {
      notifyChange()
      // macOS watches an inode rather than a durable pathname. Check the
      // identity after every event so deletion/recreation cannot silently
      // strand the watcher on the old directory.
      void ensureAttached()
    })

    if (stopped) {
      nextWatcher.close?.()
      return
    }

    nativeWatcher = nextWatcher
    watchedIdentity = identityFromStats(stats)
    nativeWatcher.on?.('error', handleWatcherError)
    retryIndex = 0
    reportState({
      status: 'ready',
      lastError: null
    })
    // Drain files that may have arrived before attachment or during recovery.
    notifyChange()
  }

  const ensureAttached = () => {
    if (stopped) {
      return Promise.resolve()
    }

    if (ensurePromise) {
      return ensurePromise
    }

    ensurePromise = (async () => {
      if (nativeWatcher) {
        try {
          const currentIdentity = identityFromStats(await statPath(directoryPath))

          if (currentIdentity === watchedIdentity) {
            return
          }
        } catch {
          // A missing or inaccessible path is repaired by the same attach path.
        }

        detachNativeWatcher()
      }

      try {
        await attach()
      } catch (error) {
        detachNativeWatcher()
        scheduleRecovery(error)
      }
    })().finally(() => {
      ensurePromise = null
    })

    return ensurePromise
  }

  const start = async () => {
    if (started) {
      return ensureAttached()
    }

    started = true
    stopped = false
    await ensureAttached()

    if (watchdogIntervalMs > 0 && !watchdogTimer) {
      // fs.watch can remain attached to a deleted inode without another error.
      // One cheap stat keeps the path binding self-healing without polling the
      // inbox contents or changing normal event latency.
      watchdogTimer = scheduleWatchdog(() => {
        return ensureAttached()
      }, watchdogIntervalMs)
      watchdogTimer?.unref?.()
    }
  }

  const stop = () => {
    stopped = true

    if (retryTimer) {
      clearRetry(retryTimer)
      retryTimer = null
    }

    if (watchdogTimer) {
      clearWatchdog(watchdogTimer)
      watchdogTimer = null
    }

    detachNativeWatcher()
  }

  return {
    start,
    stop
  }
}

module.exports = {
  createHookInboxWatcher
}
