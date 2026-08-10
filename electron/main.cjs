const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  utilityProcess
} = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  configureAppDataPaths
} = require('./app-data-paths.cjs')
const {
  SIDECAR_HOOK_EVENTS,
  evaluateSidecarHookStatus
} = require('./sidecar-hooks.cjs')
const { createDiagnostics } = require('./diagnostics.cjs')
const {
  createCodexClientProxy,
  createDataEngineStoreClient
} = require('./data-engine/main-adapter.cjs')
const { createDataEngineSupervisor } = require('./data-engine/supervisor.cjs')
const {
  getUpdateState,
  initializeAutoUpdate,
  installUpdate,
  maybeCheckForUpdatesAfterIdle,
  scheduleAutoUpdateCheck
} = require('./auto-update.cjs')
const { version: APP_VERSION } = require('../package.json')

const isDataEngineSmokeMode = process.argv.includes('--sidecar-engine-smoke')

if (isDataEngineSmokeMode) {
  const smokeAppDataPath = process.env.SIDECAR_SMOKE_APP_DATA_PATH

  if (!smokeAppDataPath || !path.isAbsolute(smokeAppDataPath)) {
    throw new Error('SIDECAR_SMOKE_APP_DATA_PATH must be an absolute path in data-engine smoke mode.')
  }

  fs.mkdirSync(smokeAppDataPath, {
    recursive: true
  })
  app.setPath('appData', smokeAppDataPath)
}

configureAppDataPaths({ app, fs })

const APP_REPOSITORY_URL = 'https://github.com/eshengsky/Codex-Sidecar'
const diagnostics = createDiagnostics({
  directory: path.join(app.getPath('userData'), 'diagnostics')
})
const WINDOW_STATE_SCHEMA_VERSION = 2
const POST_OPEN_CODEX_STORE_DELAYS_MS = [300, 1000, 2500]
const THREAD_CONTINUATION_SUMMARY_TIMEOUT_MS = 6 * 60 * 60_000
const THREAD_CONTINUATION_TEXT_GRACE_MS = 3000
const EXPLORATION_TURN_TIMEOUT_MS = 10 * 60_000
const EXPLORATION_RESULT_WINDOW_SIZE = { width: 980, height: 720 }
const EXPLORATION_RESULT_WINDOW_MIN_SIZE = { width: 680, height: 520 }
const EXPLORATION_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp'])
const THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH = 120
const TURN_BOOKMARK_TEXT_MAX_LENGTH = 600
const TURN_BOOKMARK_META_MAX_LENGTH = 1000
const WINDOW_BOUNDS_SAVE_DEBOUNCE_MS = 300
const WINDOW_BOUNDS_APPLY_SUPPRESSION_MS = 50
const WINDOW_POSITION_VISIBLE_SIZE = 24
const MINI_SIZE = { width: 330, height: 36 }
const MINI_ALWAYS_ON_TOP_LEVEL_BELOW_DOCK = 'floating'
const MINI_ALWAYS_ON_TOP_LEVEL_OVER_DOCK = 'pop-up-menu'
const POPUP_MENU_DEFAULT_WIDTH = 300
const POPUP_MENU_MIN_WIDTH = 220
const POPUP_MENU_MAX_WIDTH = 420
const POPUP_MENU_ITEM_HEIGHT = 28
const POPUP_MENU_ITEM_HEIGHT_WITH_DESCRIPTION = 44
const POPUP_MENU_VERTICAL_PADDING = 8
const POPUP_MENU_MAX_HEIGHT = 280
const POPUP_MENU_SCREEN_MARGIN = 6
const POPUP_MENU_PREWARM_DELAY_MS = 300
const FULL_WIDTH = 360
const FULL_HEIGHT_RATIO = 0.7
const FULL_MIN_SIZE = { width: 340, height: 420 }

let mainWindow = null
let miniWindow = null
let popupMenuWindow = null
const explorationResultWindows = new Map()
let dataEngine = null
let dataEngineStore = null
let codexClient = null
let popupMenuPrewarmTimer = null
let windowStateWriteQueue = Promise.resolve()
let windowState = null
let currentWindowMode = 'full'
let currentMiniOverDock = true
let currentShowMiniTool = true
let sidecarHookStatusRefreshPromise = null
let popupMenuData = null
let popupMenuPendingResult = null
let windowBoundsSaveTimer = null
let isApplyingWindowBounds = false
let applyingWindowBoundsTimer = null
let miniWindowDragState = null
const dataEngineSubscriberCleanupByWebContentsId = new Map()

process.on('uncaughtExceptionMonitor', (error, origin) => {
  diagnostics.record('main.uncaughtException', {
    error,
    origin
  })
})
process.on('unhandledRejection', reason => {
  diagnostics.record('main.unhandledRejection', {
    reason
  })
})

let sidecarHookStatus = {
  ready: false,
  issue: 'missing',
  missingEvents: [...SIDECAR_HOOK_EVENTS],
  untrustedEvents: [],
  disabledEvents: [],
  checkedAt: 0,
  error: null
}

const LANGUAGE_MODES = new Set(['auto', 'en', 'zh'])
const THEME_MODES = new Set(['auto', 'light', 'dark'])
const FULL_PANEL_KEYS = new Set(['threads', 'bookmarks', 'explorations', 'prompts', 'usage', 'data'])
const EXPLORATION_RUN_STATUSES = new Set(['running', 'summarizing', 'completed', 'partialFailed', 'failed'])
const EXPLORATION_CANDIDATE_STATUSES = new Set(['pending', 'running', 'completed', 'failed'])
const EXPLORATION_SUMMARY_STATUSES = new Set(['pending', 'running', 'completed', 'failed'])

const normalizePromptString = (value, fallback = '') => typeof value === 'string' ? value : fallback

const normalizeLanguageMode = value => LANGUAGE_MODES.has(value) ? value : 'auto'
const normalizeThemeMode = value => THEME_MODES.has(value) ? value : 'auto'
const normalizeMiniOverDock = value => typeof value === 'boolean' ? value : true
const normalizeShowMiniTool = value => typeof value === 'boolean' ? value : true
const normalizeShowMiniPrompts = value => typeof value === 'boolean' ? value : true
const normalizeFullPanelKey = value => FULL_PANEL_KEYS.has(value) ? value : null

const getThemeBackgroundColor = () => nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#f8fafc'

const applyThemeModeToNativeTheme = value => {
  const themeMode = normalizeThemeMode(value)
  const themeSource = themeMode === 'auto' ? 'system' : themeMode

  if (nativeTheme.themeSource !== themeSource) {
    nativeTheme.themeSource = themeSource
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(getThemeBackgroundColor())
  }

  for (const browserWindow of explorationResultWindows.values()) {
    if (!browserWindow.isDestroyed()) {
      browserWindow.setBackgroundColor(getThemeBackgroundColor())
    }
  }
}

const getMiniAlwaysOnTopLevel = miniOverDock =>
  normalizeMiniOverDock(miniOverDock) ? MINI_ALWAYS_ON_TOP_LEVEL_OVER_DOCK : MINI_ALWAYS_ON_TOP_LEVEL_BELOW_DOCK

const applyMiniOverDock = value => {
  const miniOverDock = normalizeMiniOverDock(value)

  currentMiniOverDock = miniOverDock

  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.setAlwaysOnTop(true, getMiniAlwaysOnTopLevel(miniOverDock))
  }
}

const createDefaultSidecarSettings = () => ({
  languageMode: 'auto',
  themeMode: 'auto',
  miniOverDock: true,
  showMiniTool: true,
  showMiniPrompts: true
})

const normalizeSidecarSettings = raw => {
  const fallback = createDefaultSidecarSettings()

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  return {
    languageMode: normalizeLanguageMode(raw.languageMode),
    themeMode: normalizeThemeMode(raw.themeMode),
    miniOverDock: normalizeMiniOverDock(raw.miniOverDock),
    showMiniTool: normalizeShowMiniTool(raw.showMiniTool),
    showMiniPrompts: normalizeShowMiniPrompts(raw.showMiniPrompts)
  }
}

const resolveSidecarLocale = settings => {
  const languageMode = normalizeLanguageMode(settings?.languageMode)
  const locale = languageMode === 'auto' ? app.getLocale() : languageMode

  return String(locale || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const getSidecarText = (settings, key) => {
  const locale = resolveSidecarLocale(settings)
  const texts = {
    exportTitle: {
      en: 'Export Codex Sidecar Data',
      zh: '导出 Codex Sidecar 数据'
    },
    importTitle: {
      en: 'Import Codex Sidecar Data',
      zh: '导入 Codex Sidecar 数据'
    }
  }

  return texts[key]?.[locale] || texts[key]?.en || key
}

const normalizePromptTemplates = rawTemplates => {
  if (!Array.isArray(rawTemplates)) {
    return createDefaultPromptTemplates()
  }

  return rawTemplates
    .filter(template => template && typeof template === 'object')
    .map(template => ({
      id: normalizePromptString(template.id).trim() || crypto.randomUUID(),
      name: normalizePromptString(template.name).trim() || '未命名指令',
      body: normalizePromptString(template.body),
      defaultPath: normalizePromptString(template.defaultPath)
    }))
}

const createDefaultPromptTemplates = () => []

const createDefaultWindowState = () => ({
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  positionsByMode: {},
  sizesByMode: {}
})

const normalizeFavoriteString = (value, maxLength = TURN_BOOKMARK_META_MAX_LENGTH) => {
  const text = typeof value === 'string' ? value.trim() : ''

  return text.length > maxLength ? text.slice(0, maxLength) : text
}

const normalizeFavoriteTimestamp = value => typeof value === 'number' && Number.isFinite(value) ? value : null

const normalizeThreadFavoriteItem = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const threadId = normalizeFavoriteString(raw.threadId)

  if (!threadId) {
    return null
  }

  return {
    type: 'thread',
    id: threadId,
    threadId,
    createdAt: normalizeFavoriteTimestamp(raw.createdAt) || Date.now()
  }
}

const normalizeTurnFavoriteItem = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const threadId = normalizeFavoriteString(raw.threadId)
  const turnId = normalizeFavoriteString(raw.turnId)
  const id = normalizeFavoriteString(raw.id)
  const userPreview = normalizeFavoriteString(raw.userPreview, TURN_BOOKMARK_TEXT_MAX_LENGTH)

  if (!id || !threadId || !turnId || !userPreview) {
    return null
  }

  const createdAt = normalizeFavoriteTimestamp(raw.createdAt) || Date.now()

  return {
    type: 'turn',
    id,
    threadId,
    turnId,
    userItemId: normalizeFavoriteString(raw.userItemId),
    userPreview,
    userSearchText: normalizeFavoriteString(raw.userSearchText, THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH),
    assistantItemId: normalizeFavoriteString(raw.assistantItemId),
    assistantPreview: normalizeFavoriteString(raw.assistantPreview, TURN_BOOKMARK_TEXT_MAX_LENGTH),
    turnCreatedAt: normalizeFavoriteTimestamp(raw.turnCreatedAt),
    createdAt,
    threadTitle: normalizeFavoriteString(raw.threadTitle, TURN_BOOKMARK_TEXT_MAX_LENGTH),
    codexTitle: normalizeFavoriteString(raw.codexTitle, TURN_BOOKMARK_TEXT_MAX_LENGTH),
    cwd: normalizeFavoriteString(raw.cwd),
    projectName: normalizeFavoriteString(raw.projectName, TURN_BOOKMARK_TEXT_MAX_LENGTH)
  }
}

