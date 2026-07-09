const { autoUpdater } = require('electron-updater')

const AUTO_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const AUTO_UPDATE_ACTIVE_CHECK_INTERVAL_MS = 15 * 60 * 1000

let initialized = false
let autoCheckTimer = null
let autoCheckInterval = null
let lastCheckAt = 0
let appRef = null
let getWindows = () => []
let beforeQuitForUpdate = () => {}

const state = {
  status: 'idle',
  currentVersion: '0.0.0',
  downloadedVersion: null,
  error: null,
  canInstall: false,
  isPackaged: false
}

const normalizeError = error => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error || 'Unknown update error')
}

const getUpdateState = () => ({ ...state })

const broadcastUpdateState = () => {
  for (const browserWindow of getWindows()) {
    if (!browserWindow || browserWindow.isDestroyed()) {
      continue
    }

    browserWindow.webContents.send('sidecar:updateStateChanged', getUpdateState())
  }
}

const setUpdateState = patch => {
  Object.assign(state, patch)
  broadcastUpdateState()
}

const configureAutoUpdater = () => {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'eshengsky',
    repo: 'Codex-Sidecar'
  })
}

const bindAutoUpdaterEvents = () => {
  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', error: null })
  })

  autoUpdater.on('update-available', info => {
    setUpdateState({
      status: 'downloading',
      downloadedVersion: info?.version || null,
      error: null,
      canInstall: false
    })
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'not-available',
      downloadedVersion: null,
      error: null,
      canInstall: false
    })
  })

  autoUpdater.on('download-progress', () => {
    setUpdateState({
      status: 'downloading',
      error: null,
      canInstall: false
    })
  })

  autoUpdater.on('update-downloaded', info => {
    setUpdateState({
      status: 'downloaded',
      downloadedVersion: info?.version || state.downloadedVersion,
      error: null,
      canInstall: true
    })
  })

  autoUpdater.on('error', error => {
    setUpdateState({
      status: 'error',
      error: normalizeError(error),
      canInstall: false
    })
  })

  autoUpdater.on('before-quit-for-update', () => {
    beforeQuitForUpdate()
  })
}

const checkForUpdates = async () => {
  if (
    !state.isPackaged ||
    state.status === 'downloaded' ||
    state.status === 'checking' ||
    state.status === 'downloading'
  ) {
    return getUpdateState()
  }

  try {
    lastCheckAt = Date.now()
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setUpdateState({
      status: 'error',
      error: normalizeError(error),
      canInstall: false
    })
  }

  return getUpdateState()
}

const scheduleAutoUpdateCheck = (delayMs = 15_000) => {
  if (!state.isPackaged) {
    return
  }

  if (!autoCheckTimer) {
    autoCheckTimer = setTimeout(() => {
      autoCheckTimer = null
      void checkForUpdates()
    }, delayMs)
    autoCheckTimer.unref?.()
  }

  if (!autoCheckInterval) {
    autoCheckInterval = setInterval(() => {
      void checkForUpdates()
    }, AUTO_UPDATE_CHECK_INTERVAL_MS)
    autoCheckInterval.unref?.()
  }
}

const maybeCheckForUpdatesAfterIdle = () => {
  if (!state.isPackaged || state.status === 'downloaded') {
    return getUpdateState()
  }

  if (Date.now() - lastCheckAt < AUTO_UPDATE_ACTIVE_CHECK_INTERVAL_MS) {
    return getUpdateState()
  }

  void checkForUpdates()
  return getUpdateState()
}

const installUpdate = () => {
  if (!state.canInstall) {
    return { ok: false, error: 'No downloaded update is ready to install.' }
  }

  beforeQuitForUpdate()
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })

  return { ok: true }
}

const initializeAutoUpdate = options => {
  appRef = options.app
  getWindows = typeof options.getWindows === 'function' ? options.getWindows : getWindows
  beforeQuitForUpdate = typeof options.beforeQuitForUpdate === 'function'
    ? options.beforeQuitForUpdate
    : beforeQuitForUpdate

  state.currentVersion = appRef.getVersion()
  state.isPackaged = Boolean(appRef.isPackaged)

  if (initialized) {
    return
  }

  initialized = true

  if (!state.isPackaged) {
    setUpdateState({
      status: 'idle',
      downloadedVersion: null,
      error: null,
      canInstall: false
    })
    return
  }

  configureAutoUpdater()
  bindAutoUpdaterEvents()
}

module.exports = {
  checkForUpdates,
  getUpdateState,
  initializeAutoUpdate,
  installUpdate,
  maybeCheckForUpdatesAfterIdle,
  scheduleAutoUpdateCheck
}
