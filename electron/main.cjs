const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, screen, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')

const APP_VERSION = '0.1.0'
const SIDECAR_SCHEMA_VERSION = 4
const SIDECAR_RUNTIME_SCHEMA_VERSION = 1
const WINDOW_STATE_SCHEMA_VERSION = 2
const SNAPSHOT_DEBOUNCE_MS = 700
const POST_OPEN_SNAPSHOT_DELAYS_MS = [300, 1000, 2500]
const HOOK_EVENT_PROCESS_DEBOUNCE_MS = 120
const NATIVE_UNREAD_REFRESH_DELAY_MS = 250
const RATE_LIMITS_BACKGROUND_REFRESH_INTERVAL_MS = 60_000
const THREAD_SEARCH_OPEN_DELAY_MS = 700
const THREAD_SEARCH_CLOSE_DELAY_MS = 1000
const THREAD_CONTINUATION_SUMMARY_TIMEOUT_MS = 120_000
const THREAD_CONTINUATION_TEXT_GRACE_MS = 3000
const THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH = 120
const MESSAGE_BOOKMARK_TEXT_MAX_LENGTH = 600
const MESSAGE_BOOKMARK_META_MAX_LENGTH = 1000
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
const ACCESSIBILITY_KEYSTROKE_CHECK_SCRIPT = `
tell application "System Events"
  key code 63
end tell
`
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
let codexClient = null
let snapshotTimer = null
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
let favoritesWriteQueue = Promise.resolve()
let windowStateWriteQueue = Promise.resolve()
let windowState = null
let currentWindowMode = 'full'
let currentMiniOverDock = true
let popupMenuData = null
let popupMenuPendingResult = null
let windowBoundsSaveTimer = null
let isApplyingWindowBounds = false
let applyingWindowBoundsTimer = null
let miniWindowDragState = null
const latestTurnSignalCache = new Map()

const SIDECAR_HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
]

const RUNTIME_STATUS_VALUES = new Set(['idle', 'running', 'waiting', 'failed'])
const RUNTIME_CORRECTION_STATUSES = new Set(['running', 'waiting', 'failed'])
const AGENT_OUTPUT_ITEM_TYPES = new Set(['agentMessage'])
const LANGUAGE_MODES = new Set(['auto', 'en', 'zh'])
const THEME_MODES = new Set(['auto', 'light', 'dark'])

const normalizePromptString = (value, fallback = '') => typeof value === 'string' ? value : fallback

const normalizeLanguageMode = value => LANGUAGE_MODES.has(value) ? value : 'auto'
const normalizeThemeMode = value => THEME_MODES.has(value) ? value : 'auto'
const normalizeMiniOverDock = value => typeof value === 'boolean' ? value : true
const normalizeShowMiniPrompts = value => typeof value === 'boolean' ? value : true

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
      name: normalizePromptString(template.name).trim() || '未命名提示词',
      body: normalizePromptString(template.body),
      defaultPath: normalizePromptString(template.defaultPath)
    }))
}

const createDefaultPromptTemplates = () => [
  {
    id: crypto.randomUUID(),
    name: '摘要当前进展',
    body: '请总结当前对话的目标、已完成工作、关键决策、未完成事项、相关文件和下一步建议。要求简洁但足够让新对话无缝接续。',
    defaultPath: ''
  },
  {
    id: crypto.randomUUID(),
    name: '实现前先给方案',
    body: '请先阅读相关代码并给出实现方案、影响范围、待确认问题。除非我明确回复“开始改”，不要修改代码。',
    defaultPath: ''
  }
]

const createDefaultSidecarData = () => ({
  schemaVersion: SIDECAR_SCHEMA_VERSION,
  promptTemplates: createDefaultPromptTemplates(),
  favorites: [],
  contextUsageByThread: {},
  threadLinks: [],
  settings: createDefaultSidecarSettings()
})

const createDefaultWindowState = () => ({
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  positionsByMode: {},
  sizesByMode: {}
})