const normalizeLegacyMessageFavoriteItem = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const threadId = normalizeFavoriteString(raw.threadId)
  const turnId = normalizeFavoriteString(raw.turnId)
  const userItemId = normalizeFavoriteString(raw.itemId)
  const userPreview = normalizeFavoriteString(raw.preview, TURN_BOOKMARK_TEXT_MAX_LENGTH)

  if (!threadId || !turnId || !userPreview) {
    return null
  }

  return {
    type: 'turn',
    id: `${threadId}:${turnId}`,
    threadId,
    turnId,
    userItemId,
    userPreview,
    userSearchText: normalizeFavoriteString(raw.searchText, THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH),
    assistantItemId: '',
    assistantPreview: '',
    turnCreatedAt: normalizeFavoriteTimestamp(raw.messageCreatedAt),
    createdAt: normalizeFavoriteTimestamp(raw.createdAt) || Date.now(),
    threadTitle: normalizeFavoriteString(raw.threadTitle, TURN_BOOKMARK_TEXT_MAX_LENGTH),
    codexTitle: normalizeFavoriteString(raw.codexTitle, TURN_BOOKMARK_TEXT_MAX_LENGTH),
    cwd: normalizeFavoriteString(raw.cwd),
    projectName: normalizeFavoriteString(raw.projectName, TURN_BOOKMARK_TEXT_MAX_LENGTH)
  }
}

const normalizeFavoriteItem = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  if (raw.type === 'thread') {
    return normalizeThreadFavoriteItem(raw)
  }

  if (raw.type === 'turn') {
    return normalizeTurnFavoriteItem(raw)
  }

  if (raw.type === 'message') {
    return normalizeLegacyMessageFavoriteItem(raw)
  }

  return null
}

const normalizeWindowPosition = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
    return null
  }

  return {
    x: Math.round(raw.x),
    y: Math.round(raw.y)
  }
}

const normalizeWindowSize = (raw, mode) => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  if (!Number.isFinite(raw.width) || (mode !== 'mini' && !Number.isFinite(raw.height))) {
    return null
  }

  if (mode === 'mini') {
    return {
      width: Math.max(MINI_SIZE.width, Math.round(raw.width)),
      height: MINI_SIZE.height
    }
  }

  const minSize = mode === 'mini' ? MINI_SIZE : FULL_MIN_SIZE

  return {
    width: Math.max(minSize.width, Math.round(raw.width)),
    height: Math.max(minSize.height, Math.round(raw.height))
  }
}

const normalizeWindowState = raw => {
  const fallback = createDefaultWindowState()

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const positionsByMode = {}
  const sizesByMode = {}
  const rawPositions = raw.positionsByMode && typeof raw.positionsByMode === 'object'
    ? raw.positionsByMode
    : {}
  const rawSizes = raw.sizesByMode && typeof raw.sizesByMode === 'object'
    ? raw.sizesByMode
    : {}

  for (const mode of ['mini', 'full']) {
    const position = normalizeWindowPosition(rawPositions[mode])
    const size = normalizeWindowSize(rawSizes[mode], mode)

    if (position) {
      positionsByMode[mode] = position
    }

    if (size) {
      sizesByMode[mode] = size
    }
  }

  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    positionsByMode,
    sizesByMode
  }
}

const getSidecarStorePath = () => path.join(app.getPath('userData'), 'sidecar.sqlite')
const getSidecarEngineStorePath = () => path.join(app.getPath('userData'), 'sidecar-v2.sqlite')
const getSidecarStoreBackupPath = () => path.join(app.getPath('userData'), 'sidecar-v1.backup.sqlite')

const getExplorationAttachmentsDir = runId => path.join(app.getPath('userData'), 'exploration-attachments', runId)

const getSidecarStore = () => {
  if (!dataEngineStore) {
    throw new Error('Sidecar data engine is not ready.')
  }

  return dataEngineStore
}

const initializeDataEngine = async () => {
  if (dataEngine) {
    return dataEngine.start()
  }

  dataEngine = createDataEngineSupervisor({
    forkUtility: utilityProcess.fork,
    entryPath: path.join(__dirname, 'data-engine', 'service.cjs'),
    env: {
      ...process.env,
      SIDECAR_APP_VERSION: APP_VERSION,
      SIDECAR_USER_DATA_PATH: app.getPath('userData'),
      SIDECAR_SOURCE_DB_PATH: getSidecarStorePath(),
      SIDECAR_ENGINE_DB_PATH: getSidecarEngineStorePath(),
      SIDECAR_BACKUP_DB_PATH: getSidecarStoreBackupPath(),
      SIDECAR_HOOK_EVENTS_DIR: getHookEventsDir(),
      SIDECAR_RUNTIME_STATE_PATH: getRuntimeStatePath(),
      SIDECAR_GLOBAL_STATE_PATH: getCodexGlobalStatePath(),
      SIDECAR_ENGINE_SMOKE: isDataEngineSmokeMode ? '1' : '0'
    }
  })
  dataEngine.events.on('health', health => {
    diagnostics.record('dataEngine.health', health)
  })
  dataEngine.events.on('subscriberError', error => {
    diagnostics.record('dataEngine.subscriberError', error)
  })
  dataEngineStore = createDataEngineStoreClient(dataEngine)
  codexClient = createCodexClientProxy(dataEngine)

  return dataEngine.start()
}

const attachDataEngineToWindow = browserWindow => {
  if (!dataEngine || !browserWindow || browserWindow.isDestroyed()) {
    return
  }

  const webContentsId = browserWindow.webContents.id
  dataEngineSubscriberCleanupByWebContentsId.get(webContentsId)?.()

  const unregister = dataEngine.registerSubscriber({
    id: `webContents:${webContentsId}`,
    topics: ['codexProjection'],
    attach: ({ child, generation, topics }) => {
      if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        return
      }

      const { port1, port2 } = new MessageChannelMain()

      child.postMessage({
        type: 'subscribe',
        generation,
        topics
      }, [port1])
      browserWindow.webContents.postMessage('sidecar:dataPort', {
        generation
      }, [port2])
    }
  })

  dataEngineSubscriberCleanupByWebContentsId.set(webContentsId, unregister)
  browserWindow.webContents.once('destroyed', () => {
    unregister()
    dataEngineSubscriberCleanupByWebContentsId.delete(webContentsId)
  })
}

const writeJsonAtomic = async (filePath, value) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fsp.rename(tempPath, filePath)
}

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`

const getHookEventsDir = () => path.join(app.getPath('userData'), 'hook-events')

const getHookCaptureScriptPath = () => path.join(app.getPath('userData'), 'sidecar-hook-capture.sh')

const getRuntimeStatePath = () => path.join(app.getPath('userData'), 'runtime-state.json')

const readWindowState = async () => {
  try {
    return normalizeWindowState(await getSidecarStore().getWindowState())
  } catch (error) {
    return createDefaultWindowState()
  }
}

const saveWindowState = state => {
  const normalized = normalizeWindowState(state)
  const operation = windowStateWriteQueue
    .catch(() => undefined)
    .then(() => getSidecarStore().saveWindowState(normalized))

  windowState = normalized
  windowStateWriteQueue = operation.then(() => undefined, () => undefined)

  return operation
}

const readSidecarData = async () => getSidecarStore().getSidecarData()

const normalizeExplorationString = (value, maxLength = 20000) => normalizePromptString(value).slice(0, maxLength)

const normalizeExplorationTimestamp = value => Number.isFinite(value) && value > 0 ? value : Date.now()

const normalizeNullableTimestamp = value => Number.isFinite(value) && value > 0 ? value : null

const normalizeExplorationImage = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const id = normalizeExplorationString(raw.id, 120).trim()
  const imagePath = normalizeExplorationString(raw.path, 4000).trim()

  if (!id || !imagePath) {
    return null
  }

  return {
    id,
    name: normalizeExplorationString(raw.name, 240).trim() || path.basename(imagePath),
    path: imagePath,
    createdAt: normalizeExplorationTimestamp(raw.createdAt)
  }
}

const normalizeExplorationCandidate = (raw, index = 0) => {
  const now = Date.now()
  const normalizedIndex = Number.isInteger(raw?.index) && raw.index >= 0 ? raw.index : index
  const id = normalizeExplorationString(raw?.id, 120).trim() || `candidate-${normalizedIndex + 1}`
  const status = EXPLORATION_CANDIDATE_STATUSES.has(raw?.status) ? raw.status : 'pending'

  return {
    id,
    index: normalizedIndex,
    threadId: normalizeExplorationString(raw?.threadId, 240).trim() || null,
    turnId: normalizeExplorationString(raw?.turnId, 240).trim() || null,
    status,
    output: normalizeExplorationString(raw?.output, 1_000_000),
    error: normalizeExplorationString(raw?.error, 4000).trim() || null,
    startedAt: normalizeNullableTimestamp(raw?.startedAt),
    completedAt: normalizeNullableTimestamp(raw?.completedAt || (status === 'completed' || status === 'failed' ? now : null))
  }
}

const createDefaultExplorationSummary = () => ({
  threadId: null,
  turnId: null,
  status: 'pending',
  output: '',
  error: null,
  startedAt: null,
  completedAt: null
})

const normalizeExplorationSummary = raw => {
  if (!raw || typeof raw !== 'object') {
    return createDefaultExplorationSummary()
  }

  const status = EXPLORATION_SUMMARY_STATUSES.has(raw.status) ? raw.status : 'pending'

  return {
    threadId: normalizeExplorationString(raw.threadId, 240).trim() || null,
    turnId: normalizeExplorationString(raw.turnId, 240).trim() || null,
    status,
    output: normalizeExplorationString(raw.output, 1_000_000),
    error: normalizeExplorationString(raw.error, 4000).trim() || null,
    startedAt: normalizeNullableTimestamp(raw.startedAt),
    completedAt: normalizeNullableTimestamp(raw.completedAt)
  }
}

const normalizeExplorationRun = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const id = normalizeExplorationString(raw.id, 120).trim()

  if (!id) {
    return null
  }

  const prompt = normalizeExplorationString(raw.prompt, 200000)
  const images = Array.isArray(raw.images)
    ? raw.images.map(normalizeExplorationImage).filter(Boolean)
    : []
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.map(normalizeExplorationCandidate)
    : []
  const concurrency = Math.min(Math.max(Number(raw.concurrency) || candidates.length || 2, 2), 5)
  const status = EXPLORATION_RUN_STATUSES.has(raw.status) ? raw.status : 'running'

  return {
    id,
    title: normalizeExplorationString(raw.title, 120).trim() || prompt.replace(/\s+/g, ' ').trim().slice(0, 36) || '图片优选',
    prompt,
    images,
    concurrency,
    sourceThreadId: normalizeExplorationString(raw.sourceThreadId, 240).trim() || null,
    sourceThreadTitle: normalizeExplorationString(raw.sourceThreadTitle, 240).trim() || null,
    sourceThreadCwd: normalizeExplorationString(raw.sourceThreadCwd, 4000).trim() || null,
    status,
    createdAt: normalizeExplorationTimestamp(raw.createdAt),
    updatedAt: normalizeExplorationTimestamp(raw.updatedAt),
    completedAt: normalizeNullableTimestamp(raw.completedAt),
    candidates,
    summary: normalizeExplorationSummary(raw.summary)
  }
}

const updateExplorationRun = async (runId, updater) => {
  const currentRun = await getSidecarStore().getExplorationRun(runId)

  if (!currentRun) {
    return null
  }

  const nextRun = await getSidecarStore().saveExplorationRun(normalizeExplorationRun({
    ...currentRun,
    ...(updater(currentRun) || {}),
    id: currentRun.id,
    updatedAt: Date.now()
  }) || currentRun)

  await sendExplorationsChanged()
  return nextRun
}

const getExplorationRun = async runId => {
  return getSidecarStore().getExplorationRun(runId)
}

const resolveCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex')

const getCodexGlobalStatePath = () => path.join(resolveCodexHome(), '.codex-global-state.json')

const getCodexHooksPath = () => path.join(resolveCodexHome(), 'hooks.json')

const createHookCaptureScript = () => {
  const eventsDir = getHookEventsDir()

  return `#!/bin/sh
