const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, powerMonitor, screen, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
const {
  configureAppDataPaths
} = require('./app-data-paths.cjs')
const {
  SIDECAR_STORE_SCHEMA_VERSION,
  createSidecarStore
} = require('./sidecar-store.cjs')
const {
  contextUsageFromAppServerTokenUsage,
  readLatestTranscriptContextUsage
} = require('./context-usage.cjs')
const {
  SIDECAR_HOOK_EVENTS,
  evaluateSidecarHookStatus
} = require('./sidecar-hooks.cjs')
const {
  getUpdateState,
  initializeAutoUpdate,
  installUpdate,
  maybeCheckForUpdatesAfterIdle,
  scheduleAutoUpdateCheck
} = require('./auto-update.cjs')
const { version: APP_VERSION } = require('../package.json')

configureAppDataPaths({ app, fs })

const APP_REPOSITORY_URL = 'https://github.com/eshengsky/Codex-Sidecar'
const SIDECAR_RUNTIME_SCHEMA_VERSION = 1
const WINDOW_STATE_SCHEMA_VERSION = 2
const CODEX_STORE_DEBOUNCE_MS = 700
const CONTEXT_USAGE_TRANSCRIPT_REFRESH_GRACE_MS = 5000
const POST_OPEN_CODEX_STORE_DELAYS_MS = [300, 1000, 2500]
const HOOK_EVENT_PROCESS_DEBOUNCE_MS = 120
const NATIVE_UNREAD_REFRESH_DELAY_MS = 250
const RATE_LIMITS_BACKGROUND_REFRESH_INTERVAL_MS = 60_000
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
const PROJECTLESS_THREAD_LABEL = '普通对话'
const DEFAULT_CODEX_CONVERSATION_ROOT = path.join(os.homedir(), 'Documents', 'Codex')
const IMAGE_MESSAGE_PREVIEW = '图片消息'
const IMAGE_REFERENCE_PATTERN = /\.(?:png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg)(?::|\s|$|[?#])/i
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+\S/
const HEARTBEAT_MESSAGE_PATTERN = /^<heartbeat(?:\s|>)[\s\S]*<\/heartbeat>\s*$/i
const HEARTBEAT_INSTRUCTIONS_PATTERN = /<instructions(?:\s[^>]*)?>([\s\S]*?)<\/instructions>/i
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
const appStartedAt = Date.now()
const explorationResultWindows = new Map()
let codexClient = null
let codexStoreTimer = null
let globalStateFileWatcher = null
let globalStateDirWatcher = null
let nativeUnreadRefreshTimer = null
let hookEventsWatcher = null
let hookEventTimer = null
let popupMenuPrewarmTimer = null
let hookEventProcessingPromise = null
let cachedNativeUnread = null
let cachedRateLimits = null
let cachedRateLimitsUpdatedAt = 0
let rateLimitsRefreshPromise = null
let windowStateWriteQueue = Promise.resolve()
let sidecarStore = null
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
const latestTurnSignalCache = new Map()

let sidecarHookStatus = {
  ready: false,
  issue: 'missing',
  missingEvents: [...SIDECAR_HOOK_EVENTS],
  untrustedEvents: [],
  disabledEvents: [],
  checkedAt: 0,
  error: null
}

const RUNTIME_STATUS_VALUES = new Set(['idle', 'running', 'waiting', 'failed'])
const RUNTIME_CORRECTION_STATUSES = new Set(['running', 'waiting', 'failed'])
const AGENT_OUTPUT_ITEM_TYPES = new Set(['agentMessage'])
const LANGUAGE_MODES = new Set(['auto', 'en', 'zh'])
const THEME_MODES = new Set(['auto', 'light', 'dark'])
const FULL_PANEL_KEYS = new Set(['threads', 'bookmarks', 'explorations', 'prompts', 'data'])
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

const createDefaultSidecarData = () => ({
  schemaVersion: SIDECAR_STORE_SCHEMA_VERSION,
  promptTemplates: createDefaultPromptTemplates(),
  favorites: [],
  contextUsageByThread: {},
  threadLinks: [],
  continuationResults: {},
  settings: createDefaultSidecarSettings()
})

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

const favoriteItemKey = item => `${item.type}:${item.id}`

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

const normalizeFavoriteItems = rawItems => {
  if (!Array.isArray(rawItems)) {
    return []
  }

  const seen = new Set()
  const items = []

  for (const rawItem of rawItems) {
    const item = normalizeFavoriteItem(rawItem)

    if (!item || seen.has(favoriteItemKey(item))) {
      continue
    }

    seen.add(favoriteItemKey(item))
    items.push(item)
  }

  return items.sort((a, b) => b.createdAt - a.createdAt)
}

const normalizeSidecarData = raw => {
  const fallback = createDefaultSidecarData()

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const hasPromptTemplates = Array.isArray(raw.promptTemplates)

  return {
    schemaVersion: SIDECAR_STORE_SCHEMA_VERSION,
    promptTemplates: hasPromptTemplates
      ? normalizePromptTemplates(raw.promptTemplates)
      : fallback.promptTemplates,
    favorites: normalizeFavoriteItems(Array.isArray(raw.favorites) ? raw.favorites : []),
    contextUsageByThread: raw.contextUsageByThread && typeof raw.contextUsageByThread === 'object' ? raw.contextUsageByThread : {},
    threadLinks: Array.isArray(raw.threadLinks) ? raw.threadLinks : [],
    continuationResults: raw.continuationResults && typeof raw.continuationResults === 'object' ? raw.continuationResults : fallback.continuationResults,
    settings: normalizeSidecarSettings(raw.settings)
  }
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

const getExplorationAttachmentsDir = runId => path.join(app.getPath('userData'), 'exploration-attachments', runId)

const getSidecarStore = () => {
  if (!sidecarStore) {
    sidecarStore = createSidecarStore(getSidecarStorePath())
  }

  return sidecarStore
}

const readJsonFile = async filePath => {
  const contents = await fsp.readFile(filePath, 'utf8')
  return JSON.parse(contents)
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
    return normalizeWindowState(getSidecarStore().getWindowState())
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

const createDefaultRuntimeState = () => ({
  schemaVersion: SIDECAR_RUNTIME_SCHEMA_VERSION,
  threads: {}
})

const normalizeRuntimeState = raw => {
  const fallback = createDefaultRuntimeState()

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const threads = {}
  const rawThreads = raw.threads && typeof raw.threads === 'object' ? raw.threads : {}

  for (const [key, entry] of Object.entries(rawThreads)) {
    if (!entry || typeof entry !== 'object' || !RUNTIME_STATUS_VALUES.has(entry.status)) {
      continue
    }

    threads[key] = {
      status: entry.status,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
      eventName: typeof entry.eventName === 'string' ? entry.eventName : null,
      sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : null,
      turnId: typeof entry.turnId === 'string' ? entry.turnId : null,
      transcriptPath: typeof entry.transcriptPath === 'string' ? entry.transcriptPath : null,
      cwd: typeof entry.cwd === 'string' ? entry.cwd : null,
      failureReason: typeof entry.failureReason === 'string' ? entry.failureReason : null
    }
  }

  return {
    schemaVersion: SIDECAR_RUNTIME_SCHEMA_VERSION,
    threads
  }
}

const readRuntimeState = async () => {
  try {
    return normalizeRuntimeState(await readJsonFile(getRuntimeStatePath()))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return createDefaultRuntimeState()
    }

    return createDefaultRuntimeState()
  }
}

const saveRuntimeState = async state => {
  const normalized = normalizeRuntimeState(state)
  await writeJsonAtomic(getRuntimeStatePath(), normalized)
  return normalized
}

const readSidecarData = async () => getSidecarStore().getSidecarData()

const saveSidecarData = async data => {
  return getSidecarStore().replaceSidecarData(normalizeSidecarData(data))
}

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
  const currentRun = getSidecarStore().getExplorationRun(runId)

  if (!currentRun) {
    return null
  }

  const nextRun = getSidecarStore().saveExplorationRun(normalizeExplorationRun({
    ...currentRun,
    ...(updater(currentRun) || {}),
    id: currentRun.id,
    updatedAt: Date.now()
  }) || currentRun)

  sendExplorationsChanged()
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

const readNativeUnreadState = () => {
  const statePath = getCodexGlobalStatePath()

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const unreadIds = state?.['electron-persisted-atom-state']?.['unread-thread-ids-by-host-v1']?.local

    if (!Array.isArray(unreadIds)) {
      return {
        available: false,
        path: statePath,
        count: 0,
        ids: [],
        error: 'missing unread-thread-ids-by-host-v1.local'
      }
    }

    return {
      available: true,
      path: statePath,
      count: unreadIds.length,
      ids: unreadIds.filter(value => typeof value === 'string'),
      error: null
    }
  } catch (error) {
    return {
      available: false,
      path: statePath,
      count: 0,
      ids: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

const getNativeUnreadState = () => {
  cachedNativeUnread = readNativeUnreadState()
  return cachedNativeUnread
}

const closeNativeUnreadWatchers = () => {
  if (globalStateFileWatcher) {
    globalStateFileWatcher.close()
    globalStateFileWatcher = null
  }

  if (globalStateDirWatcher) {
    globalStateDirWatcher.close()
    globalStateDirWatcher = null
  }
}

const watchNativeUnreadFile = () => {
  if (globalStateFileWatcher) {
    globalStateFileWatcher.close()
    globalStateFileWatcher = null
  }

  const statePath = getCodexGlobalStatePath()

  if (!fs.existsSync(statePath)) {
    return
  }

  // This is intentionally read-only. Codex owns the unread state and may change
  // the persisted atom format between desktop releases.
  globalStateFileWatcher = fs.watch(statePath, { persistent: false }, () => {
    scheduleNativeUnreadRefresh()
  })
}

const scheduleNativeUnreadRefresh = () => {
  if (nativeUnreadRefreshTimer) {
    clearTimeout(nativeUnreadRefreshTimer)
  }

  nativeUnreadRefreshTimer = setTimeout(() => {
    nativeUnreadRefreshTimer = null
    cachedNativeUnread = readNativeUnreadState()
    watchNativeUnreadFile()
    scheduleCodexStoreBroadcast()
  }, NATIVE_UNREAD_REFRESH_DELAY_MS)
}

const watchNativeUnreadState = () => {
  closeNativeUnreadWatchers()

  const statePath = getCodexGlobalStatePath()
  const stateDir = path.dirname(statePath)
  const stateFileName = path.basename(statePath)

  cachedNativeUnread = readNativeUnreadState()
  watchNativeUnreadFile()

  try {
    globalStateDirWatcher = fs.watch(stateDir, { persistent: false }, (_eventType, fileName) => {
      if (!fileName || fileName.toString() === stateFileName) {
        scheduleNativeUnreadRefresh()
      }
    })
  } catch {
    // Directory watching is a latency optimization; renderer polling remains the fallback.
  }
}

const resolveCodexExecutable = () => {
  if (process.env.CODEX_CLI_PATH) {
    return process.env.CODEX_CLI_PATH
  }

  const macBundleCandidates = [
    '/Applications/Codex.app/Contents/Resources/codex',
    path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex')
  ]

  for (const candidate of macBundleCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  if (process.platform === 'darwin') {
    const mdfindResult = spawnSync('mdfind', ['kMDItemCFBundleIdentifier == "com.openai.codex"'], { encoding: 'utf8' })
    const appPaths = mdfindResult.status === 0 ? mdfindResult.stdout.split('\n').filter(Boolean) : []

    for (const appPath of appPaths) {
      const candidate = path.join(appPath, 'Contents', 'Resources', 'codex')

      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  const whichResult = spawnSync('which', ['codex'], { encoding: 'utf8' })
  const detected = whichResult.status === 0 ? whichResult.stdout.trim() : ''

  return detected || 'codex'
}

const createCodexRpcClient = onNotification => {
  const events = new EventEmitter()
  const pending = new Map()
  let proc = null
  let nextId = 1
  let connected = false
  let connectPromise = null
  let lastError = null
  let stderrTail = ''

  const sendMessage = message => {
    if (!proc || !proc.stdin.writable) {
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

  const request = (method, params, timeoutMs = 12000) => new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1

    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timed out waiting for app-server response to ${method}.`))
    }, timeoutMs)

    pending.set(id, { resolve, reject, timer })

    try {
      sendMessage({ method, id, params })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error)
    }
  })

  const connectOnce = () => new Promise((resolve, reject) => {
    const codexPath = resolveCodexExecutable()
    const child = spawn(codexPath, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    proc = child
    connected = false
    stderrTail = ''

    const rl = readline.createInterface({ input: child.stdout })

    rl.on('line', line => {
      if (!line.trim()) {
        return
      }

      try {
        handleMessage(JSON.parse(line))
      } catch (error) {
        lastError = error
      }
    })

    child.stderr.on('data', chunk => {
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

    child.on('exit', code => {
      const error = new Error(`codex app-server exited with code ${code}. ${stderrTail}`.trim())
      rl.close()

      if (proc === child) {
        connected = false
        proc = null
        settlePending(error)
        events.emit('close', error)
      }
    })

    request('initialize', {
      clientInfo: {
        name: 'codex_sidecar',
        title: 'Codex Sidecar',
        version: APP_VERSION
      },
      capabilities: {
        experimentalApi: true
      }
    }, 8000)
      .then(result => {
        if (proc !== child) {
          reject(new Error('Codex app-server connection was replaced before initialization completed.'))
          return
        }

        sendMessage({ method: 'initialized', params: {} })
        connected = true
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

    // The ready-to-show CodexStore and renderer's initial refresh can arrive at
    // the same time; gate connection startup so they share one app-server.
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
    settlePending(new Error('Codex app-server connection closed.'))

    if (currentProc) {
      proc = null
      currentProc.kill()
    }
  }

  return {
    connect,
    request,
    dispose,
    events,
    getStatus: () => ({
      connected,
      lastError: lastError instanceof Error ? lastError.message : lastError ? String(lastError) : null
    })
  }
}

const getCodexClient = async () => {
  if (!codexClient) {
    codexClient = createCodexRpcClient(message => {
      if ([
        'thread/started',
        'thread/status/changed',
        'thread/name/updated',
        'thread/archived',
        'thread/deleted',
        'thread/unarchived',
        'turn/started',
        'turn/completed',
        'thread/tokenUsage/updated',
        'account/rateLimits/updated'
      ].includes(message.method)) {
        void handleCodexNotification(message)
      }
    })

    codexClient.events.on('close', () => {
      scheduleCodexStoreBroadcast()
    })
  }

  await codexClient.connect()
  return codexClient
}

const persistContextUsage = usage => {
  if (!usage?.threadId) {
    return null
  }

  return getSidecarStore().setContextUsage(usage.threadId, usage)
}

const handleCodexNotification = async message => {
  if (message.method === 'thread/tokenUsage/updated') {
    const threadId = message.params?.threadId
    const usage = message.params?.tokenUsage
    const contextUsage = contextUsageFromAppServerTokenUsage(threadId, usage)

    if (contextUsage) {
      persistContextUsage(contextUsage)
    }
  }

  if (message.method === 'account/rateLimits/updated' && codexClient) {
    refreshRateLimitsInBackground(codexClient, { force: true })
    return
  }

  scheduleCodexStoreBroadcast()
}

const listAllThreads = async client => {
  const data = []
  let cursor = null

  do {
    const response = await client.request('thread/list', {
      cursor,
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false
    })

    data.push(...(Array.isArray(response?.data) ? response.data : []))
    cursor = response?.nextCursor || null
  } while (cursor)

  return data
}

const hasAgentOutputItem = turn => {
  const items = Array.isArray(turn?.items) ? turn.items : []

  return items.some(item => AGENT_OUTPUT_ITEM_TYPES.has(item?.type))
}

const hasUserMessageItem = turn => {
  const items = Array.isArray(turn?.items) ? turn.items : []

  return items.some(item => item?.type === 'userMessage')
}

const normalizeMessageWhitespace = value => String(value || '').replace(/\s+/g, ' ').trim()

const isHeartbeatMessageText = text => HEARTBEAT_MESSAGE_PATTERN.test(String(text || '').trim())

const extractHeartbeatInstructionsText = text => {
  const value = String(text || '').trim()

  if (!isHeartbeatMessageText(value)) {
    return null
  }

  return (value.match(HEARTBEAT_INSTRUCTIONS_PATTERN)?.[1] || '').trim()
}

const getAttachmentReferenceTerms = value => {
  const raw = String(value || '').trim()

  if (!raw) {
    return []
  }

  const withoutQuery = raw.split(/[?#]/, 1)[0]
  const baseName = path.basename(withoutQuery)

  return [...new Set([raw, withoutQuery, baseName].filter(term => term.length > 3))]
}

const isImageReferenceLine = line => {
  const value = String(line || '').trim()

  if (!value || !IMAGE_REFERENCE_PATTERN.test(value)) {
    return false
  }

  return /:\s*(?:\/|\\|https?:)/i.test(value) || /(?:codex-clipboard|clipboard|\/var\/folders|\/tmp\/)/i.test(value)
}

const isAttachmentReferenceLine = (line, attachmentTerms) => {
  const value = String(line || '').trim()

  if (!value) {
    return false
  }

  return attachmentTerms.some(term => {
    if (!value.includes(term)) {
      return false
    }

    return term.includes('/') || term.includes('\\') || term.startsWith('http') || isImageReferenceLine(value)
  }) || isImageReferenceLine(value)
}

const stripLeadingAttachmentSectionLabels = lines => {
  let start = 0

  while (start < lines.length) {
    const line = lines[start].trim()

    if (!line || MARKDOWN_HEADING_PATTERN.test(line)) {
      start += 1
      continue
    }

    break
  }

  return lines.slice(start)
}

const cleanUserMessageText = (text, attachmentTerms) => {
  const lines = String(text || '').split(/\r\n|\n|\r/)
  const lastAttachmentLineIndex = lines.reduce((lastIndex, line, index) => {
    return isAttachmentReferenceLine(line, attachmentTerms) ? index : lastIndex
  }, -1)

  if (lastAttachmentLineIndex === -1) {
    return text
  }

  const trailingText = stripLeadingAttachmentSectionLabels(lines.slice(lastAttachmentLineIndex + 1)).join('\n').trim()

  if (trailingText) {
    return trailingText
  }

  return lines
    .filter(line => !isAttachmentReferenceLine(line, attachmentTerms) && !MARKDOWN_HEADING_PATTERN.test(line.trim()))
    .join('\n')
    .trim()
}

const extractUserInputText = input => {
  if (!input || typeof input !== 'object') {
    return ''
  }

  if (input.type === 'text' && typeof input.text === 'string') {
    return input.text
  }

  if (input.type === 'mention' && typeof input.path === 'string') {
    return input.name ? `@${input.name}` : input.path
  }

  if (input.type === 'skill' && typeof input.name === 'string') {
    return `$${input.name}`
  }

  return ''
}

const extractUserInputAttachmentTerms = input => {
  if (!input || typeof input !== 'object') {
    return []
  }

  if (input.type === 'localImage' && typeof input.path === 'string') {
    return getAttachmentReferenceTerms(input.path)
  }

  if (input.type === 'image' && typeof input.url === 'string') {
    return getAttachmentReferenceTerms(input.url)
  }

  return []
}

const extractUserMessageContent = item => {
  const content = Array.isArray(item?.content) ? item.content : []
  const attachmentTerms = content.flatMap(extractUserInputAttachmentTerms)
  const rawText = content.map(extractUserInputText).filter(Boolean).join('\n')
  const heartbeatInstructions = extractHeartbeatInstructionsText(rawText)

  if (heartbeatInstructions != null) {
    return {
      text: heartbeatInstructions,
      hasAttachment: false
    }
  }

  return {
    text: cleanUserMessageText(rawText, [...new Set(attachmentTerms)]),
    hasAttachment: attachmentTerms.length > 0 || content.some(input => input?.type === 'localImage' || input?.type === 'image')
  }
}

const createSearchText = text => {
  const firstLine = String(text || '').trimStart().split(/\r\n|\n|\r/, 1)[0] || ''
  const normalized = normalizeMessageWhitespace(firstLine)

  if (normalized.length <= THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH) {
    return normalized
  }

  return normalized.slice(0, THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH)
}

const epochSecondsToMs = value => {
  return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null
}

const extractAssistantFinalText = items => {
  if (!Array.isArray(items)) {
    return { text: '', itemId: '' }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (item?.type === 'agentMessage' && item.phase === 'final_answer' && typeof item.text === 'string') {
      const text = normalizeMessageWhitespace(item.text)

      if (text) {
        return {
          text,
          itemId: typeof item.id === 'string' ? item.id : ''
        }
      }
    }
  }

  return { text: '', itemId: '' }
}

const readThreadTurnPreviews = async (client, threadId) => {
  const response = await client.request('thread/read', {
    threadId,
    includeTurns: true
  }, 15000)
  const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : []
  const turnPreviews = []

  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : []
    const assistantFinal = extractAssistantFinalText(items)

    for (const item of items) {
      if (item?.type !== 'userMessage') {
        continue
      }

      const { text, hasAttachment } = extractUserMessageContent(item)
      const preview = normalizeMessageWhitespace(text)

      if (!preview && !hasAttachment) {
        continue
      }

      const turnId = typeof turn.id === 'string' && turn.id ? turn.id : `turn-${turnPreviews.length + 1}`

      turnPreviews.push({
        id: `${turnId}:${item.id || turnPreviews.length}`,
        turnId,
        userItemId: typeof item.id === 'string' ? item.id : '',
        userPreview: preview || IMAGE_MESSAGE_PREVIEW,
        userSearchText: createSearchText(text),
        assistantItemId: assistantFinal.itemId,
        assistantPreview: assistantFinal.text,
        createdAt: epochSecondsToMs(turn.startedAt ?? turn.completedAt),
        index: turnPreviews.length + 1
      })
      break
    }
  }

  return turnPreviews
}

const getLastUserMessagePreview = turns => {
  if (!Array.isArray(turns)) {
    return ''
  }

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const items = Array.isArray(turns[turnIndex]?.items) ? turns[turnIndex].items : []

    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex]

      if (item?.type !== 'userMessage') {
        continue
      }

      const { text, hasAttachment } = extractUserMessageContent(item)
      const preview = normalizeMessageWhitespace(text)

      if (preview || hasAttachment) {
        return preview || IMAGE_MESSAGE_PREVIEW
      }
    }
  }

  return ''
}

const createLatestTurnSignal = turn => {
  if (!turn || typeof turn !== 'object') {
    return null
  }

  const status = typeof turn.status === 'string' ? turn.status : null
  const error = turn.error ?? null
  const hasAgentOutput = hasAgentOutputItem(turn)
  const hasUserMessage = hasUserMessageItem(turn)
  const emptyCompleted = status === 'completed' && hasUserMessage && !hasAgentOutput

  return {
    id: typeof turn.id === 'string' ? turn.id : null,
    status,
    error,
    failed: status === 'failed' || error != null || emptyCompleted,
    emptyCompleted,
    hasAgentOutput
  }
}

const createThreadOverview = turns => ({
  latestTurnSignal: Array.isArray(turns) && turns.length > 0
    ? createLatestTurnSignal(turns[turns.length - 1])
    : null,
  lastUserMessagePreview: getLastUserMessagePreview(turns)
})

const readThreadOverview = async (client, thread) => {
  const cacheKey = thread.id
  const cacheVersion = `${thread.updatedAt || ''}:${thread.path || ''}`
  const cached = latestTurnSignalCache.get(cacheKey)

  if (cached?.version === cacheVersion) {
    return {
      latestTurnSignal: cached.signal || null,
      lastUserMessagePreview: cached.lastUserMessagePreview || ''
    }
  }

  try {
    const response = await client.request('thread/read', {
      threadId: thread.id,
      includeTurns: true
    }, 15000)
    const turns = response?.thread?.turns

    if (!Array.isArray(turns) || turns.length === 0) {
      latestTurnSignalCache.set(cacheKey, { version: cacheVersion, signal: null, lastUserMessagePreview: '' })
      return { latestTurnSignal: null, lastUserMessagePreview: '' }
    }

    const overview = createThreadOverview(turns)

    latestTurnSignalCache.set(cacheKey, {
      version: cacheVersion,
      signal: overview.latestTurnSignal,
      lastUserMessagePreview: overview.lastUserMessagePreview
    })
    return overview
  } catch {
    return { latestTurnSignal: null, lastUserMessagePreview: '' }
  }
}

const mapLimit = async (items, limit, mapper) => {
  const results = []
  let index = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

const statusKindFromThread = thread => {
  if (thread.status?.type === 'systemError') {
    return 'failed'
  }

  if (thread.status?.type === 'active') {
    const flags = Array.isArray(thread.status.activeFlags) ? thread.status.activeFlags : []

    if (flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')) {
      return 'waiting'
    }

    return 'running'
  }

  return 'idle'
}

const normalizeHookEventName = eventName => {
  const normalized = String(eventName || '').replace(/[_\-\s]/g, '').toLowerCase()
  const eventNamesByNormalizedName = {
    userpromptsubmit: 'UserPromptSubmit',
    pretooluse: 'PreToolUse',
    permissionrequest: 'PermissionRequest',
    posttooluse: 'PostToolUse',
    stop: 'Stop'
  }

  return eventNamesByNormalizedName[normalized] || null
}

const hookEventNameFromFile = fileName => {
  if (!fileName.endsWith('.json')) {
    return null
  }

  const parts = fileName.slice(0, -5).split('.')
  return normalizeHookEventName(parts[2])
}

const readStringField = (value, keys) => {
  if (!value || typeof value !== 'object') {
    return null
  }

  for (const key of keys) {
    const direct = value[key]

    if (typeof direct === 'string' && direct.trim()) {
      return direct
    }
  }

  return null
}

const extractHookRuntimeMeta = payload => ({
  eventName: normalizeHookEventName(readStringField(payload, ['hook_event_name', 'hookEventName'])),
  sessionId: readStringField(payload, ['session_id', 'sessionId']),
  turnId: readStringField(payload, ['turn_id', 'turnId']),
  transcriptPath: readStringField(payload, ['transcript_path', 'transcriptPath']),
  cwd: readStringField(payload, ['cwd', 'current_working_directory', 'currentWorkingDirectory'])
})

const runtimeKeyForHookMeta = meta => {
  if (meta.sessionId) {
    return `session:${meta.sessionId}`
  }

  if (meta.transcriptPath) {
    return `transcript:${meta.transcriptPath}`
  }

  return null
}

const normalizeFailureKey = key => String(key || '').replace(/[_\-\s]/g, '').toLowerCase()

const isFailureStatusValue = value => {
  if (typeof value !== 'string') {
    return false
  }

  return ['failed', 'failure', 'error', 'exception'].includes(value.trim().toLowerCase())
}

const isNonZeroNumber = value => typeof value === 'number' && Number.isFinite(value) && value !== 0

const hasStructuredFailureMarker = (value, depth = 0) => {
  if (depth > 10 || value == null) {
    return false
  }

  if (Array.isArray(value)) {
    return value.some(item => hasStructuredFailureMarker(item, depth + 1))
  }

  if (typeof value !== 'object') {
    return false
  }

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeFailureKey(rawKey)

    if (['status', 'state', 'outcome', 'result'].includes(key) && isFailureStatusValue(rawValue)) {
      return true
    }

    if (['exitcode', 'exitstatus', 'code'].includes(key) && isNonZeroNumber(rawValue)) {
      return true
    }

    if (['success', 'ok'].includes(key) && rawValue === false) {
      return true
    }

    if (['failed', 'error', 'failure', 'exception', 'toolerror'].includes(key)) {
      if (rawValue === true) {
        return true
      }

      if (typeof rawValue === 'string' && rawValue.trim()) {
        return true
      }

      if (rawValue && typeof rawValue === 'object' && Object.keys(rawValue).length > 0) {
        return true
      }
    }

    if (['errortype', 'errormessage', 'failurereason'].includes(key) && typeof rawValue === 'string' && rawValue.trim()) {
      return true
    }

    if (hasStructuredFailureMarker(rawValue, depth + 1)) {
      return true
    }
  }

  return false
}

const extractFailureReason = value => {
  if (!value || typeof value !== 'object') {
    return null
  }

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeFailureKey(rawKey)

    if (['errormessage', 'failurereason', 'error', 'failure', 'exception', 'toolerror'].includes(key) && typeof rawValue === 'string' && rawValue.trim()) {
      return rawValue.trim().slice(0, 240)
    }

    if (rawValue && typeof rawValue === 'object') {
      const nested = extractFailureReason(rawValue)

      if (nested) {
        return nested
      }
    }
  }

  return null
}

const runtimeStatusFromHookEvent = (eventName, payload) => {
  if (eventName === 'PermissionRequest') {
    return 'waiting'
  }

  if (eventName === 'UserPromptSubmit' || eventName === 'PreToolUse') {
    return 'running'
  }

  if (eventName === 'PostToolUse') {
    return hasStructuredFailureMarker(payload?.tool_response ?? payload) ? 'failed' : 'running'
  }

  if (eventName === 'Stop') {
    return hasStructuredFailureMarker(payload) ? 'failed' : 'idle'
  }

  return null
}

const applyHookEventToRuntimeState = (state, fileEventName, payload, updatedAt) => {
  const meta = extractHookRuntimeMeta(payload)
  const eventName = normalizeHookEventName(meta.eventName || fileEventName)
  const runtimeStatus = runtimeStatusFromHookEvent(eventName, payload)
  const key = runtimeKeyForHookMeta(meta)

  if (!eventName || !runtimeStatus || !key) {
    return false
  }

  if (runtimeStatus === 'idle') {
    if (state.threads[key]) {
      delete state.threads[key]
      return true
    }

    return false
  }

  state.threads[key] = {
    status: runtimeStatus,
    updatedAt,
    eventName,
    sessionId: meta.sessionId,
    turnId: meta.turnId,
    transcriptPath: meta.transcriptPath,
    cwd: meta.cwd,
    failureReason: runtimeStatus === 'failed' ? extractFailureReason(payload) : null
  }

  return true
}

const persistContextUsageFromHookPayload = async (fileEventName, payload) => {
  const meta = extractHookRuntimeMeta(payload)
  const eventName = normalizeHookEventName(meta.eventName || fileEventName)

  if (eventName !== 'Stop' || !meta.sessionId || !meta.transcriptPath) {
    return false
  }

  const usage = await readLatestTranscriptContextUsage(meta.transcriptPath, meta.sessionId)

  return Boolean(persistContextUsage(usage))
}

const readHookEventFiles = async () => {
  try {
    const names = await fsp.readdir(getHookEventsDir())

    return names
      .filter(name => !name.startsWith('.') && name.endsWith('.json'))
      .sort()
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

const processHookEvents = async () => {
  if (hookEventProcessingPromise) {
    return hookEventProcessingPromise
  }

  hookEventProcessingPromise = (async () => {
    await fsp.mkdir(getHookEventsDir(), { recursive: true })

    while (true) {
      const files = await readHookEventFiles()

      if (files.length === 0) {
        break
      }

      const state = await readRuntimeState()
      let runtimeChanged = false
      let shouldBroadcast = false
      const processedFiles = []

      for (const fileName of files) {
        const filePath = path.join(getHookEventsDir(), fileName)
        const fileEventName = hookEventNameFromFile(fileName)

        try {
          const payload = JSON.parse(await fsp.readFile(filePath, 'utf8'))
          const hookRuntimeChanged = applyHookEventToRuntimeState(state, fileEventName, payload, Date.now())
          const contextUsageChanged = await persistContextUsageFromHookPayload(fileEventName, payload)

          runtimeChanged = hookRuntimeChanged || runtimeChanged
          shouldBroadcast = hookRuntimeChanged || contextUsageChanged || shouldBroadcast
        } catch {
          // Invalid hook payloads are removed from the queue so one bad file
          // cannot block later Codex lifecycle events.
        }

        processedFiles.push(filePath)
      }

      if (runtimeChanged) {
        await saveRuntimeState(state)
      }

      if (shouldBroadcast) {
        scheduleCodexStoreBroadcast()
      }

      await Promise.all(processedFiles.map(filePath => fsp.rm(filePath, { force: true })))
    }
  })().finally(() => {
    hookEventProcessingPromise = null
  })

  return hookEventProcessingPromise
}

const scheduleHookEventProcessing = () => {
  if (hookEventTimer) {
    clearTimeout(hookEventTimer)
  }

  hookEventTimer = setTimeout(() => {
    hookEventTimer = null
    void processHookEvents()
  }, HOOK_EVENT_PROCESS_DEBOUNCE_MS)
}

const watchHookEvents = async () => {
  if (hookEventsWatcher) {
    hookEventsWatcher.close()
    hookEventsWatcher = null
  }

  await fsp.mkdir(getHookEventsDir(), { recursive: true })
  await processHookEvents()

  hookEventsWatcher = fs.watch(getHookEventsDir(), { persistent: false }, () => {
    scheduleHookEventProcessing()
  })
}

const runtimeEntryMatchesThread = (entry, thread) => {
  return Boolean(
    (entry.sessionId && (entry.sessionId === thread.sessionId || entry.sessionId === thread.id)) ||
    (entry.transcriptPath && entry.transcriptPath === thread.path)
  )
}

const findRuntimeRecordsForThread = (runtimeState, thread) => {
  return Object.entries(runtimeState.threads || {})
    .filter(([, entry]) => runtimeEntryMatchesThread(entry, thread))
    .map(([key, entry]) => ({ key, entry }))
    .sort((left, right) => (right.entry.updatedAt || 0) - (left.entry.updatedAt || 0))
}

const isTerminalTurnStatus = status => ['completed', 'interrupted'].includes(status)

const isFailedTurnStatus = status => status === 'failed'

const isFailedLatestTurnSignal = signal => Boolean(signal?.failed || isFailedTurnStatus(signal?.status))

const readTranscriptTurnLifecycle = async (transcriptPath, turnId) => {
  if (!transcriptPath || !turnId) {
    return null
  }

  try {
    const contents = await fsp.readFile(transcriptPath, 'utf8')
    const lines = contents.split('\n')
    let lifecycle = null

    for (const line of lines) {
      if (!line.trim()) {
        continue
      }

      try {
        const event = JSON.parse(line)
        const payload = event?.payload

        if (event?.type !== 'event_msg' || payload?.turn_id !== turnId) {
          continue
        }

        if (payload.type === 'task_complete') {
          lifecycle = 'completed'
        }

        if (payload.type === 'turn_aborted') {
          lifecycle = 'interrupted'
        }
      } catch {
        // A malformed transcript line should not block state reconciliation.
      }
    }

    return lifecycle
  } catch {
    return null
  }
}

const reconcileRuntimeStateWithTranscript = async runtimeState => {
  let changed = false

  for (const [key, entry] of Object.entries(runtimeState.threads || {})) {
    if (!RUNTIME_CORRECTION_STATUSES.has(entry.status)) {
      continue
    }

    const lifecycle = await readTranscriptTurnLifecycle(entry.transcriptPath, entry.turnId)

    if (isTerminalTurnStatus(lifecycle) && runtimeState.threads[key]) {
      delete runtimeState.threads[key]
      changed = true
    }
  }

  if (!changed) {
    return runtimeState
  }

  return saveRuntimeState(runtimeState)
}

const sidecarStatusFromSignals = ({ completedUnread, runtimeStatus, runtimeTurnId, statusKind, latestTurnSignal }) => {
  const failedLatestTurn = isFailedLatestTurnSignal(latestTurnSignal)
  const runtimeMatchesLatestTurn = Boolean(runtimeTurnId && latestTurnSignal?.id && runtimeTurnId === latestTurnSignal.id)

  if (runtimeStatus === 'failed' || statusKind === 'failed' || ((!runtimeStatus || runtimeMatchesLatestTurn) && failedLatestTurn)) {
    return 'failed'
  }

  if (statusKind === 'waiting' || runtimeStatus === 'waiting') {
    return 'waiting'
  }

  if (statusKind === 'running' || runtimeStatus === 'running') {
    return 'running'
  }

  if (completedUnread) {
    return 'completedUnread'
  }

  if (statusKind === 'idle' || isTerminalTurnStatus(latestTurnSignal?.status)) {
    return 'idle'
  }

  return 'unknown'
}

const isDefaultCodexConversationCwd = cwd => {
  const relativePath = path.relative(DEFAULT_CODEX_CONVERSATION_ROOT, cwd)

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false
  }

  const segments = relativePath.split(path.sep).filter(Boolean)

  return segments.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(segments[0])
}

const getProjectName = cwd => {
  if (!cwd || typeof cwd !== 'string') {
    return PROJECTLESS_THREAD_LABEL
  }

  const normalizedCwd = path.resolve(cwd)

  // Projectless Codex Desktop chats still have an auto-created cwd under
  // ~/Documents/Codex/YYYY-MM-DD/<slug>; show the conversation type instead of
  // leaking the generated slug as a project name.
  if (isDefaultCodexConversationCwd(normalizedCwd)) {
    return PROJECTLESS_THREAD_LABEL
  }

  return path.basename(normalizedCwd) || cwd
}

const getRecentActivity = (thread, latestTurnStatus, sidecarStatus) => {
  if (sidecarStatus === 'running') {
    return '正在运行'
  }

  if (sidecarStatus === 'waiting') {
    return '等待用户处理'
  }

  if (sidecarStatus === 'failed') {
    return '最近一次任务失败'
  }

  if (latestTurnStatus === 'completed') {
    return '最近一次任务已完成'
  }

  if (latestTurnStatus === 'failed') {
    return '最近一次任务失败'
  }

  if (latestTurnStatus === 'interrupted') {
    return '最近一次任务已中断'
  }

  return thread.preview || '暂无活动摘要'
}

const normalizeRateLimitWindow = (label, limitWindow) => {
  if (!limitWindow) {
    return null
  }

  const usedPercent = Math.round(limitWindow.usedPercent ?? 0)

  return {
    label,
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    windowDurationMins: limitWindow.windowDurationMins ?? null,
    resetsAt: limitWindow.resetsAt ? limitWindow.resetsAt * 1000 : null
  }
}

const normalizeRateLimits = response => {
  const rateLimitEntries = Object.values(response?.rateLimitsByLimitId || {})
  const primaryRateLimit = rateLimitEntries.find(entry => entry?.limitId === 'codex') || response?.rateLimits || rateLimitEntries[0] || null

  return {
    limitId: primaryRateLimit?.limitId || null,
    limitName: primaryRateLimit?.limitName || null,
    primary: normalizeRateLimitWindow('5 小时', primaryRateLimit?.primary),
    secondary: normalizeRateLimitWindow('1 周', primaryRateLimit?.secondary)
  }
}

const refreshRateLimits = async client => {
  if (rateLimitsRefreshPromise) {
    return rateLimitsRefreshPromise
  }

  rateLimitsRefreshPromise = client.request('account/rateLimits/read', undefined, 12000)
    .then(response => {
      cachedRateLimits = normalizeRateLimits(response)
      cachedRateLimitsUpdatedAt = Date.now()
      return cachedRateLimits
    })
    .finally(() => {
      rateLimitsRefreshPromise = null
    })

  return rateLimitsRefreshPromise
}

const refreshRateLimitsInBackground = (client, { force = false } = {}) => {
  const stale = !cachedRateLimits || Date.now() - cachedRateLimitsUpdatedAt > RATE_LIMITS_BACKGROUND_REFRESH_INTERVAL_MS

  if (rateLimitsRefreshPromise || (!force && !stale)) {
    return
  }

  void refreshRateLimits(client)
    .then(() => {
      scheduleCodexStoreBroadcast()
    })
    .catch(() => {
      // Rate limits are auxiliary UI data; failed refreshes should not block thread state.
    })
}

const getContextUsageForThread = (contextUsageByThread, thread) => {
  return contextUsageByThread[thread.id] || (thread.sessionId ? contextUsageByThread[thread.sessionId] : null) || null
}

const shouldReadRecentTranscriptContextUsage = thread => {
  const updatedAt = epochSecondsToMs(thread.updatedAt)

  return Boolean(
    thread.id &&
    thread.path &&
    updatedAt &&
    updatedAt >= appStartedAt - CONTEXT_USAGE_TRANSCRIPT_REFRESH_GRACE_MS
  )
}

const hydrateRecentContextUsageFromTranscripts = async (threads, contextUsageByThread) => {
  const candidates = threads.filter(thread => {
    return !getContextUsageForThread(contextUsageByThread, thread) && shouldReadRecentTranscriptContextUsage(thread)
  })

  if (candidates.length === 0) {
    return
  }

  const entries = await mapLimit(candidates, 4, async thread => {
    const usage = await readLatestTranscriptContextUsage(thread.path, thread.id)
    const persistedUsage = persistContextUsage(usage)

    return persistedUsage ? [thread.id, persistedUsage] : null
  })

  for (const entry of entries) {
    if (entry) {
      contextUsageByThread[entry[0]] = entry[1]
    }
  }
}

const createCodexStore = async () => {
  await processHookEvents()

  const contextUsageByThread = getSidecarStore().getContextUsageByThread()
  let runtimeState = await readRuntimeState()
  const nativeUnread = getNativeUnreadState()
  const unreadSet = new Set(nativeUnread.available ? nativeUnread.ids : [])
  const client = await getCodexClient()
  const threads = await listAllThreads(client)

  refreshRateLimitsInBackground(client)
  await hydrateRecentContextUsageFromTranscripts(threads, contextUsageByThread)

  runtimeState = await reconcileRuntimeStateWithTranscript(runtimeState)
  const statusKindByThreadId = new Map()
  const currentThreadIds = new Set(threads.map(thread => thread.id))

  for (const thread of threads) {
    const statusKind = statusKindFromThread(thread)

    statusKindByThreadId.set(thread.id, statusKind)
  }

  for (const threadId of latestTurnSignalCache.keys()) {
    if (!currentThreadIds.has(threadId)) {
      latestTurnSignalCache.delete(threadId)
    }
  }

  const threadOverviewEntries = await mapLimit(threads, 4, async thread => [
    thread.id,
    await readThreadOverview(client, thread)
  ])
  const threadOverviewById = Object.fromEntries(threadOverviewEntries)
  const reconciledRuntimeRecordsByThreadId = new Map()

  for (const thread of threads) {
    const runtimeRecords = findRuntimeRecordsForThread(runtimeState, thread)

    if (runtimeRecords.length > 0) {
      reconciledRuntimeRecordsByThreadId.set(thread.id, runtimeRecords)
    }
  }

  const summaries = threads.map(thread => {
    const threadOverview = threadOverviewById[thread.id] || {}
    const latestTurnSignal = threadOverview.latestTurnSignal || null
    const latestTurnStatus = latestTurnSignal?.status || null
    const unread = nativeUnread.available && unreadSet.has(thread.id)
    const completedUnread = Boolean(unread && latestTurnStatus === 'completed' && !latestTurnSignal?.failed)
    const runtimeEntry = reconciledRuntimeRecordsByThreadId.get(thread.id)?.[0]?.entry || null
    const statusKind = statusKindByThreadId.get(thread.id) || statusKindFromThread(thread)
    const sidecarStatus = sidecarStatusFromSignals({
      completedUnread,
      runtimeStatus: runtimeEntry?.status || null,
      runtimeTurnId: runtimeEntry?.turnId || null,
      statusKind,
      latestTurnSignal
    })
    const contextUsage = getContextUsageForThread(contextUsageByThread, thread)
    const title = thread.name || thread.preview || '未命名对话'

    return {
      id: thread.id,
      sessionId: thread.sessionId,
      title,
      codexTitle: thread.name || thread.preview || '未命名对话',
      preview: thread.preview || '',
      cwd: thread.cwd || '',
      projectName: getProjectName(thread.cwd),
      createdAt: thread.createdAt ? thread.createdAt * 1000 : null,
      updatedAt: thread.updatedAt ? thread.updatedAt * 1000 : null,
      status: thread.status || { type: 'notLoaded' },
      statusKind,
      sidecarStatus,
      latestTurnStatus,
      lastUserMessagePreview: threadOverview.lastUserMessagePreview || '',
      recentActivity: getRecentActivity(thread, latestTurnStatus, sidecarStatus),
      unread,
      completedUnread,
      contextUsage,
      gitBranch: thread.gitInfo?.branch || null,
      source: thread.source || null,
      path: thread.path || null
    }
  })

  return {
    generatedAt: Date.now(),
    connection: client.getStatus(),
    nativeUnread: {
      available: nativeUnread.available,
      path: nativeUnread.path,
      count: nativeUnread.count,
      error: nativeUnread.error
    },
    rateLimits: cachedRateLimits,
    threads: summaries
  }
}

const safeCodexStore = async () => {
  try {
    return await createCodexStore()
  } catch (error) {
    return {
      generatedAt: Date.now(),
      connection: codexClient?.getStatus() || {
        connected: false,
        lastError: error instanceof Error ? error.message : String(error)
      },
      nativeUnread: {
        ...(cachedNativeUnread || getNativeUnreadState()),
        ids: undefined
      },
      rateLimits: cachedRateLimits,
      threads: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function scheduleCodexStoreBroadcast() {
  const hasTargetWindow = [mainWindow, miniWindow].some(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (!hasTargetWindow) {
    return
  }

  if (codexStoreTimer) {
    clearTimeout(codexStoreTimer)
  }

  codexStoreTimer = setTimeout(async () => {
    codexStoreTimer = null
    await sendCodexStore()
  }, CODEX_STORE_DEBOUNCE_MS)
}

async function sendCodexStore() {
  const targetWindows = [mainWindow, miniWindow].filter(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (targetWindows.length === 0) {
    return
  }

  const codexStore = await safeCodexStore()

  for (const targetWindow of targetWindows) {
    targetWindow.webContents.send('sidecar:codexStore', codexStore)
  }
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

function sendExplorationsChanged() {
  const targetWindows = [mainWindow, miniWindow, ...explorationResultWindows.values()]
    .filter(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (targetWindows.length === 0) {
    return
  }

  const explorations = getSidecarStore().listExplorationRuns()

  for (const targetWindow of targetWindows) {
    targetWindow.webContents.send('sidecar:explorationsChanged', explorations)
  }
}

const schedulePostOpenCodexStoreBroadcast = () => {
  for (const delayMs of POST_OPEN_CODEX_STORE_DELAYS_MS) {
    setTimeout(() => {
      void sendCodexStore()
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
    scheduleCodexStoreBroadcast()
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

    void sendCodexStore()
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
  void sendCodexStore()

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
    void sendCodexStore()
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

const applyStoredMiniToolVisibility = () => {
  const settings = getSidecarStore().getSidecarData().settings
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
      applyStoredMiniToolVisibility()
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

  const client = await getCodexClient()
  const runId = crypto.randomUUID()
  const sourceThread = sourceThreadId
    ? (await listAllThreads(client)).find(thread => thread.id === sourceThreadId) || null
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

  const savedRun = getSidecarStore().saveExplorationRun(run)

  sendExplorationsChanged()
  void runExploration(savedRun.id)

  return savedRun
}

ipcMain.handle('sidecar:getCodexStore', async () => safeCodexStore())

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

  const promptTemplates = getSidecarStore().savePromptTemplates(normalizePromptTemplates(templates))

  await sendSidecarDataChanged()
  return promptTemplates
})

ipcMain.handle('sidecar:setLanguageMode', async (_event, languageMode) => {
  const settings = getSidecarStore().updateSettings({ languageMode: normalizeLanguageMode(languageMode) })

  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setThemeMode', async (_event, themeMode) => {
  const settings = getSidecarStore().updateSettings({ themeMode: normalizeThemeMode(themeMode) })

  applyThemeModeToNativeTheme(settings.themeMode)
  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setMiniOverDock', async (_event, miniOverDock) => {
  const settings = getSidecarStore().updateSettings({ miniOverDock: normalizeMiniOverDock(miniOverDock) })

  applyMiniOverDock(settings.miniOverDock)
  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setShowMiniTool', async (_event, showMiniTool) => {
  const settings = getSidecarStore().updateSettings({ showMiniTool: normalizeShowMiniTool(showMiniTool) })

  applyShowMiniTool(settings.showMiniTool)
  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:setShowMiniPrompts', async (_event, showMiniPrompts) => {
  const settings = getSidecarStore().updateSettings({ showMiniPrompts: normalizeShowMiniPrompts(showMiniPrompts) })

  await sendSidecarDataChanged()
  return settings
})

ipcMain.handle('sidecar:exportData', async () => {
  const sidecarData = await readSidecarData()
  const exportData = {
    ...sidecarData,
    explorations: getSidecarStore().listExplorationRuns()
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: getSidecarText(sidecarData.settings, 'exportTitle'),
    defaultPath: `codex-sidecar-export-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }

  await writeJsonAtomic(result.filePath, exportData)
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

  const importedRaw = await readJsonFile(result.filePaths[0])
  const imported = normalizeSidecarData(importedRaw)

  await saveSidecarData(imported)
  getSidecarStore().replaceExplorationRuns(Array.isArray(importedRaw.explorations) ? importedRaw.explorations : [])
  applyThemeModeToNativeTheme(imported.settings.themeMode)
  applyMiniOverDock(imported.settings.miniOverDock)
  applyShowMiniTool(imported.settings.showMiniTool)
  await sendSidecarDataChanged(imported)
  sendExplorationsChanged()

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
  const continuationResult = getSidecarStore().saveContinuationResult({
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

ipcMain.handle('sidecar:setContinuationResultUnread', async (_event, threadId, unread) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  if (typeof unread !== 'boolean') {
    throw new Error('unread must be a boolean.')
  }

  const result = getSidecarStore().setContinuationResultUnread(threadId, unread)

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

  const deletedRun = getSidecarStore().deleteExplorationRun(normalizedId)

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

  sendExplorationsChanged()
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

  const client = await getCodexClient()
  const turnPreviews = await readThreadTurnPreviews(client, threadId)

  return { threadId, turnPreviews }
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
    const settings = getSidecarStore().updateSettings({ showMiniTool: true })

    applyShowMiniTool(settings.showMiniTool)
    await sendSidecarDataChanged()
    return true
  }

  return showFullWindow({
    activePanel: normalizeFullPanelKey(options?.activePanel)
  })
})

app.whenReady().then(async () => {
  windowState = await readWindowState()
  const initialSidecarData = await readSidecarData()

  applyThemeModeToNativeTheme(initialSidecarData.settings.themeMode)
  applyMiniOverDock(initialSidecarData.settings.miniOverDock)
  currentShowMiniTool = normalizeShowMiniTool(initialSidecarData.settings.showMiniTool)
  await ensureSidecarHookIntegration()
  await refreshSidecarHookStatus({ applyMini: false, broadcast: false })
  await watchHookEvents()
  watchNativeUnreadState()
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeNativeUnreadWatchers()

  if (nativeUnreadRefreshTimer) {
    clearTimeout(nativeUnreadRefreshTimer)
  }

  if (hookEventsWatcher) {
    hookEventsWatcher.close()
  }

  if (hookEventTimer) {
    clearTimeout(hookEventTimer)
  }

  if (popupMenuPrewarmTimer) {
    clearTimeout(popupMenuPrewarmTimer)
    popupMenuPrewarmTimer = null
  }

  if (codexClient) {
    codexClient.dispose()
  }

  if (sidecarStore) {
    sidecarStore.close()
    sidecarStore = null
  }
})