const normalizeFavoriteString = (value, maxLength = MESSAGE_BOOKMARK_META_MAX_LENGTH) => {
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

const normalizeMessageFavoriteItem = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const threadId = normalizeFavoriteString(raw.threadId)
  const messageId = normalizeFavoriteString(raw.messageId)
  const id = normalizeFavoriteString(raw.id)
  const preview = normalizeFavoriteString(raw.preview, MESSAGE_BOOKMARK_TEXT_MAX_LENGTH)

  if (!id || !threadId || !messageId || !preview) {
    return null
  }

  const index = Number.isInteger(raw.index) && raw.index > 0 ? raw.index : 0
  const messageCreatedAt = normalizeFavoriteTimestamp(raw.messageCreatedAt)
  const createdAt = normalizeFavoriteTimestamp(raw.createdAt) || Date.now()

  return {
    type: 'message',
    id,
    threadId,
    messageId,
    turnId: normalizeFavoriteString(raw.turnId),
    itemId: normalizeFavoriteString(raw.itemId),
    index,
    preview,
    searchText: normalizeFavoriteString(raw.searchText, THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH),
    messageCreatedAt,
    createdAt,
    threadTitle: normalizeFavoriteString(raw.threadTitle, MESSAGE_BOOKMARK_TEXT_MAX_LENGTH),
    codexTitle: normalizeFavoriteString(raw.codexTitle, MESSAGE_BOOKMARK_TEXT_MAX_LENGTH),
    cwd: normalizeFavoriteString(raw.cwd),
    projectName: normalizeFavoriteString(raw.projectName, MESSAGE_BOOKMARK_TEXT_MAX_LENGTH)
  }
}

const normalizeFavoriteItem = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  if (raw.type === 'thread') {
    return normalizeThreadFavoriteItem(raw)
  }

  if (raw.type === 'message') {
    return normalizeMessageFavoriteItem(raw)
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
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    promptTemplates: hasPromptTemplates
      ? normalizePromptTemplates(raw.promptTemplates)
      : fallback.promptTemplates,
    favorites: normalizeFavoriteItems(Array.isArray(raw.favorites) ? raw.favorites : []),
    contextUsageByThread: raw.contextUsageByThread && typeof raw.contextUsageByThread === 'object' ? raw.contextUsageByThread : {},
    threadLinks: Array.isArray(raw.threadLinks) ? raw.threadLinks : [],
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

const getSidecarDataPath = () => path.join(app.getPath('userData'), 'sidecar-data.json')

const getWindowStatePath = () => path.join(app.getPath('userData'), 'window-state.json')

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
    return normalizeWindowState(await readJsonFile(getWindowStatePath()))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return createDefaultWindowState()
    }

    return createDefaultWindowState()
  }
}

const saveWindowState = state => {
  const normalized = normalizeWindowState(state)
  const operation = windowStateWriteQueue
    .catch(() => undefined)
    .then(() => writeJsonAtomic(getWindowStatePath(), normalized))

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

const readSidecarData = async () => {
  const filePath = getSidecarDataPath()

  try {
    return normalizeSidecarData(await readJsonFile(filePath))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const initial = createDefaultSidecarData()
      await writeJsonAtomic(filePath, initial)
      return initial
    }

    throw error
  }
}

const saveSidecarData = async data => {
  const normalized = normalizeSidecarData(data)
  await writeJsonAtomic(getSidecarDataPath(), normalized)
  return normalized
}

const updateSidecarData = async updater => {
  const current = await readSidecarData()
  const next = normalizeSidecarData(await updater(current))
  await saveSidecarData(next)
  return next
}

const createSnapshotSidecarData = data => ({
  ...data,
  favorites: []
})

const updateFavoritesData = updater => {
  const operation = favoritesWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readSidecarData()
      const nextFavorites = normalizeFavoriteItems(await updater(current.favorites))
      const nextData = await saveSidecarData({
        ...current,
        favorites: nextFavorites
      })

      return nextData.favorites
    })

  favoritesWriteQueue = operation.then(() => undefined, () => undefined)

  return operation
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
    scheduleSnapshotBroadcast()
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

    // The ready-to-show snapshot and renderer's initial refresh can arrive at
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
      scheduleSnapshotBroadcast()
    })
  }

  await codexClient.connect()
  return codexClient
}