set -eu

EVENT_NAME="\${1-}"
if [ -z "$EVENT_NAME" ]; then
  EVENT_NAME="unknown"
fi

SAFE_EVENT="$(printf '%s' "$EVENT_NAME" | tr -cd 'A-Za-z0-9_-')"
if [ -z "$SAFE_EVENT" ]; then
  SAFE_EVENT="unknown"
fi

EVENT_DIR=${shellQuote(eventsDir)}
mkdir -p "$EVENT_DIR"

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
TMP_FILE="$EVENT_DIR/.$TIMESTAMP.$$.$SAFE_EVENT.tmp"
OUT_FILE="$EVENT_DIR/$TIMESTAMP.$$.$SAFE_EVENT.json"

cat > "$TMP_FILE"

if [ ! -s "$TMP_FILE" ]; then
  printf '{}\\n' > "$TMP_FILE"
fi

mv "$TMP_FILE" "$OUT_FILE"
`
}

const ensureHookCaptureScript = async () => {
  const scriptPath = getHookCaptureScriptPath()

  await fsp.mkdir(getHookEventsDir(), { recursive: true })
  await fsp.writeFile(scriptPath, createHookCaptureScript(), { encoding: 'utf8', mode: 0o755 })
  await fsp.chmod(scriptPath, 0o755)

  return scriptPath
}

const createSidecarHookCommand = eventName => `${shellQuote(getHookCaptureScriptPath())} ${eventName}`

const getExpectedSidecarHooks = () => SIDECAR_HOOK_EVENTS.map(eventName => ({
  eventName,
  command: createSidecarHookCommand(eventName)
}))

const normalizeHookStatusError = error => error instanceof Error ? error.message : error ? String(error) : null

const createSidecarHookErrorStatus = error => ({
  ready: false,
  issue: 'missing',
  missingEvents: [...SIDECAR_HOOK_EVENTS],
  untrustedEvents: [],
  disabledEvents: [],
  checkedAt: Date.now(),
  error: normalizeHookStatusError(error)
})

const normalizeHooksConfig = raw => {
  if (raw == null) {
    return { hooks: {} }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${getCodexHooksPath()} must contain a JSON object.`)
  }

  return {
    ...raw,
    hooks: raw.hooks && typeof raw.hooks === 'object' && !Array.isArray(raw.hooks) ? raw.hooks : {}
  }
}

const commandAlreadyConfigured = (groups, command) => {
  return groups.some(group => {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : []

    return hooks.some(hook => hook?.type === 'command' && hook.command === command)
  })
}

const installSidecarHooks = async () => {
  await fsp.mkdir(resolveCodexHome(), { recursive: true })

  const hooksPath = getCodexHooksPath()
  let raw = null

  try {
    raw = JSON.parse(await fsp.readFile(hooksPath, 'utf8'))
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }
  }

  const config = normalizeHooksConfig(raw)
  let changed = false

  for (const eventName of SIDECAR_HOOK_EVENTS) {
    const command = createSidecarHookCommand(eventName)
    const groups = Array.isArray(config.hooks[eventName]) ? config.hooks[eventName] : []

    if (!Array.isArray(config.hooks[eventName])) {
      config.hooks[eventName] = groups
      changed = true
    }

    if (!commandAlreadyConfigured(groups, command)) {
      groups.push({
        hooks: [
          {
            type: 'command',
            command,
            timeout: 5
          }
        ]
      })
      changed = true
    }
  }

  if (changed) {
    await writeJsonAtomic(hooksPath, config)
  }
}

const ensureSidecarHookIntegration = async () => {
  await ensureHookCaptureScript()
  await installSidecarHooks()
}

const getCodexClient = async () => {
  if (!codexClient) {
    await initializeDataEngine()
  }

  await codexClient.connect()
  return codexClient
}

async function sendSidecarDataChanged(sidecarData) {
  const targetWindows = [mainWindow, miniWindow, ...explorationResultWindows.values()]
    .filter(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (targetWindows.length === 0) {
    return
  }

  const nextSidecarData = sidecarData || await readSidecarData()

  for (const targetWindow of targetWindows) {
    targetWindow.webContents.send('sidecar:sidecarDataChanged', nextSidecarData)
  }
}

function sendSidecarHookStatusChanged(status = sidecarHookStatus) {
  const targetWindows = [mainWindow, miniWindow, ...explorationResultWindows.values()]
    .filter(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (targetWindows.length === 0) {
    return
  }

  for (const targetWindow of targetWindows) {
    targetWindow.webContents.send('sidecar:hookStatusChanged', status)
  }
}

async function sendExplorationsChanged() {
  const targetWindows = [mainWindow, miniWindow, ...explorationResultWindows.values()]
    .filter(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (targetWindows.length === 0) {
    return
  }

  const explorations = await getSidecarStore().listExplorationRuns()

  for (const targetWindow of targetWindows) {
    targetWindow.webContents.send('sidecar:explorationsChanged', explorations)
  }
}

const schedulePostOpenCodexStoreBroadcast = () => {
  for (const delayMs of POST_OPEN_CODEX_STORE_DELAYS_MS) {
    setTimeout(() => {
      void dataEngine?.request('projection.refresh', null).catch(() => undefined)
    }, delayMs)
  }
}

const windowMode = mode => {
  if (mode === 'mini') {
    return 'mini'
  }

  if (mode === 'popup-menu') {
    return 'popup-menu'
  }

  if (mode === 'exploration-result') {
    return 'exploration-result'
  }

  return 'full'
}

const getWindowSize = (mode, area) => {
  if (mode === 'mini') {
    return MINI_SIZE
  }

  const fullHeight = Math.max(FULL_MIN_SIZE.height, Math.floor(area.height * FULL_HEIGHT_RATIO))
  const availableHeight = Math.max(FULL_MIN_SIZE.height, area.height - 18 * 2)

  return {
    width: FULL_WIDTH,
    height: Math.min(fullHeight, availableHeight)
  }
}

const createDefaultWindowBounds = (mode, sizeOverride = null) => {
  const display = screen.getPrimaryDisplay()
  const area = mode === 'mini' ? display.bounds : display.workArea
  const margin = mode === 'mini' ? 0 : 18
  const size = sizeOverride || getWindowSize(mode, area)

  return {
    x: area.x + area.width - size.width - margin,
    y: area.y + area.height - size.height - margin,
    width: size.width,
    height: size.height
  }
}

const isWindowFullyInsideArea = (bounds, area) =>
  bounds.x >= area.x &&
  bounds.y >= area.y &&
  bounds.x + bounds.width <= area.x + area.width &&
  bounds.y + bounds.height <= area.y + area.height

const isWindowPartiallyVisibleInArea = (bounds, area) => {
  const visibleWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const visibleHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)

  return visibleWidth >= Math.min(bounds.width, WINDOW_POSITION_VISIBLE_SIZE) &&
    visibleHeight >= Math.min(bounds.height, WINDOW_POSITION_VISIBLE_SIZE)
}

const getWindowVisibilityArea = (display, mode) => mode === 'mini' ? display.bounds : display.workArea

const isWindowBoundsVisible = (bounds, mode) => screen.getAllDisplays().some(display => {
  const area = getWindowVisibilityArea(display, mode)

  return mode === 'mini'
    ? isWindowFullyInsideArea(bounds, area)
    : isWindowPartiallyVisibleInArea(bounds, area)
})

const createWindowBounds = mode => {
  const savedSize = windowState?.sizesByMode?.[mode] || null
  const defaultBounds = createDefaultWindowBounds(mode, savedSize)
  const savedPosition = windowState?.positionsByMode?.[mode]

  if (!savedPosition) {
    return defaultBounds
  }

  const savedBounds = {
    ...defaultBounds,
    x: savedPosition.x,
    y: savedPosition.y
  }

  return isWindowBoundsVisible(savedBounds, mode) ? savedBounds : defaultBounds
}

const normalizeScreenPoint = value => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const x = Number(value.screenX)
  const y = Number(value.screenY)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return { x, y }
}

const normalizePopupMenuPoint = value => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const x = Number(value.screenX)
  const y = Number(value.screenY)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return {
    screenX: Math.max(0, Math.round(x)),
    screenY: Math.max(0, Math.round(y))
  }
}

const normalizePopupMenuItems = value => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: normalizePromptString(item.id).trim(),
      label: normalizePromptString(item.label ?? item.title).trim(),
      description: normalizePromptString(item.description).trim(),
      disabled: item.disabled === true
    }))
    .filter(item => item.id && item.label)
}

const normalizePopupMenuWidth = value => {
  const width = Number(value)

  if (!Number.isFinite(width)) {
    return POPUP_MENU_DEFAULT_WIDTH
  }

  return clampCoordinate(width, POPUP_MENU_MIN_WIDTH, POPUP_MENU_MAX_WIDTH)
}

const getPopupMenuSize = options => {
  const items = normalizePopupMenuItems(options?.items)
  const width = normalizePopupMenuWidth(options?.width)
  const itemHeight = items.some(item => item.description)
    ? POPUP_MENU_ITEM_HEIGHT_WITH_DESCRIPTION
    : POPUP_MENU_ITEM_HEIGHT
  const height = clampCoordinate(
    items.length * itemHeight + POPUP_MENU_VERTICAL_PADDING,
    itemHeight + POPUP_MENU_VERTICAL_PADDING,
    POPUP_MENU_MAX_HEIGHT
  )

  return { width, height }
}

const getFallbackPopupMenuPoint = sourceWindow => {
  const bounds = sourceWindow && !sourceWindow.isDestroyed()
    ? sourceWindow.getBounds()
    : screen.getPrimaryDisplay().bounds

  return {
    screenX: bounds.x + Math.round(bounds.width / 2),
    screenY: bounds.y + Math.round(bounds.height / 2)
  }
}

const getPopupMenuBounds = (sourceWindow, options) => {
  const point = normalizePopupMenuPoint(options?.point) || getFallbackPopupMenuPoint(sourceWindow)
  const size = getPopupMenuSize(options)
  const display = screen.getDisplayNearestPoint({
    x: point.screenX,
    y: point.screenY
  })
  const area = display.bounds
  const belowY = point.screenY + POPUP_MENU_SCREEN_MARGIN
  const aboveY = point.screenY - size.height - POPUP_MENU_SCREEN_MARGIN
  const hasRoomBelow = belowY + size.height <= area.y + area.height - POPUP_MENU_SCREEN_MARGIN
  const preferredY = hasRoomBelow ? belowY : aboveY

  return clampBoundsInsideArea({
    x: point.screenX - Math.min(28, Math.round(size.width / 2)),
    y: preferredY,
    width: size.width,
    height: size.height
  }, {
    x: area.x + POPUP_MENU_SCREEN_MARGIN,
    y: area.y + POPUP_MENU_SCREEN_MARGIN,
    width: Math.max(1, area.width - POPUP_MENU_SCREEN_MARGIN * 2),
    height: Math.max(1, area.height - POPUP_MENU_SCREEN_MARGIN * 2)
  })
}

const clampCoordinate = (value, min, max) => {
  if (min > max) {
    return Math.round((min + max) / 2)
  }

  return Math.min(Math.max(Math.round(value), min), max)
}

const clampBoundsInsideArea = (bounds, area) => ({
  ...bounds,
  x: clampCoordinate(bounds.x, area.x, area.x + area.width - bounds.width),
  y: clampCoordinate(bounds.y, area.y, area.y + area.height - bounds.height)
})

const getMiniDragWindow = event => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)

  if (!targetWindow || targetWindow.isDestroyed() || targetWindow !== miniWindow) {
    return null
  }

  return targetWindow
}

