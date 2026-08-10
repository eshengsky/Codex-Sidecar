const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createHookInboxWatcher } = require('./hook-inbox-watcher.cjs')

const createFakeWatcher = () => {
  const watcher = new EventEmitter()

  watcher.closed = false
  watcher.close = () => {
    watcher.closed = true
  }

  return watcher
}

test('creates a missing Hook inbox before attaching its filesystem watcher', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-hook-watcher-'))
  const directoryPath = path.join(root, 'hook-events')
  const watchedPaths = []
  let changeCount = 0
  const watcher = createHookInboxWatcher({
    directoryPath,
    onChange: () => {
      changeCount += 1
    },
    watchDirectory: watchedPath => {
      watchedPaths.push(watchedPath)
      return createFakeWatcher()
    },
    scheduleWatchdog: () => null
  })

  try {
    await watcher.start()

    assert.equal((await fsp.stat(directoryPath)).isDirectory(), true)
    assert.deepEqual(watchedPaths, [directoryPath])
    assert.equal(changeCount, 1)
  } finally {
    watcher.stop()
    await fsp.rm(root, {
      recursive: true,
      force: true
    })
  }
})

test('reattaches and drains the inbox after a filesystem watcher error', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-hook-watcher-'))
  const directoryPath = path.join(root, 'hook-events')
  const nativeWatchers = []
  const retries = []
  const states = []
  let changeCount = 0
  const watcher = createHookInboxWatcher({
    directoryPath,
    onChange: () => {
      changeCount += 1
    },
    onStateChange: state => {
      states.push(state)
    },
    watchDirectory: () => {
      const nativeWatcher = createFakeWatcher()

      nativeWatchers.push(nativeWatcher)
      return nativeWatcher
    },
    scheduleRetry: (callback, delay) => {
      const timer = {
        callback,
        delay,
        unref() {}
      }

      retries.push(timer)
      return timer
    },
    scheduleWatchdog: () => null
  })

  try {
    await watcher.start()
    nativeWatchers[0].emit('error', Object.assign(new Error('watcher lost'), {
      code: 'EIO'
    }))

    assert.equal(nativeWatchers[0].closed, true)
    assert.equal(retries.length, 1)
    assert.equal(retries[0].delay, 250)
    assert.equal(states.at(-1).status, 'retrying')
    assert.match(states.at(-1).lastError, /watcher lost/)

    await retries[0].callback()

    assert.equal(nativeWatchers.length, 2)
    assert.equal(changeCount, 2)
    assert.equal(states.at(-1).status, 'ready')
  } finally {
    watcher.stop()
    await fsp.rm(root, {
      recursive: true,
      force: true
    })
  }
})

test('reattaches when the Hook inbox is deleted and recreated with a new inode', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-hook-watcher-'))
  const directoryPath = path.join(root, 'hook-events')
  const nativeWatchers = []
  let watchdog = null
  let changeCount = 0
  const watcher = createHookInboxWatcher({
    directoryPath,
    onChange: () => {
      changeCount += 1
    },
    watchDirectory: () => {
      const nativeWatcher = createFakeWatcher()

      nativeWatchers.push(nativeWatcher)
      return nativeWatcher
    },
    scheduleWatchdog: callback => {
      watchdog = callback
      return {
        unref() {}
      }
    }
  })

  try {
    await watcher.start()
    await fsp.rm(directoryPath, {
      recursive: true,
      force: true
    })
    await fsp.mkdir(directoryPath, {
      recursive: true
    })

    await watchdog()

    assert.equal(nativeWatchers[0].closed, true)
    assert.equal(nativeWatchers.length, 2)
    assert.equal(changeCount, 2)
  } finally {
    watcher.stop()
    await fsp.rm(root, {
      recursive: true,
      force: true
    })
  }
})