const handleCodexNotification = async message => {
  if (message.method === 'thread/tokenUsage/updated') {
    const threadId = message.params?.threadId
    const usage = message.params?.tokenUsage

    if (threadId && usage?.modelContextWindow && usage.total?.totalTokens) {
      const percent = Math.min(100, Math.round((usage.total.totalTokens / usage.modelContextWindow) * 100))

      await updateSidecarData(data => ({
        ...data,
        contextUsageByThread: {
          ...data.contextUsageByThread,
          [threadId]: {
            percent,
            totalTokens: usage.total.totalTokens,
            modelContextWindow: usage.modelContextWindow,
            updatedAt: Date.now()
          }
        }
      }))
    }
  }

  if (message.method === 'account/rateLimits/updated' && codexClient) {
    refreshRateLimitsInBackground(codexClient, { force: true })
    return
  }

  scheduleSnapshotBroadcast()
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

const readThreadUserMessages = async (client, threadId) => {
  const response = await client.request('thread/read', {
    threadId,
    includeTurns: true
  }, 15000)
  const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : []
  const messages = []

  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : []

    for (const item of items) {
      if (item?.type !== 'userMessage') {
        continue
      }

      const { text, hasAttachment } = extractUserMessageContent(item)
      const preview = normalizeMessageWhitespace(text)

      if (!preview && !hasAttachment) {
        continue
      }

      messages.push({
        id: `${turn.id || 'turn'}:${item.id || messages.length}`,
        turnId: typeof turn.id === 'string' ? turn.id : '',
        itemId: typeof item.id === 'string' ? item.id : '',
        preview: preview || IMAGE_MESSAGE_PREVIEW,
        searchText: createSearchText(text),
        createdAt: epochSecondsToMs(turn.startedAt ?? turn.completedAt),
        index: messages.length + 1
      })
    }
  }

  return messages
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
      let changed = false
      const processedFiles = []

      for (const fileName of files) {
        const filePath = path.join(getHookEventsDir(), fileName)
        const fileEventName = hookEventNameFromFile(fileName)

        try {
          const payload = JSON.parse(await fsp.readFile(filePath, 'utf8'))
          changed = applyHookEventToRuntimeState(state, fileEventName, payload, Date.now()) || changed
        } catch {
          // Invalid hook payloads are removed from the queue so one bad file
          // cannot block later Codex lifecycle events.
        }

        processedFiles.push(filePath)
      }

      if (changed) {
        await saveRuntimeState(state)
        scheduleSnapshotBroadcast()
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
  const snapshots = Object.values(response?.rateLimitsByLimitId || {})
  const primarySnapshot = snapshots.find(snapshot => snapshot?.limitId === 'codex') || response?.rateLimits || snapshots[0] || null

  return {
    limitId: primarySnapshot?.limitId || null,
    limitName: primarySnapshot?.limitName || null,
    primary: normalizeRateLimitWindow('5 小时', primarySnapshot?.primary),
    secondary: normalizeRateLimitWindow('1 周', primarySnapshot?.secondary)
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
      scheduleSnapshotBroadcast()
    })
    .catch(() => {
      // Rate limits are auxiliary UI data; failed refreshes should not block thread state.
    })
}

const createSnapshot = async () => {
  await processHookEvents()

  const sidecarData = await readSidecarData()
  let runtimeState = await readRuntimeState()
  const nativeUnread = getNativeUnreadState()
  const unreadSet = new Set(nativeUnread.available ? nativeUnread.ids : [])
  const client = await getCodexClient()
  const threads = await listAllThreads(client)

  refreshRateLimitsInBackground(client)

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
    const contextUsage = sidecarData.contextUsageByThread[thread.id] || null
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
    threads: summaries,
    sidecarData: createSnapshotSidecarData(sidecarData)
  }
}