const startMiniWindowDrag = (event, point) => {
  const targetWindow = getMiniDragWindow(event)
  const screenPoint = normalizeScreenPoint(point)

  if (!targetWindow || !screenPoint) {
    return
  }

  const bounds = targetWindow.getBounds()

  miniWindowDragState = {
    webContentsId: event.sender.id,
    offsetX: screenPoint.x - bounds.x,
    offsetY: screenPoint.y - bounds.y
  }
}

const moveMiniWindowDrag = (event, point) => {
  const targetWindow = getMiniDragWindow(event)
  const screenPoint = normalizeScreenPoint(point)

  if (!targetWindow || !screenPoint || miniWindowDragState?.webContentsId !== event.sender.id) {
    return null
  }

  const bounds = targetWindow.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: Math.round(screenPoint.x),
    y: Math.round(screenPoint.y)
  })
  const nextBounds = clampBoundsInsideArea({
    ...bounds,
    x: screenPoint.x - miniWindowDragState.offsetX,
    y: screenPoint.y - miniWindowDragState.offsetY
  }, display.bounds)

  targetWindow.setBounds(nextBounds, false)

  return targetWindow
}

const endMiniWindowDrag = (event, point) => {
  const targetWindow = moveMiniWindowDrag(event, point) || getMiniDragWindow(event)

  miniWindowDragState = null

  if (targetWindow) {
    flushWindowBoundsSave(targetWindow, 'mini')
  }
}

const applyWindowResizeConstraints = (browserWindow, mode) => {
  if (mode === 'mini') {
    browserWindow.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
    browserWindow.setResizable(true)
    return
  }

  browserWindow.setMinimumSize(FULL_MIN_SIZE.width, FULL_MIN_SIZE.height)
  browserWindow.setResizable(true)
}

const applyWindowBounds = (browserWindow, bounds, prepare = null) => {
  isApplyingWindowBounds = true

  if (applyingWindowBoundsTimer) {
    clearTimeout(applyingWindowBoundsTimer)
  }

  if (typeof prepare === 'function') {
    prepare()
  }

  browserWindow.setBounds(bounds, false)

  applyingWindowBoundsTimer = setTimeout(() => {
    isApplyingWindowBounds = false
    applyingWindowBoundsTimer = null
  }, WINDOW_BOUNDS_APPLY_SUPPRESSION_MS)
}

const rememberWindowBounds = (browserWindow, mode) => {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return
  }

  const bounds = browserWindow.getBounds()
  const nextRawState = {
    ...(windowState || createDefaultWindowState()),
    positionsByMode: {
      ...(windowState?.positionsByMode || {}),
      [mode]: {
        x: bounds.x,
        y: bounds.y
      }
    }
  }

  nextRawState.sizesByMode = {
    ...(windowState?.sizesByMode || {}),
    [mode]: {
      width: bounds.width,
      height: mode === 'mini' ? MINI_SIZE.height : bounds.height
    }
  }

  const nextState = normalizeWindowState(nextRawState)

  windowState = nextState
}

const scheduleWindowBoundsSave = (browserWindow, mode = currentWindowMode) => {
  if (isApplyingWindowBounds || !browserWindow || browserWindow.isDestroyed()) {
    return
  }

  rememberWindowBounds(browserWindow, mode)

  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer)
  }

  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null
    void saveWindowState(windowState).catch(() => undefined)
  }, WINDOW_BOUNDS_SAVE_DEBOUNCE_MS)
}

const flushWindowBoundsSave = (browserWindow, mode = currentWindowMode) => {
  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer)
    windowBoundsSaveTimer = null
  }

  if (!isApplyingWindowBounds) {
    rememberWindowBounds(browserWindow, mode)
  }

  if (windowState) {
    void saveWindowState(windowState).catch(() => undefined)
  }
}

const positionWindow = (browserWindow, mode) => {
  const nextMode = windowMode(mode)
  const bounds = createWindowBounds(nextMode)

  applyWindowBounds(browserWindow, bounds, () => {
    applyWindowResizeConstraints(browserWindow, nextMode)
  })
}

const getWindowModeForBrowserWindow = browserWindow => {
  if (browserWindow && browserWindow === miniWindow) {
    return 'mini'
  }

  if (browserWindow && browserWindow === popupMenuWindow) {
    return 'popup-menu'
  }

  if (browserWindow && [...explorationResultWindows.values()].some(window => window === browserWindow)) {
    return 'exploration-result'
  }

  return 'full'
}

const getWindowModeForWebContents = webContents => getWindowModeForBrowserWindow(BrowserWindow.fromWebContents(webContents))

const sendWindowModeToWindow = (browserWindow, mode) => {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return
  }

  browserWindow.webContents.send('sidecar:windowMode', windowMode(mode))
}

const sendSelectPanelToWindow = (browserWindow, activePanel) => {
  const normalizedPanel = normalizeFullPanelKey(activePanel)

  if (!normalizedPanel || !browserWindow || browserWindow.isDestroyed()) {
    return
  }

  browserWindow.webContents.send('sidecar:selectPanel', normalizedPanel)
}

const loadRenderer = (browserWindow, mode, extraQuery = {}) => {
  const nextMode = windowMode(mode)

  if (process.env.VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL)
    rendererUrl.searchParams.set('windowMode', nextMode)
    for (const [key, value] of Object.entries(extraQuery)) {
      if (value != null) {
        rendererUrl.searchParams.set(key, String(value))
      }
    }
    browserWindow.loadURL(rendererUrl.toString())
    return
  }

  browserWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), {
    query: {
      windowMode: nextMode,
      ...Object.fromEntries(Object.entries(extraQuery).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))
    }
  })
}

const monitorWebContents = (browserWindow, label) => {
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.record('renderer.gone', {
      label,
      ...details
    })
  })
  browserWindow.on('unresponsive', () => {
    diagnostics.record('renderer.unresponsive', {
      label
    })
  })
  browserWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      diagnostics.record('renderer.loadFailed', {
        label,
        errorCode,
        errorDescription,
        validatedURL
      })
    }
  })
}