const safeSnapshot = async () => {
  try {
    return await createSnapshot()
  } catch (error) {
    let sidecarData

    try {
      sidecarData = await readSidecarData()
    } catch {
      sidecarData = createDefaultSidecarData()
    }

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
      sidecarData: createSnapshotSidecarData(sidecarData),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function scheduleSnapshotBroadcast() {
  const hasTargetWindow = [mainWindow, miniWindow].some(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (!hasTargetWindow) {
    return
  }

  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
  }

  snapshotTimer = setTimeout(async () => {
    snapshotTimer = null
    await sendSnapshot()
  }, SNAPSHOT_DEBOUNCE_MS)
}

async function sendSnapshot() {
  const targetWindows = [mainWindow, miniWindow].filter(browserWindow => browserWindow && !browserWindow.isDestroyed())

  if (targetWindows.length === 0) {
    return
  }

  const snapshot = await safeSnapshot()

  for (const targetWindow of targetWindows) {
    targetWindow.webContents.send('sidecar:snapshot', snapshot)
  }
}

const schedulePostOpenSnapshotBroadcast = () => {
  for (const delayMs of POST_OPEN_SNAPSHOT_DELAYS_MS) {
    setTimeout(() => {
      void sendSnapshot()
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
  const area = display.workArea
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

  if (!targetWindow || targetWindow.isDestroyed() || targetWindow !== miniWindow || currentWindowMode !== 'mini') {
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

  return 'full'
}

const getWindowModeForWebContents = webContents => getWindowModeForBrowserWindow(BrowserWindow.fromWebContents(webContents))

const sendWindowModeToWindow = (browserWindow, mode) => {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return
  }

  browserWindow.webContents.send('sidecar:windowMode', windowMode(mode))
}

const loadRenderer = (browserWindow, mode) => {
  const nextMode = windowMode(mode)

  if (process.env.VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL)
    rendererUrl.searchParams.set('windowMode', nextMode)
    browserWindow.loadURL(rendererUrl.toString())
    return
  }

  browserWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), {
    query: {
      windowMode: nextMode
    }
  })
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
    scheduleSnapshotBroadcast()
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
    hasShadow: false,
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

    if (currentWindowMode === 'mini') {
      miniWindow.showInactive()
    }

    void sendSnapshot()
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

const showFullWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false
  }

  miniWindowDragState = null
  currentWindowMode = 'full'

  if (miniWindow && !miniWindow.isDestroyed()) {
    flushWindowBoundsSave(miniWindow, 'mini')
    miniWindow.hide()
    sendWindowModeToWindow(miniWindow, 'mini')
  }

  if (process.platform === 'darwin' && typeof mainWindow.setWindowButtonVisibility === 'function') {
    mainWindow.setWindowButtonVisibility(true)
  }

  mainWindow.setAlwaysOnTop(false)
  positionWindow(mainWindow, 'full')
  sendWindowModeToWindow(mainWindow, 'full')
  mainWindow.show()
  mainWindow.focus()
  void sendSnapshot()

  return true
}

const showMiniWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false
  }

  miniWindowDragState = null
  flushWindowBoundsSave(mainWindow, 'full')
  currentWindowMode = 'mini'

  if (process.platform === 'darwin' && typeof mainWindow.setWindowButtonVisibility === 'function') {
    mainWindow.setWindowButtonVisibility(true)
  }

  sendWindowModeToWindow(mainWindow, 'full')
  mainWindow.hide()

  const targetMiniWindow = createMiniWindow()

  positionWindow(targetMiniWindow, 'mini')
  sendWindowModeToWindow(targetMiniWindow, 'mini')

  if (!targetMiniWindow.webContents.isLoading()) {
    targetMiniWindow.showInactive()
    void sendSnapshot()
  }

  return true
}