const createExplorationResultWindow = explorationId => {
  const normalizedId = normalizeExplorationString(explorationId, 120).trim()

  if (!normalizedId) {
    throw new Error('explorationId is required.')
  }

  const existingWindow = explorationResultWindows.get(normalizedId)

  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.show()
    existingWindow.focus()
    return existingWindow
  }

  const resultWindow = new BrowserWindow({
    width: EXPLORATION_RESULT_WINDOW_SIZE.width,
    height: EXPLORATION_RESULT_WINDOW_SIZE.height,
    minWidth: EXPLORATION_RESULT_WINDOW_MIN_SIZE.width,
    minHeight: EXPLORATION_RESULT_WINDOW_MIN_SIZE.height,
    resizable: true,
    title: '优选结果',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: getThemeBackgroundColor(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  explorationResultWindows.set(normalizedId, resultWindow)
  monitorWebContents(resultWindow, 'exploration-result')

  resultWindow.once('ready-to-show', () => {
    if (!resultWindow.isDestroyed()) {
      resultWindow.show()
    }
  })

  resultWindow.once('closed', () => {
    explorationResultWindows.delete(normalizedId)
  })

  loadRenderer(resultWindow, 'exploration-result', { explorationId: normalizedId })

  return resultWindow
}

const createWindow = () => {
  const initialBounds = createWindowBounds('full')

  currentWindowMode = 'full'
  mainWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: FULL_MIN_SIZE.width,
    minHeight: FULL_MIN_SIZE.height,
    resizable: true,
    title: 'Codex Sidecar',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: getThemeBackgroundColor(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  monitorWebContents(mainWindow, 'main')
  mainWindow.webContents.on('did-finish-load', () => {
    attachDataEngineToWindow(mainWindow)
  })

  mainWindow.on('move', () => {
    scheduleWindowBoundsSave(mainWindow, 'full')
  })

  mainWindow.on('resize', () => {
    scheduleWindowBoundsSave(mainWindow, 'full')
  })

  mainWindow.on('close', () => {
    flushWindowBoundsSave(mainWindow, 'full')
  })

  mainWindow.once('ready-to-show', () => {
    positionWindow(mainWindow, 'full')
    mainWindow.show()
  })

  loadRenderer(mainWindow, 'full')
}

const createMiniWindow = () => {
  if (miniWindow && !miniWindow.isDestroyed()) {
    return miniWindow
  }

  const initialBounds = createWindowBounds('mini')

  miniWindow = new BrowserWindow({
    ...initialBounds,
    title: 'Codex Sidecar Mini',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    minWidth: MINI_SIZE.width,
    minHeight: MINI_SIZE.height,
    maxHeight: MINI_SIZE.height,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...(process.platform === 'darwin'
      ? {
          acceptFirstMouse: true,
          enableLargerThanScreen: true
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  monitorWebContents(miniWindow, 'mini')
  miniWindow.webContents.on('did-finish-load', () => {
    attachDataEngineToWindow(miniWindow)
  })

  if (process.platform === 'darwin') {
    miniWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
  } else {
    miniWindow.setVisibleOnAllWorkspaces(true)
  }

  miniWindow.setAlwaysOnTop(true, getMiniAlwaysOnTopLevel(currentMiniOverDock))
  miniWindow.setMenuBarVisibility(false)

  miniWindow.on('move', () => {
    scheduleWindowBoundsSave(miniWindow, 'mini')
  })

  miniWindow.on('resize', () => {
    scheduleWindowBoundsSave(miniWindow, 'mini')
  })

  miniWindow.on('close', () => {
    flushWindowBoundsSave(miniWindow, 'mini')
  })

  miniWindow.once('ready-to-show', () => {
    if (!miniWindow || miniWindow.isDestroyed()) {
      return
    }

    positionWindow(miniWindow, 'mini')
    sendWindowModeToWindow(miniWindow, 'mini')

    if (currentShowMiniTool) {
      miniWindow.showInactive()
    }

  })

  miniWindow.once('closed', () => {
    miniWindow = null
    miniWindowDragState = null
  })

  loadRenderer(miniWindow, 'mini')

  return miniWindow
}

const sendPopupMenuData = () => {
  if (!popupMenuWindow || popupMenuWindow.isDestroyed() || !popupMenuData) {
    return
  }

  popupMenuWindow.webContents.send('sidecar:popupMenuData', popupMenuData)
}

const settlePopupMenu = selectedId => {
  const pendingResult = popupMenuPendingResult

  popupMenuPendingResult = null
  popupMenuData = null

  if (popupMenuWindow && !popupMenuWindow.isDestroyed() && popupMenuWindow.isVisible()) {
    popupMenuWindow.hide()
  }

  if (pendingResult) {
    pendingResult.resolve({ selectedId })
  }
}

const createPopupMenuWindow = () => {
  if (popupMenuWindow && !popupMenuWindow.isDestroyed()) {
    return popupMenuWindow
  }

  popupMenuWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: POPUP_MENU_DEFAULT_WIDTH,
    height: POPUP_MENU_ITEM_HEIGHT + POPUP_MENU_VERTICAL_PADDING,
    title: 'Codex Sidecar Menu',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...(process.platform === 'darwin'
      ? {
          acceptFirstMouse: true,
          enableLargerThanScreen: true
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  monitorWebContents(popupMenuWindow, 'popup-menu')

  if (process.platform === 'darwin') {
    popupMenuWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
  } else {
    popupMenuWindow.setVisibleOnAllWorkspaces(true)
  }

  popupMenuWindow.setAlwaysOnTop(true, MINI_ALWAYS_ON_TOP_LEVEL_OVER_DOCK)
  popupMenuWindow.setMenuBarVisibility(false)
  popupMenuWindow.on('blur', () => {
    settlePopupMenu(null)
  })
  popupMenuWindow.once('closed', () => {
    settlePopupMenu(null)
    popupMenuWindow = null
  })

  loadRenderer(popupMenuWindow, 'popup-menu')

  return popupMenuWindow
}

const prewarmPopupMenuWindow = () => {
  if (popupMenuPrewarmTimer) {
    clearTimeout(popupMenuPrewarmTimer)
  }

  popupMenuPrewarmTimer = setTimeout(() => {
    popupMenuPrewarmTimer = null
    createPopupMenuWindow()
  }, POPUP_MENU_PREWARM_DELAY_MS)
}

const showPopupMenu = async (sourceWindow, options) => {
  const items = normalizePopupMenuItems(options?.items)

  if (items.length === 0) {
    return { selectedId: null }
  }

  settlePopupMenu(null)

  const settings = (await readSidecarData()).settings
  const menuId = crypto.randomUUID()
  const targetWindow = createPopupMenuWindow()
  const bounds = getPopupMenuBounds(sourceWindow, {
    ...options,
    items
  })

  popupMenuData = {
    id: menuId,
    items,
    languageMode: settings.languageMode,
    themeMode: settings.themeMode
  }

  targetWindow.setBounds(bounds, false)
  targetWindow.setAlwaysOnTop(true, MINI_ALWAYS_ON_TOP_LEVEL_OVER_DOCK)

  const resultPromise = new Promise(resolve => {
    popupMenuPendingResult = {
      id: menuId,
      resolve
    }
  })

  const showMenuWindow = () => {
    if (!popupMenuWindow || popupMenuWindow.isDestroyed() || popupMenuData?.id !== menuId) {
      return
    }

    sendPopupMenuData()
    popupMenuWindow.show()
    popupMenuWindow.focus()
  }

  if (targetWindow.webContents.isLoading()) {
    targetWindow.once('ready-to-show', showMenuWindow)
  } else {
    showMenuWindow()
  }

  return resultPromise
}

const showFullWindow = (options = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }

  miniWindowDragState = null
  currentWindowMode = 'full'

  if (process.platform === 'darwin' && typeof mainWindow.setWindowButtonVisibility === 'function') {
    mainWindow.setWindowButtonVisibility(true)
  }

  mainWindow.setAlwaysOnTop(false)
  positionWindow(mainWindow, 'full')
  sendWindowModeToWindow(mainWindow, 'full')
  mainWindow.show()
  mainWindow.focus()
  sendSelectPanelToWindow(mainWindow, options.activePanel)

  return true
}

const showMiniToolWindow = () => {
  miniWindowDragState = null
  currentShowMiniTool = true

  const targetMiniWindow = createMiniWindow()

  positionWindow(targetMiniWindow, 'mini')
  sendWindowModeToWindow(targetMiniWindow, 'mini')

  if (!targetMiniWindow.webContents.isLoading()) {
    targetMiniWindow.showInactive()
  }

  return true
}

const hideMiniToolWindow = () => {
  miniWindowDragState = null
  currentShowMiniTool = false

  if (miniWindow && !miniWindow.isDestroyed()) {
    flushWindowBoundsSave(miniWindow, 'mini')
    miniWindow.hide()
    sendWindowModeToWindow(miniWindow, 'mini')
  }

  return true
}

const applyShowMiniTool = value => normalizeShowMiniTool(value) && sidecarHookStatus.ready
  ? showMiniToolWindow()
  : hideMiniToolWindow()

const applyStoredMiniToolVisibility = async () => {
  const settings = (await getSidecarStore().getSidecarData()).settings
  applyShowMiniTool(settings.showMiniTool)
}

const refreshSidecarHookStatus = async (options = {}) => {
  if (sidecarHookStatusRefreshPromise) {
    return sidecarHookStatusRefreshPromise
  }

  sidecarHookStatusRefreshPromise = (async () => {
    try {
      const client = await getCodexClient()
      const response = await client.request('hooks/list', { cwds: [] }, 12000)

      sidecarHookStatus = {
        ...evaluateSidecarHookStatus(response, getExpectedSidecarHooks()),
        error: null
      }
    } catch (error) {
      sidecarHookStatus = createSidecarHookErrorStatus(error)
    }

    if (options.applyMini !== false) {
      await applyStoredMiniToolVisibility()
    }

    if (options.broadcast !== false) {
      sendSidecarHookStatusChanged(sidecarHookStatus)
    }

    return sidecarHookStatus
  })().finally(() => {
    sidecarHookStatusRefreshPromise = null
  })

  return sidecarHookStatusRefreshPromise
}

const openCodexThread = async threadId => {
  await shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`)
  schedulePostOpenCodexStoreBroadcast()
}

const openNewCodexThread = async options => {
  const params = new URLSearchParams()

  if (options?.prompt) {
    params.set('prompt', String(options.prompt))
  }

  if (options?.path && path.isAbsolute(String(options.path))) {
    params.set('path', String(options.path))
  }

  if (!params.toString()) {
    throw new Error('prompt or absolute path is required.')
  }

  await shell.openExternal(`codex://new?${params.toString()}`)
  schedulePostOpenCodexStoreBroadcast()
}

const createTextUserInput = text => ({
  type: 'text',
  text,
  text_elements: []
})

const createThreadContinuationSummaryPrompt = ({ threadId, cwd }) => [
  '你正在为一个新的 Codex 对话生成“接续摘要”。新的对话将无法访问当前旧对话的完整历史，只能看到你本次输出的内容。',
  '',
  '你的任务不是写聊天纪要，也不是做历史归档，而是生成一个面向下一轮行动的 handoff 上下文包。摘要必须帮助新的 Codex 快速理解：用户最终要做什么、哪些结论已经被确认、哪些旧判断已经被纠正、哪些事情还没完成、继续时必须避开什么坑。',
  '',
  '元信息：',
  `- 原线程 ID：${threadId}（仅作追溯线索；不要假设新对话一定能读取旧线程）`,
  `- 当前工作目录：${cwd || '未知'}`,
  `- 生成时间：${new Date().toISOString()}`,
  '',
  '核心原则：',
  '',
  '1. 先从最新的用户请求和最后几轮对话判断“当前真实目标”，再回溯只保留与该目标相关的历史。',
  '2. 只基于当前对话中已经出现、已经确认或已经验证的信息总结。',
  '3. 不要编造文件、接口、命令结果、用户意图或实现状态。',
  '4. 如果某件事不确定，明确标注“未验证”或“不确定”。',
  '5. 明确区分“最终结论”和“过程中被推翻的旧结论”。如果用户纠正过旧判断，必须写清楚旧判断哪里错、新结论是什么。',
  '6. 不要把已废弃的旧方案写成建议。已废弃内容只能放在“不要沿用的旧结论”里。',
  '7. 摘要应服务下一步行动，不要流水账式记录每一轮聊天。',
  '8. 忽略寒暄、重复说明、冗长日志、无关 tool 输出，只保留会影响后续判断和实现的事实。',
  '9. 不要要求新对话按固定文件清单阅读代码。可以给“旧对话曾定位到的模块线索”，但必须提醒新对话按当前需求和当前仓库重新确认。',
  '10. 对代码任务，必须保留用户约束、当前目标、最终技术决策、已完成改动、未完成事项、风险边界、验证状态。',
  '11. 不要说“我无法访问旧对话”。你正在当前旧对话里总结。',
  '12. 不要调用工具、不要修改文件、不要启动命令；本次只输出摘要。',
  '13. 输出 Markdown，不要加开场白，不要加解释，不要向用户提问。',
  '14. 摘要要准确、可接续、可执行。详细程度服从“是否影响后续工作”，不要为了完整而堆历史。',
  '15. 不要记录旧对话中某一时刻的临时仓库状态，例如 git status 为空，除非它直接影响下一步；新对话应重新确认当前仓库状态。',
  '16. “已完成事项”只能表达为旧对话中已完成或曾修改过；不要暗示新对话无需按当前仓库重新确认。',
  '17. “已知定位线索”最多写 6-8 条，优先写模块职责、数据流、事件和接口关系；不要展开成长文件清单。',
  '18. “用户约束与偏好”只记录旧对话中用户额外强调、或与当前任务直接相关的约束；不要复制 AGENTS.md、系统/开发者指令或仓库通用规范。',
  '19. 摘要输出语言必须根据用户明确要求、最新真实任务、历史对话上下文和目标产物自动判断；不要因为本摘要生成提示词是中文就默认输出中文。',
  '20. 先判断目标回答语言，并在摘要的 Response Language 小节写出判断结果。Use the English template below as the canonical structure.',
  '21. If the target response language is not English, translate every heading and all body text from the English canonical template into the target language. Do not keep English headings unless the target response language is English.',
  '',
  '请严格按以下 canonical structure 输出。下面的小节说明也属于模板约束；如果目标语言不是英文，应一起翻译为目标语言后输出：',
  '',
  '# Continuation Summary',
  '',
  '## Response Language',
  'State the target response language and the evidence used to infer it. Prefer explicit user instructions first, then the latest substantive user request, conversation context, and the target artifact language.',
  '',
  '## Current Goal',
  'Explain the user’s latest real goal in 2-5 sentences.',
  '',
  'Requirements:',
  '- Prioritize the latest user request.',
  '- The current request to generate this continuation summary is not the current goal; do not include the summary-generation task, no-tool requirement, no-file-change requirement, or other temporary instructions that only apply to this summary turn.',
  '- If the last few turns are about reviewing or adjusting continuation summaries, trace back to the latest substantive non-continuation, non-summary-review task and use that as the current goal.',
  '- If the current task is only “review the plan, do not edit code yet”, say so explicitly.',
  '- If the user has already said “can edit / go ahead / start changing”, say so explicitly.',
  '- Do not let older broad goals override the latest goal.',
  '',
  '## User Constraints and Preferences',
  'Only list user constraints or preferences from the old conversation that are directly relevant to the current task.',
  '',
  'Requirements:',
  '- Do not copy AGENTS.md, system instructions, developer instructions, or generic repo rules.',
  '- Do not include rules that the new environment will already inherit automatically.',
  '- If the user explicitly emphasized a general rule and it directly affects the current task, keep it.',
  '- Prioritize user-corrected boundaries, preferred decision style, and whether code edits are currently authorized.',
  '- Validation status, skipped commands, and manual verification expectations belong in Verification Status, not here.',
  '- Keep only constraints that affect next actions.',
  '',
  '## Final Conclusions',
  'List final conclusions that the old conversation settled on.',
  '',
  'Requirements:',
  '- For each item, include conclusion, reason, and evidence source.',
  '- Evidence sources can be user confirmation, static code inspection, historical commit comparison, command output, API response, or unverified.',
  '- If multiple features are involved, use a table.',
  '- Do not mix in intermediate conclusions that were later overturned.',
  '',
  '## Discarded Prior Conclusions',
  'List conclusions that appeared during the conversation but were later corrected by the user or evidence.',
  '',
  'For each item, state:',
  '- What the old conclusion was.',
  '- Why it was wrong.',
  '- What final conclusion should be followed instead.',
  '- Only include prior conclusions that would directly affect the next step; fold minor historical corrections into Risks and Notes.',
  '',
  'If there are no discarded conclusions, write “None”.',
  '',
  '## Completed Work',
  'List code changes, plan confirmations, or verified findings that were actually completed in the old conversation.',
  '',
  'Requirements:',
  '- Distinguish code changes from planning or investigation only.',
  '- Say “completed or changed in the old conversation”; do not imply the new conversation can skip checking the current repository.',
  '- File paths can be background hints, but do not require the new conversation to read specific files first.',
  '- If only static verification was done, say that runtime verification was not done.',
  '- Do not include planned work as completed work.',
  '',
  '## Open Items',
  'List remaining work, confirmations, or verifications.',
  '',
  'Requirements:',
  '- Order by priority.',
  '- For each item, explain why it remains open.',
  '- If user confirmation is needed, state exactly what needs confirmation.',
  '- Do not list loosely related possibilities as required work.',
  '',
  '## Known Navigation Hints',
  'List modules, components, APIs, events, or data-flow hints found in the old conversation.',
  '',
  'Requirements:',
  '- This is navigation guidance, not a fixed reading checklist.',
  '- Keep at most 6-8 items; merge extras into data flows or responsibilities.',
  '- Do not write “must read these files”.',
  '- Do not include long file lists.',
  '- Remind the new conversation to re-check current code based on the current request and current repository state.',
  '- Prefer module responsibilities, data flow, events, and API names over file dumps.',
  '',
  '## Key Interfaces and Data Contracts',
  'List interfaces, params, return values, field meanings, and user-confirmed contracts needed for next work.',
  '',
  'Requirements:',
  '- Mark what was user-confirmed, code-inferred, or still needs verification.',
  '- If docs and actual API responses conflicted, state that clearly.',
  '- Call out easy-to-miss endpoint paths, field names, or enum values.',
  '- Only include interfaces, params, fields, or contracts that the next step will directly call, modify, or depend on.',
  '',
  '## Risks and Notes',
  'List points that are easy to mis-edit, misjudge, or break.',
  '',
  'Requirements:',
  '- Emphasize issues the user corrected.',
  '- State what must not be accidentally changed by the current task.',
  '- For shared components, services, or styles, state the affected scope.',
  '- Avoid generic risk statements.',
  '',
  '## Verification Status',
  'List verification that was done and verification that was not done.',
  '',
  'Requirements:',
  '- Include concrete commands or verification methods.',
  '- If build, lint, tsc, or dev server was not run, say so.',
  '- If the user plans to verify in the UI, state the key scenarios they need to check.',
  '- Do not claim anything is working if it was not verified.',
  '',
  '## Suggested Next Step',
  'Give the new Codex instance tactical guidance for continuing.',
  '',
  'Requirements:',
  '- Base this on Current Goal and Open Items.',
  '- Do not mechanically list files.',
  '- Do not expand scope.',
  '- If the user did not explicitly authorize code edits, suggest a plan or confirmation question first.',
  '- If the user already said to edit, suggest the smallest implementation and verification path.',
  '- Open Items lists concrete pending work; Suggested Next Step gives strategy without repeating the full implementation list.'
].join('\n')

const createThreadContinuationPrompt = summary => [
  '以下是从旧 Codex 对话生成的接续摘要。请把它作为本对话的初始上下文。你不能假设自己还能访问旧对话完整历史；如果需要确认事实，请读取当前仓库文件或让用户提供证据。',
  '如果摘要中包含原线程 ID，它只作为追溯线索；不要依赖一定能按 ID 读取旧对话原文。',
  '请根据用户明确要求、接续摘要、原始任务、历史对话上下文和目标产物自动判断后续回答语言；不要根据本段接续说明的语言决定回答语言。',
  '',
  '<接续摘要>',
  summary.trim(),
  '</接续摘要>',
  '',
  '请先完整理解以上接续摘要，把它作为当前对话上下文；如果本条消息没有新的明确任务，请等待用户下一步指令。'
].join('\n')

const createThreadTurnCompletionWaiter = (client, threadId, options = {}) => {
  const label = normalizePromptString(options.label, '接续摘要')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : THREAD_CONTINUATION_SUMMARY_TIMEOUT_MS
  const states = new Map()
  let targetTurnId = null
  let resolveWait = null
  let rejectWait = null
  let settled = false
  let timeoutTimer = null
  let textGraceTimer = null

  const getState = turnId => {
    if (!states.has(turnId)) {
      states.set(turnId, {
        turn: null,
        agentText: ''
      })
    }

    return states.get(turnId)
  }

  const cleanup = () => {
    settled = true

    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
    }

    if (textGraceTimer) {
      clearTimeout(textGraceTimer)
    }

    client.events.off('notification', handleNotification)
    client.events.off('close', handleClose)
  }

  const finish = result => {
    if (!resolveWait) {
      cleanup()
      return
    }

    cleanup()
    resolveWait(result)
  }

  const fail = error => {
    if (!rejectWait) {
      cleanup()
      return
    }

    cleanup()
    rejectWait(error)
  }

  const maybeFinish = turnId => {
    if (settled || !targetTurnId || turnId !== targetTurnId || !resolveWait || !rejectWait) {
      return
    }

    const state = states.get(turnId)
    const turn = state?.turn

    if (!turn) {
      return
    }

    if (turn.status === 'failed' || turn.status === 'interrupted') {
      fail(new Error(`${label}未完成：${turn.status}`))
      return
    }

    if (turn.status !== 'completed') {
      return
    }

    const agentText = state.agentText.trim()

    if (agentText) {
      finish({ turn, agentText })
      return
    }

    if (!textGraceTimer) {
      textGraceTimer = setTimeout(() => {
        fail(new Error(`${label}已完成，但没有返回可用文本。`))
      }, THREAD_CONTINUATION_TEXT_GRACE_MS)
    }
  }

  const handleNotification = message => {
    if (message.params?.threadId !== threadId) {
      return
    }

    if (message.method === 'item/completed' && typeof message.params?.turnId === 'string') {
      const item = message.params.item

      if (item?.type === 'agentMessage' && typeof item.text === 'string') {
        const state = getState(message.params.turnId)
        state.agentText = item.text
        maybeFinish(message.params.turnId)
      }

      return
    }

    if (message.method === 'turn/completed' && typeof message.params?.turn?.id === 'string') {
      const state = getState(message.params.turn.id)
      state.turn = message.params.turn
      maybeFinish(message.params.turn.id)
    }
  }

  const handleClose = error => {
    fail(error instanceof Error ? error : new Error('Codex app-server connection closed.'))
  }

  client.events.on('notification', handleNotification)
  client.events.on('close', handleClose)

  return {
    waitFor: turnId => new Promise((resolve, reject) => {
      targetTurnId = turnId
      resolveWait = resolve
      rejectWait = reject

      timeoutTimer = setTimeout(() => {
        fail(new Error(`${label}等待超时。`))
      }, timeoutMs)

      maybeFinish(turnId)
    }),
    dispose: cleanup
  }
}

const runThreadContinuationSummary = async (threadId, cwd) => {
  const client = await getCodexClient()
  const normalizedCwd = typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : null
  const forkParams = {
    threadId,
    ephemeral: true
  }

  if (normalizedCwd) {
    forkParams.cwd = normalizedCwd
  }

  const forkResponse = await client.request('thread/fork', forkParams, 30000)
  const forkThreadId = forkResponse?.thread?.id

  if (!forkThreadId) {
    throw new Error('接续摘要未能创建 fork 对话。')
  }

  const completionWaiter = createThreadTurnCompletionWaiter(client, forkThreadId)
  let completion = null

  try {
    const turnResponse = await client.request('turn/start', {
      threadId: forkThreadId,
      input: [createTextUserInput(createThreadContinuationSummaryPrompt({
        threadId,
        cwd: normalizedCwd
      }))],
      ...(normalizedCwd ? { cwd: normalizedCwd } : {})
    }, 30000)
    const turnId = turnResponse?.turn?.id

    if (!turnId) {
      throw new Error('接续摘要未能启动 turn。')
    }

    completion = await completionWaiter.waitFor(turnId)
  } catch (error) {
    completionWaiter.dispose()
    throw error
  }

  const summary = completion.agentText

  if (!summary) {
    throw new Error('接续摘要没有返回可用文本。')
  }

  return {
    threadId,
    forkThreadId,
    summary,
    prompt: createThreadContinuationPrompt(summary),
    cwd: normalizedCwd
  }
}

const createLocalImageUserInput = imagePath => ({
  type: 'localImage',
  path: imagePath
})

const createExplorationTitle = (prompt, images) => {
  const compactPrompt = normalizeExplorationString(prompt, 120).replace(/\s+/g, ' ').trim()

  if (compactPrompt) {
    return compactPrompt.slice(0, 40)
  }

  return images.length > 0 ? '图片优选' : '新优选'
}

const normalizeExplorationConcurrency = value => Math.min(Math.max(Number(value) || 2, 2), 5)

const normalizeImagePathInput = value => {
  const imagePath = normalizeExplorationString(value, 4000).trim()

  if (!imagePath || !path.isAbsolute(imagePath)) {
    return null
  }

  const extension = path.extname(imagePath).replace('.', '').toLowerCase()

  return EXPLORATION_IMAGE_EXTENSIONS.has(extension) ? imagePath : null
}

const copyExplorationImages = async (runId, imagePaths) => {
  const normalizedPaths = Array.isArray(imagePaths)
    ? imagePaths.map(normalizeImagePathInput).filter(Boolean)
    : []

  if (normalizedPaths.length === 0) {
    return []
  }

  const targetDir = getExplorationAttachmentsDir(runId)
  await fsp.mkdir(targetDir, { recursive: true })

  const copiedImages = []

  for (const [index, sourcePath] of normalizedPaths.entries()) {
    const extension = path.extname(sourcePath)
    const baseName = path.basename(sourcePath, extension).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || `image-${index + 1}`
    const targetPath = path.join(targetDir, `${index + 1}-${baseName}${extension.toLowerCase()}`)

    await fsp.copyFile(sourcePath, targetPath)
    copiedImages.push({
      id: crypto.randomUUID(),
      name: path.basename(sourcePath),
      path: targetPath,
      createdAt: Date.now()
    })
  }

  return copiedImages
}

const createExplorationCandidatePrompt = (run, candidate) => [
  '你正在参与一次 Codex Sidecar 的“只读并发优选”。这是多个候选答案之一，后续会把所有候选交给另一个临时对话做对比总结。',
  `候选编号：${candidate.index + 1} / ${run.concurrency}`,
  '',
  '硬性要求：',
  '1. 只能做只读分析。不要修改文件，不要创建提交，不要启动长期服务。',
  '2. 如果需要读取本地文件或运行命令，只能用于验证事实；不要执行会改变仓库或系统状态的命令。',
  '3. 如果缺少上下文或证据不足，明确标注“未验证”或“需验证”，不要编造。',
  '4. 输出要独立完整，便于后续 judge 对比。请直接给结论、关键依据、风险、建议。',
  '5. 请独立选择分析角度，不要假设其他候选会覆盖同样内容；优先寻找容易被单次回答遗漏的风险、约束或替代方案。',
  '6. 输出语言必须根据用户明确要求、原始任务、历史对话上下文和目标产物自动判断；不要根据本内部提示词、候选标签或 Sidecar UI 语言决定。',
  '',
  run.sourceThreadId
    ? `本候选基于已 fork 的历史对话上下文：${run.sourceThreadTitle || run.sourceThreadId}`
    : '本候选没有历史对话上下文；请只基于本次输入和可只读验证的信息回答。',
  '',
  '<用户任务>',
  run.prompt.trim() || '用户只上传了图片，请分析图片并给出有用结论。',
  '</用户任务>'
].join('\n')

const createExplorationSummaryPrompt = run => {
  const completedCandidates = run.candidates.filter(candidate => candidate.status === 'completed' && candidate.output.trim())
  const failedCandidates = run.candidates.filter(candidate => candidate.status === 'failed')

  return [
    '你正在担任 Codex Sidecar 并发优选的 judge。你拥有与候选阶段相同的历史上下文和原始输入，下面还会提供同一任务的多个候选回答作为参考材料。请结合原始上下文、原始输入和候选回答，生成一个最佳最终回答。',
    '',
    '要求：',
    '1. 候选回答是参考材料，不是唯一信息来源；不要简单投票。',
    '2. 优先采纳符合历史上下文、原始问题、原始图片和可验证证据的内容。',
    '3. 如果候选之间冲突，或候选与原始上下文/图片冲突，说明取舍理由；证据不足时明确标注不确定。',
    '4. 可以补充候选遗漏但历史上下文或原始输入中已经明确的信息；不要编造无法从上下文、输入或候选中支持的信息。',
    '5. 最终回答要可以直接复制给用户使用。不要提及“候选 1/2/3”这样的内部流程，除非需要说明分歧。',
    '6. 最终回答语言必须根据用户明确要求、原始任务、历史对话上下文和目标产物自动判断；不要根据本内部提示词、候选标签、候选材料的语言或 Sidecar UI 语言决定。',
    '7. 候选材料的语言不是最终回答语言依据；如果候选语言和原始任务/历史上下文语言冲突，以原始任务和历史上下文为准。',
    '',
    '<原始任务>',
    run.prompt.trim() || '用户只上传了图片，请分析图片并给出有用结论。',
    '</原始任务>',
    '',
    '<上下文>',
    run.sourceThreadId
      ? `候选基于历史对话 fork：${run.sourceThreadTitle || run.sourceThreadId}`
      : '候选没有历史对话上下文。',
    '</上下文>',
    '',
    '<候选回答>',
    ...completedCandidates.map(candidate => [
      `## 候选 ${candidate.index + 1}`,
      candidate.output.trim()
    ].join('\n')),
    '</候选回答>',
    '',
    failedCandidates.length > 0
      ? [
          '<失败候选>',
          ...failedCandidates.map(candidate => `候选 ${candidate.index + 1}: ${candidate.error || '未知错误'}`),
          '</失败候选>'
        ].join('\n')
      : ''
  ].filter(Boolean).join('\n')
}

const createExplorationInput = (run, candidate) => [
  createTextUserInput(createExplorationCandidatePrompt(run, candidate)),
  ...run.images.map(image => createLocalImageUserInput(image.path))
]

const createExplorationSummaryInput = run => [
  createTextUserInput(createExplorationSummaryPrompt(run)),
  ...run.images.map(image => createLocalImageUserInput(image.path))
]

const createReadOnlyThreadParams = cwd => ({
  ephemeral: true,
  approvalPolicy: 'never',
  sandbox: 'read-only',
  ...(cwd ? { cwd } : {})
})

const createReadOnlyTurnParams = (threadId, input, cwd = null) => ({
  threadId,
  input,
  approvalPolicy: 'never',
  sandboxPolicy: {
    type: 'readOnly',
    networkAccess: false
  },
  ...(cwd ? { cwd } : {})
})

const startExplorationThread = async (client, run, label = '优选线程') => {
  const cwd = run.sourceThreadCwd && path.isAbsolute(run.sourceThreadCwd) ? run.sourceThreadCwd : null

  if (run.sourceThreadId) {
    const forkResponse = await client.request('thread/fork', {
      threadId: run.sourceThreadId,
      ...createReadOnlyThreadParams(cwd)
    }, 30000)
    const forkThreadId = forkResponse?.thread?.id

    if (!forkThreadId) {
      throw new Error(`${label}未能创建 fork 对话。`)
    }

    return {
      threadId: forkThreadId,
      cwd
    }
  }

  const startResponse = await client.request('thread/start', createReadOnlyThreadParams(null), 30000)
  const threadId = startResponse?.thread?.id

  if (!threadId) {
    throw new Error(`${label}未能创建临时对话。`)
  }

  return {
    threadId,
    cwd: null
  }
}

const runExplorationCandidate = async (runId, candidateId) => {
  const client = await getCodexClient()
  let currentRun = await getExplorationRun(runId)
  const candidate = currentRun?.candidates.find(item => item.id === candidateId)

  if (!currentRun || !candidate) {
    throw new Error('优选记录不存在。')
  }

  await updateExplorationRun(runId, run => ({
    candidates: run.candidates.map(item => item.id === candidateId
      ? {
          ...item,
          status: 'running',
          startedAt: Date.now(),
          error: null
        }
      : item)
  }))

  let completionWaiter = null

  try {
    currentRun = await getExplorationRun(runId)

    if (!currentRun) {
      throw new Error('优选记录不存在。')
    }

    const thread = await startExplorationThread(client, currentRun, '优选候选')

    await updateExplorationRun(runId, run => ({
      candidates: run.candidates.map(item => item.id === candidateId
        ? {
            ...item,
            threadId: thread.threadId
          }
        : item)
    }))

    completionWaiter = createThreadTurnCompletionWaiter(client, thread.threadId, {
      label: `优选候选 ${candidate.index + 1}`,
      timeoutMs: EXPLORATION_TURN_TIMEOUT_MS
    })

    const turnResponse = await client.request('turn/start', createReadOnlyTurnParams(
      thread.threadId,
      createExplorationInput(currentRun, candidate),
      thread.cwd
    ), 30000)
    const turnId = turnResponse?.turn?.id

    if (!turnId) {
      throw new Error('优选候选未能启动 turn。')
    }

    await updateExplorationRun(runId, run => ({
      candidates: run.candidates.map(item => item.id === candidateId
        ? {
            ...item,
            turnId
          }
        : item)
    }))

    const completion = await completionWaiter.waitFor(turnId)

    await updateExplorationRun(runId, run => ({
      candidates: run.candidates.map(item => item.id === candidateId
        ? {
            ...item,
            status: 'completed',
            output: completion.agentText,
            error: null,
            completedAt: Date.now()
          }
        : item)
    }))
  } catch (error) {
    await updateExplorationRun(runId, run => ({
      candidates: run.candidates.map(item => item.id === candidateId
        ? {
            ...item,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            completedAt: Date.now()
          }
        : item)
    }))
  } finally {
    completionWaiter?.dispose()
  }
}

const runExplorationSummary = async runId => {
  const client = await getCodexClient()
  const run = await getExplorationRun(runId)

  if (!run) {
    throw new Error('优选记录不存在。')
  }

  const completedCandidates = run.candidates.filter(candidate => candidate.status === 'completed' && candidate.output.trim())

  if (completedCandidates.length === 0) {
    await updateExplorationRun(runId, currentRun => ({
      status: 'failed',
      completedAt: Date.now(),
      summary: {
        ...currentRun.summary,
        status: 'failed',
        error: '所有候选都失败，无法生成总结。',
        completedAt: Date.now()
      }
    }))
    return
  }

  await updateExplorationRun(runId, currentRun => ({
    status: 'summarizing',
    summary: {
      ...currentRun.summary,
      status: 'running',
      error: null,
      startedAt: Date.now()
    }
  }))

  let completionWaiter = null

  try {
    const latestRun = await getExplorationRun(runId)

    if (!latestRun) {
      throw new Error('优选记录不存在。')
    }

    const thread = await startExplorationThread(client, latestRun, '优选总结')

    await updateExplorationRun(runId, currentRun => ({
      summary: {
        ...currentRun.summary,
        threadId: thread.threadId
      }
    }))

    completionWaiter = createThreadTurnCompletionWaiter(client, thread.threadId, {
      label: '优选总结',
      timeoutMs: EXPLORATION_TURN_TIMEOUT_MS
    })

    const turnResponse = await client.request('turn/start', createReadOnlyTurnParams(
      thread.threadId,
      createExplorationSummaryInput(latestRun),
      thread.cwd
    ), 30000)
    const turnId = turnResponse?.turn?.id

    if (!turnId) {
      throw new Error('优选总结未能启动 turn。')
    }

    await updateExplorationRun(runId, currentRun => ({
      summary: {
        ...currentRun.summary,
        turnId
      }
    }))

    const completion = await completionWaiter.waitFor(turnId)
    const failedCount = latestRun.candidates.filter(candidate => candidate.status === 'failed').length

    await updateExplorationRun(runId, currentRun => ({
      status: failedCount > 0 ? 'partialFailed' : 'completed',
      completedAt: Date.now(),
      summary: {
        ...currentRun.summary,
        status: 'completed',
        output: completion.agentText,
        error: null,
        completedAt: Date.now()
      }
    }))
  } catch (error) {
    await updateExplorationRun(runId, currentRun => ({
      status: 'failed',
      completedAt: Date.now(),
      summary: {
        ...currentRun.summary,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now()
      }
    }))
  } finally {
    completionWaiter?.dispose()
  }
}

const runExploration = async runId => {
  try {
    const run = await getExplorationRun(runId)

    if (!run) {
      return
    }

    await Promise.all(run.candidates.map(candidate => runExplorationCandidate(runId, candidate.id)))
    await runExplorationSummary(runId)
  } catch (error) {
    await updateExplorationRun(runId, currentRun => ({
      status: 'failed',
      completedAt: Date.now(),
      summary: {
        ...currentRun.summary,
        status: currentRun.summary.status === 'completed' ? 'completed' : 'failed',
        error: currentRun.summary.output ? currentRun.summary.error : error instanceof Error ? error.message : String(error),
        completedAt: Date.now()
      }
    }))
  }
}

const createExplorationRun = async request => {
  const prompt = normalizeExplorationString(request?.prompt, 200000).trim()
  const concurrency = normalizeExplorationConcurrency(request?.concurrency)
  const sourceThreadId = normalizeExplorationString(request?.sourceThreadId, 240).trim() || null
  const imagePaths = Array.isArray(request?.imagePaths) ? request.imagePaths : []

  if (!prompt && imagePaths.length === 0) {
    throw new Error('优选内容不能为空。')
  }

  const runId = crypto.randomUUID()
  const sourceThread = sourceThreadId
    ? (await dataEngine.request('projection.get', null)).codexStore?.threads.find(thread => thread.id === sourceThreadId) || null
    : null

  if (sourceThreadId && !sourceThread) {
    throw new Error('选择的历史对话不存在或已不可用。')
  }

  const images = await copyExplorationImages(runId, imagePaths)
  const now = Date.now()
  const candidates = Array.from({ length: concurrency }, (_, index) => ({
    id: crypto.randomUUID(),
    index,
    threadId: null,
    turnId: null,
    status: 'pending',
    output: '',
    error: null,
    startedAt: null,
    completedAt: null
  }))
  const run = normalizeExplorationRun({
    id: runId,
    title: createExplorationTitle(prompt, images),
    prompt,
    images,
    concurrency,
    sourceThreadId: sourceThread?.id || null,
    sourceThreadTitle: sourceThread ? (sourceThread.name || sourceThread.preview || null) : null,
    sourceThreadCwd: sourceThread?.cwd || null,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    candidates,
    summary: createDefaultExplorationSummary()
  })

  const savedRun = await getSidecarStore().saveExplorationRun(run)

  await sendExplorationsChanged()
  void runExploration(savedRun.id)

  return savedRun
}

ipcMain.handle('sidecar:getCodexProjection', async () => {
  const projection = await dataEngine.request('projection.get', null)

  return {
    ...projection,
    generation: dataEngine.getGeneration()
  }
})

ipcMain.handle('sidecar:getSidecarData', async () => readSidecarData())

ipcMain.handle('sidecar:getHookStatus', async (_event, options = {}) => {
  if (options?.refresh === false) {
    return sidecarHookStatus
  }

  return refreshSidecarHookStatus()
})

ipcMain.handle('sidecar:openCodexSettings', async () => {
  await shell.openExternal('codex://settings')
  return true
})

ipcMain.handle('sidecar:openGitHub', async () => {
  await shell.openExternal(APP_REPOSITORY_URL)
  return true
})

ipcMain.handle('sidecar:getUpdateState', async () => getUpdateState())

ipcMain.handle('sidecar:installUpdate', async () => installUpdate())

const setFavoriteItem = async (item, favorite) => {
  if (typeof favorite !== 'boolean') {
    throw new Error('favorite must be a boolean.')
  }

  const normalizedItem = normalizeFavoriteItem(item)

  if (!normalizedItem) {
    throw new Error('favorite item is invalid.')
  }

  return getSidecarStore().setFavorite(normalizedItem, favorite)
}

ipcMain.handle('sidecar:setFavorite', async (_event, item, favorite) => {
  const result = await setFavoriteItem(item, favorite)

  await sendSidecarDataChanged()
  return result
})

ipcMain.handle('sidecar:savePromptTemplates', async (_event, templates) => {
  if (!Array.isArray(templates)) {
    throw new Error('templates must be an array.')
  }

  const promptTemplates = await getSidecarStore().savePromptTemplates(normalizePromptTemplates(templates))

  await sendSidecarDataChanged()
  return promptTemplates
})

ipcMain.handle('sidecar:setLanguageMode', async (_event, languageMode) => {
  const settings = await getSidecarStore().updateSettings({ languageMode: normalizeLanguageMode(languageMode) })

  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setThemeMode', async (_event, themeMode) => {
  const settings = await getSidecarStore().updateSettings({ themeMode: normalizeThemeMode(themeMode) })

  applyThemeModeToNativeTheme(settings.themeMode)
  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setMiniOverDock', async (_event, miniOverDock) => {
  const settings = await getSidecarStore().updateSettings({ miniOverDock: normalizeMiniOverDock(miniOverDock) })

  applyMiniOverDock(settings.miniOverDock)
  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setShowMiniTool', async (_event, showMiniTool) => {
  const settings = await getSidecarStore().updateSettings({ showMiniTool: normalizeShowMiniTool(showMiniTool) })

  applyShowMiniTool(settings.showMiniTool)
  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setShowMiniPrompts', async (_event, showMiniPrompts) => {
  const settings = await getSidecarStore().updateSettings({ showMiniPrompts: normalizeShowMiniPrompts(showMiniPrompts) })

  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:exportData', async () => {
  const sidecarData = await readSidecarData()
  const result = await dialog.showSaveDialog(mainWindow, {
    title: getSidecarText(sidecarData.settings, 'exportTitle'),
    defaultPath: `codex-sidecar-export-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }

  await dataEngine.request('data.exportFile', {
    filePath: result.filePath
  })
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('sidecar:importData', async () => {
  const currentData = await readSidecarData()
  const result = await dialog.showOpenDialog(mainWindow, {
    title: getSidecarText(currentData.settings, 'importTitle'),
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }

  const imported = await dataEngine.request('data.importFile', {
    filePath: result.filePaths[0]
  })
  const settings = imported.sidecarData.settings

  applyThemeModeToNativeTheme(settings.themeMode)
  applyMiniOverDock(settings.miniOverDock)
  applyShowMiniTool(settings.showMiniTool)
  await sendSidecarDataChanged(imported.sidecarData)
  await sendExplorationsChanged()

  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle('sidecar:openThread', async (_event, threadId) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  await openCodexThread(threadId)
  return true
})

ipcMain.handle('sidecar:continueThreadWithSummary', async (_event, threadId, cwd, sourceUpdatedAt) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  const result = await runThreadContinuationSummary(threadId, cwd)
  const continuationResult = await getSidecarStore().saveContinuationResult({
    threadId,
    sourceUpdatedAt: normalizeNullableTimestamp(sourceUpdatedAt),
    summary: result.summary,
    prompt: result.prompt,
    completedAt: Date.now(),
    unread: true
  })

  await sendSidecarDataChanged()

  return {
    ...continuationResult,
    forkThreadId: result.forkThreadId,
  }
})

ipcMain.handle('sidecar:getContinuationResult', async (_event, threadId) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  return getSidecarStore().getContinuationResult(threadId)
})

ipcMain.handle('sidecar:setContinuationResultUnread', async (_event, threadId, unread) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  if (typeof unread !== 'boolean') {
    throw new Error('unread must be a boolean.')
  }

  const result = await getSidecarStore().setContinuationResultUnread(threadId, unread)

  await sendSidecarDataChanged()
  return result
})

ipcMain.handle('sidecar:chooseExplorationImages', async event => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow
  const result = await dialog.showOpenDialog(sourceWindow, {
    title: '选择优选图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{
      name: 'Images',
      extensions: [...EXPLORATION_IMAGE_EXTENSIONS]
    }]
  })

  if (result.canceled) {
    return []
  }

  return result.filePaths
    .map(filePath => normalizeImagePathInput(filePath))
    .filter(Boolean)
    .map(filePath => ({
      path: filePath,
      name: path.basename(filePath)
    }))
})

ipcMain.handle('sidecar:createExplorationRun', async (_event, request) => createExplorationRun(request))

ipcMain.handle('sidecar:getExplorations', async () => getSidecarStore().listExplorationRuns())

ipcMain.handle('sidecar:getExplorationRun', async (_event, runId) => {
  const normalizedId = normalizeExplorationString(runId, 120).trim()

  if (!normalizedId) {
    return null
  }

  return getExplorationRun(normalizedId)
})

ipcMain.handle('sidecar:deleteExplorationRun', async (_event, runId) => {
  const normalizedId = normalizeExplorationString(runId, 120).trim()

  if (!normalizedId) {
    return null
  }

  const deletedRun = await getSidecarStore().deleteExplorationRun(normalizedId)

  if (!deletedRun) {
    return null
  }

  const resultWindow = explorationResultWindows.get(deletedRun.id)

  if (resultWindow && !resultWindow.isDestroyed()) {
    resultWindow.close()
  }

  try {
    await fsp.rm(getExplorationAttachmentsDir(deletedRun.id), { recursive: true, force: true })
  } catch {
    // Attachment cleanup is best-effort; the Sidecar record is already deleted.
  }

  await sendExplorationsChanged()
  return deletedRun
})

ipcMain.handle('sidecar:openExplorationResult', async (_event, runId) => {
  const run = await getExplorationRun(normalizeExplorationString(runId, 120).trim())

  if (!run) {
    throw new Error('优选记录不存在。')
  }

  createExplorationResultWindow(run.id)
  return true
})

ipcMain.handle('sidecar:getThreadTurnPreviews', async (_event, threadId) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  return dataEngine.request('thread.turnPreviews', {
    threadId
  }, {
    timeoutMs: 16000
  })
})

ipcMain.handle('sidecar:showPopupMenu', async (event, options) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow

  return showPopupMenu(sourceWindow, options)
})

ipcMain.handle('sidecar:getPopupMenuData', async () => popupMenuData)

ipcMain.handle('sidecar:selectPopupMenuItem', async (_event, itemId) => {
  const selectedId = normalizePromptString(itemId).trim()

  if (!selectedId || !popupMenuData?.items.some(item => item.id === selectedId && !item.disabled)) {
    return false
  }

  settlePopupMenu(selectedId)
  return true
})

ipcMain.handle('sidecar:closePopupMenu', async () => {
  settlePopupMenu(null)
  return true
})

ipcMain.handle('sidecar:showThreadMenu', async (event, items, point) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow
  const result = await showPopupMenu(sourceWindow, {
    items: Array.isArray(items)
      ? items.map(item => ({
          id: item?.id,
          label: item?.title
        }))
      : [],
    point
  })

  if (result.selectedId) {
    await openCodexThread(result.selectedId)
    return true
  }

  return false
})

ipcMain.handle('sidecar:openNewThread', async (_event, options) => {
  await openNewCodexThread(options)
  return true
})

ipcMain.handle('sidecar:copyText', async (_event, text) => {
  clipboard.writeText(String(text || ''))
  return true
})

ipcMain.handle('sidecar:closeWindow', async event => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow

  if (!targetWindow || targetWindow.isDestroyed()) {
    return false
  }

  targetWindow.close()
  return true
})

ipcMain.on('sidecar:miniDragStart', (event, point) => {
  startMiniWindowDrag(event, point)
})

ipcMain.on('sidecar:miniDragMove', (event, point) => {
  moveMiniWindowDrag(event, point)
})

ipcMain.on('sidecar:miniDragEnd', (event, point) => {
  endMiniWindowDrag(event, point)
})

ipcMain.handle('sidecar:getWindowMode', async event => getWindowModeForWebContents(event.sender))

ipcMain.handle('sidecar:showMainWindow', async () => showFullWindow())

ipcMain.handle('sidecar:setWindowMode', async (_event, mode, options = {}) => {
  const nextMode = mode === 'mini' ? 'mini' : 'full'

  if (nextMode === 'mini') {
    const settings = await getSidecarStore().updateSettings({ showMiniTool: true })

    applyShowMiniTool(settings.showMiniTool)
    await sendSidecarDataChanged()
    return true
  }

  return showFullWindow({
    activePanel: normalizeFullPanelKey(options?.activePanel)
  })
})

app.whenReady().then(async () => {
  diagnostics.record('app.startup', {
    appVersion: APP_VERSION,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch
  })
  await initializeDataEngine()

  if (isDataEngineSmokeMode) {
    const projection = await dataEngine.request('projection.refresh', null, {
      timeoutMs: 120_000
    })
    const health = await dataEngine.request('engine.health', null)

    if (!fs.existsSync(getSidecarEngineStorePath())) {
      throw new Error('Data-engine smoke test did not create sidecar-v2.sqlite.')
    }

    if (!projection?.codexStore || !Array.isArray(projection.codexStore.threads)) {
      throw new Error('Data-engine smoke test did not complete its initial projection.')
    }

    process.stdout.write(`${JSON.stringify({
      status: 'ready',
      generation: dataEngine.getGeneration(),
      engine: health,
      projectionRevision: projection.revision,
      database: path.basename(getSidecarEngineStorePath())
    })}\n`)
    dataEngine.dispose()
    dataEngine = null
    dataEngineStore = null
    codexClient?.dispose()
    codexClient = null
    app.exit(0)
    return
  }

  windowState = await readWindowState()
  const initialSidecarData = await readSidecarData()

  applyThemeModeToNativeTheme(initialSidecarData.settings.themeMode)
  applyMiniOverDock(initialSidecarData.settings.miniOverDock)
  currentShowMiniTool = normalizeShowMiniTool(initialSidecarData.settings.showMiniTool)
  await ensureSidecarHookIntegration()
  await refreshSidecarHookStatus({ applyMini: false, broadcast: false })
  initializeAutoUpdate({
    app,
    getWindows: () => BrowserWindow.getAllWindows(),
    beforeQuitForUpdate: () => {}
  })
  createWindow()
  applyShowMiniTool(initialSidecarData.settings.showMiniTool)
  prewarmPopupMenuWindow()
  scheduleAutoUpdateCheck()

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      maybeCheckForUpdatesAfterIdle()
      return
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }

    maybeCheckForUpdatesAfterIdle()
  })

  powerMonitor.on('resume', () => {
    maybeCheckForUpdatesAfterIdle()
  })
}).catch(error => {
  const message = error instanceof Error ? error.message : String(error)

  diagnostics.record('app.startupFailed', {
    error
  })

  if (isDataEngineSmokeMode) {
    process.stderr.write(`Sidecar data-engine smoke failed: ${message}\n`)
    dataEngine?.dispose()
    dataEngine = null
    dataEngineStore = null
    codexClient?.dispose()
    codexClient = null
    app.exit(1)
    return
  }

  dialog.showErrorBox(
    'Codex Sidecar 数据迁移失败',
    `Sidecar 未启动，以避免使用不完整的数据。\n\n${message}\n\n原 sidecar.sqlite 和迁移备份均未删除。`
  )
  app.quit()
})

app.on('child-process-gone', (_event, details) => {
  diagnostics.record('app.childProcessGone', details)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (popupMenuPrewarmTimer) {
    clearTimeout(popupMenuPrewarmTimer)
    popupMenuPrewarmTimer = null
  }

  if (codexClient) {
    codexClient.dispose()
    codexClient = null
  }

  if (dataEngine) {
    dataEngine.dispose()
    dataEngine = null
    dataEngineStore = null
  }
})