const openCodexThread = async threadId => {
  await shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`)
  schedulePostOpenSnapshotBroadcast()
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
  schedulePostOpenSnapshotBroadcast()
}

const delay = ms => new Promise(resolve => {
  setTimeout(resolve, ms)
})

const createTextUserInput = text => ({
  type: 'text',
  text,
  text_elements: []
})

const createThreadContinuationSummaryPrompt = ({ threadId, cwd }) => [
  '你正在为一个新的 Codex 对话生成“接续摘要”。新的对话将无法访问当前旧对话的完整历史，只能看到你本次输出的内容。你的任务不是写聊天纪要，而是生成一个足够完整、准确、可执行的 handoff 上下文包，让新的 Codex 能在同一项目中继续工作。',
  '',
  `原线程 ID：${threadId}`,
  `当前工作目录：${cwd || '未知'}`,
  `生成时间：${new Date().toISOString()}`,
  '',
  '要求：',
  '',
  '1. 只基于当前对话中已经出现、已经确认或已经验证的信息总结。',
  '2. 不要编造文件、接口、命令结果、用户意图或实现状态。',
  '3. 如果某件事不确定，明确标注“未验证”或“不确定”。',
  '4. 忽略重复寒暄、无关讨论、冗长日志和中间 tool 输出；只保留会影响后续工作的事实。',
  '5. 对代码任务，必须保留当前目标、用户约束、已做改动、涉及文件、已验证现象、失败报错、排查结论、未完成事项和下一步建议。',
  '6. 不要说“我无法访问旧对话”。你正在当前旧对话里总结。',
  '7. 不要调用工具、不要修改文件、不要启动命令；本次只输出摘要。',
  '8. 输出 Markdown，不要加开场白，不要加解释，不要向用户提问。',
  '9. 摘要要详细，但避免流水账。优先准确和可接续，其次才是简短。',
  '',
  '请严格按以下结构输出：',
  '',
  '# 接续摘要',
  '',
  '## 当前目标',
  '说明用户最终想完成什么。不要只写最近一句话，要写当前工作的真实目标。',
  '',
  '## 用户约束与偏好',
  '列出后续必须遵守的规则，包括是否允许改代码、是否允许启动服务、包管理器、验证方式、UI/交互约束、沟通风格等。',
  '',
  '## 项目与运行环境',
  '列出已知的仓库路径、技术栈、相关进程/API/工具、当前日期或其他会影响判断的环境信息。',
  '',
  '## 已确认事实',
  '列出已经通过代码、文档、运行结果或用户反馈确认的事实。每条尽量写明证据来源，例如“用户反馈”“本地代码”“官方文档”“运行报错”。',
  '',
  '## 关键决策',
  '列出已经做出的产品或技术决策，以及为什么这样选。包括被排除的方案。',
  '',
  '## 当前实现状态',
  '说明已经改了什么、功能现在做到哪一步、哪些行为用户已经验证过、哪些还没有验证。',
  '',
  '## 相关文件与位置',
  '列出后续最可能需要阅读或修改的文件。能给出函数名、组件名、IPC 名、事件名或大致行号时一并写出。',
  '',
  '## 已尝试与报错',
  '列出重要的失败现象、错误信息、排查过程和当前结论。不要粘贴长日志，只保留关键错误文本和含义。',
  '',
  '## 未完成事项',
  '列出还没做、还需要确认、还需要实现或还需要验证的事项。',
  '',
  '## 风险与注意事项',
  '列出容易误改、容易误判、可能破坏现有行为的点。明确哪些是事实，哪些只是推测。',
  '',
  '## 建议下一步',
  '给新 Codex 的具体行动建议。按优先级写，避免泛泛而谈。',
  '',
  '## 给新对话的启动指令',
  '写一段可以直接放进新 Codex 对话开头的指令，要求新 Codex把本摘要当作初始上下文；不假设能访问旧对话；先阅读相关文件再判断；遵守用户约束；如果用户没有明确要求修改代码，先给方案，不要擅自改。'
].join('\n')

const createThreadContinuationPrompt = summary => [
  '以下是从旧 Codex 对话生成的接续摘要。请把它作为本对话的初始上下文。你不能假设自己还能访问旧对话完整历史；如果需要确认事实，请读取当前仓库文件或让用户提供证据。',
  '',
  '<接续摘要>',
  summary.trim(),
  '</接续摘要>',
  '',
  '请先基于摘要确认你理解当前状态，并等待我的下一步指令。除非我明确要求修改代码，否则不要直接改文件。'
].join('\n')

const createThreadTurnCompletionWaiter = (client, threadId) => {
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
      fail(new Error(`接续摘要未完成：${turn.status}`))
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
        fail(new Error('接续摘要已完成，但没有返回可用文本。'))
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
        fail(new Error('接续摘要等待超时。'))
      }, THREAD_CONTINUATION_SUMMARY_TIMEOUT_MS)

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

const runAppleScript = script => new Promise((resolve, reject) => {
  const child = spawn('osascript', ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', chunk => {
    stdout = `${stdout}${chunk.toString('utf8')}`.slice(-2000)
  })

  child.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000)
  })

  child.on('error', reject)
  child.on('exit', code => {
    if (code === 0) {
      resolve(stdout.trim())
      return
    }

    reject(new Error(stderr.trim() || `osascript exited with code ${code}.`))
  })
})

const checkAccessibilityPermission = async () => {
  if (process.platform !== 'darwin') {
    return {
      granted: false,
      error: '对话内自动搜索当前只支持 macOS。'
    }
  }

  try {
    // Exercise the same TCC path used by the real search flow. The global
    // Accessibility flag can disagree with whether osascript can actually send keys.
    await runAppleScript(ACCESSIBILITY_KEYSTROKE_CHECK_SCRIPT)

    return {
      granted: true,
      error: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return {
      granted: false,
      error: `当前 /usr/bin/osascript 无法发送按键：${message} 请在系统设置的“隐私与安全性 / 辅助功能”中删除 osascript 后重新添加，并重启 Sidecar。`
    }
  }
}

const searchCodexCurrentThread = async searchText => {
  if (process.platform !== 'darwin') {
    throw new Error('对话内自动搜索当前只支持 macOS。')
  }

  clipboard.writeText(String(searchText || ''))

  await runAppleScript(`
tell application id "com.openai.codex" to activate
delay 0.15
tell application "System Events"
  key code 53
  delay 0.05
  keystroke "f" using command down
  delay 0.05
  keystroke "a" using command down
  delay 0.03
  keystroke "v" using command down
  delay ${THREAD_SEARCH_CLOSE_DELAY_MS / 1000}
  key code 53
end tell
`)
}

ipcMain.handle('sidecar:getSnapshot', async () => safeSnapshot())

ipcMain.handle('sidecar:getSidecarData', async () => readSidecarData())

const setFavoriteItem = async (item, favorite) => {
  if (typeof favorite !== 'boolean') {
    throw new Error('favorite must be a boolean.')
  }

  const normalizedItem = normalizeFavoriteItem(item)

  if (!normalizedItem) {
    throw new Error('favorite item is invalid.')
  }

  const key = favoriteItemKey(normalizedItem)
  const nextFavorites = await updateFavoritesData(favorites => {
    const remainingFavorites = favorites.filter(candidate => favoriteItemKey(candidate) !== key)

    return favorite
      ? normalizeFavoriteItems([normalizedItem, ...remainingFavorites])
      : remainingFavorites
  })
  const savedItem = nextFavorites.find(candidate => favoriteItemKey(candidate) === key) || null

  return {
    key,
    favorite: Boolean(savedItem),
    item: savedItem || normalizedItem
  }
}

ipcMain.handle('sidecar:setFavorite', async (_event, item, favorite) => setFavoriteItem(item, favorite))

ipcMain.handle('sidecar:savePromptTemplates', async (_event, templates) => {
  if (!Array.isArray(templates)) {
    throw new Error('templates must be an array.')
  }

  const nextData = await updateSidecarData(data => ({
    ...data,
    promptTemplates: normalizePromptTemplates(templates)
  }))

  scheduleSnapshotBroadcast()
  return nextData.promptTemplates
})

ipcMain.handle('sidecar:setLanguageMode', async (_event, languageMode) => {
  const nextData = await updateSidecarData(data => ({
    ...data,
    settings: {
      ...data.settings,
      languageMode: normalizeLanguageMode(languageMode)
    }
  }))

  scheduleSnapshotBroadcast()
  return nextData.settings
})

ipcMain.handle('sidecar:setThemeMode', async (_event, themeMode) => {
  const nextData = await updateSidecarData(data => ({
    ...data,
    settings: {
      ...data.settings,
      themeMode: normalizeThemeMode(themeMode)
    }
  }))

  applyThemeModeToNativeTheme(nextData.settings.themeMode)
  scheduleSnapshotBroadcast()
  return nextData.settings
})

ipcMain.handle('sidecar:setMiniOverDock', async (_event, miniOverDock) => {
  const nextData = await updateSidecarData(data => ({
    ...data,
    settings: {
      ...data.settings,
      miniOverDock: normalizeMiniOverDock(miniOverDock)
    }
  }))

  applyMiniOverDock(nextData.settings.miniOverDock)
  scheduleSnapshotBroadcast()
  return nextData.settings
})

ipcMain.handle('sidecar:setShowMiniPrompts', async (_event, showMiniPrompts) => {
  const nextData = await updateSidecarData(data => ({
    ...data,
    settings: {
      ...data.settings,
      showMiniPrompts: normalizeShowMiniPrompts(showMiniPrompts)
    }
  }))

  scheduleSnapshotBroadcast()
  return nextData.settings
})

ipcMain.handle('sidecar:exportData', async () => {
  const exportData = await readSidecarData()
  const result = await dialog.showSaveDialog(mainWindow, {
    title: getSidecarText(exportData.settings, 'exportTitle'),
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

  const imported = normalizeSidecarData(await readJsonFile(result.filePaths[0]))

  await saveSidecarData(imported)
  applyThemeModeToNativeTheme(imported.settings.themeMode)
  applyMiniOverDock(imported.settings.miniOverDock)
  scheduleSnapshotBroadcast()

  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle('sidecar:openThread', async (_event, threadId) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  await openCodexThread(threadId)
  return true
})

ipcMain.handle('sidecar:openThreadAndSearch', async (_event, threadId, searchText) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  if (typeof searchText !== 'string' || !searchText.trim()) {
    throw new Error('searchText is required.')
  }

  await openCodexThread(threadId)
  await delay(THREAD_SEARCH_OPEN_DELAY_MS)
  await searchCodexCurrentThread(searchText.trim())
  return true
})

ipcMain.handle('sidecar:continueThreadWithSummary', async (_event, threadId, cwd) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  const result = await runThreadContinuationSummary(threadId, cwd)

  await openNewCodexThread({
    prompt: result.prompt,
    path: result.cwd
  })

  return {
    threadId,
    forkThreadId: result.forkThreadId,
    summary: result.summary,
    prompt: result.prompt
  }
})

ipcMain.handle('sidecar:checkAccessibilityPermission', async () => checkAccessibilityPermission())

ipcMain.handle('sidecar:getThreadUserMessages', async (_event, threadId) => {
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('threadId is required.')
  }

  const client = await getCodexClient()
  const messages = await readThreadUserMessages(client, threadId)

  return { threadId, messages }
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

ipcMain.handle('sidecar:setWindowMode', async (_event, mode) => {
  const nextMode = mode === 'mini' ? 'mini' : 'full'

  return nextMode === 'mini' ? showMiniWindow() : showFullWindow()
})

app.whenReady().then(async () => {
  windowState = await readWindowState()
  const initialSidecarData = await readSidecarData()

  applyThemeModeToNativeTheme(initialSidecarData.settings.themeMode)
  applyMiniOverDock(initialSidecarData.settings.miniOverDock)
  await ensureSidecarHookIntegration()
  await watchHookEvents()
  watchNativeUnreadState()
  createWindow()
  prewarmPopupMenuWindow()

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }

    if (currentWindowMode === 'mini' && miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.showInactive()
      return
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
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
})
