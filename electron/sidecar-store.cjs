const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const SIDECAR_STORE_SCHEMA_VERSION = 1
const LANGUAGE_MODES = new Set(['auto', 'en', 'zh'])
const THEME_MODES = new Set(['auto', 'light', 'dark'])
const EXPLORATION_RUN_STATUSES = new Set(['running', 'summarizing', 'completed', 'partialFailed', 'failed'])
const EXPLORATION_CANDIDATE_STATUSES = new Set(['pending', 'running', 'completed', 'failed'])
const EXPLORATION_SUMMARY_STATUSES = new Set(['pending', 'running', 'completed', 'failed'])
const EXPLORATION_RUN_LIMIT = 50
const TURN_BOOKMARK_TEXT_MAX_LENGTH = 600
const TURN_BOOKMARK_META_MAX_LENGTH = 1000
const THREAD_MESSAGE_SEARCH_TEXT_MAX_LENGTH = 120
const CONTINUATION_RESULT_TEXT_MAX_LENGTH = 1_000_000

const normalizeString = (value, fallback = '') => typeof value === 'string' ? value : fallback
const normalizeLanguageMode = value => LANGUAGE_MODES.has(value) ? value : 'auto'
const normalizeThemeMode = value => THEME_MODES.has(value) ? value : 'auto'
const normalizeBoolean = (value, fallback) => typeof value === 'boolean' ? value : fallback
const normalizeTimestamp = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const normalizePositiveTimestamp = value => Number.isFinite(value) && value > 0 ? value : Date.now()
const normalizeNullableTimestamp = value => Number.isFinite(value) && value > 0 ? value : null

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
    miniOverDock: normalizeBoolean(raw.miniOverDock, true),
    showMiniTool: normalizeBoolean(raw.showMiniTool, true),
    showMiniPrompts: normalizeBoolean(raw.showMiniPrompts, true)
  }
}

const createDefaultPromptTemplates = () => []

const normalizePromptTemplates = rawTemplates => {
  if (!Array.isArray(rawTemplates)) {
    return createDefaultPromptTemplates()
  }

  return rawTemplates
    .filter(template => template && typeof template === 'object')
    .map(template => ({
      id: normalizeString(template.id).trim() || crypto.randomUUID(),
      name: normalizeString(template.name).trim() || '未命名提示词',
      body: normalizeString(template.body),
      defaultPath: normalizeString(template.defaultPath)
    }))
}

const normalizeFavoriteString = (value, maxLength = TURN_BOOKMARK_META_MAX_LENGTH) => {
  const text = typeof value === 'string' ? value.trim() : ''

  return text.length > maxLength ? text.slice(0, maxLength) : text
}

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
    createdAt: normalizeTimestamp(raw.createdAt) || Date.now()
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
    turnCreatedAt: normalizeTimestamp(raw.turnCreatedAt),
    createdAt: normalizeTimestamp(raw.createdAt) || Date.now(),
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
    turnCreatedAt: normalizeTimestamp(raw.messageCreatedAt),
    createdAt: normalizeTimestamp(raw.createdAt) || Date.now(),
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

const normalizeContextUsage = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const percent = Number(raw.percent)
  const totalTokens = Number(raw.totalTokens)
  const modelContextWindow = Number(raw.modelContextWindow)
  const updatedAt = Number(raw.updatedAt)

  if (!Number.isFinite(percent) || !Number.isFinite(totalTokens) || !Number.isFinite(modelContextWindow)) {
    return null
  }

  return {
    percent: Math.min(100, Math.max(0, Math.round(percent))),
    totalTokens,
    modelContextWindow,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  }
}

const normalizeExplorationString = (value, maxLength = 20000) => normalizeString(value).slice(0, maxLength)

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
    createdAt: normalizePositiveTimestamp(raw.createdAt)
  }
}

const normalizeExplorationCandidate = (raw, index = 0) => {
  const now = Date.now()
  const normalizedIndex = Number.isInteger(raw?.index) && raw.index >= 0 ? raw.index : index
  const status = EXPLORATION_CANDIDATE_STATUSES.has(raw?.status) ? raw.status : 'pending'

  return {
    id: normalizeExplorationString(raw?.id, 120).trim() || `candidate-${normalizedIndex + 1}`,
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
    title: normalizeExplorationString(raw.title, 120).trim() || prompt.replace(/\s+/g, ' ').trim().slice(0, 36) || '图片探索',
    prompt,
    images,
    concurrency,
    sourceThreadId: normalizeExplorationString(raw.sourceThreadId, 240).trim() || null,
    sourceThreadTitle: normalizeExplorationString(raw.sourceThreadTitle, 240).trim() || null,
    sourceThreadCwd: normalizeExplorationString(raw.sourceThreadCwd, 4000).trim() || null,
    status,
    createdAt: normalizePositiveTimestamp(raw.createdAt),
    updatedAt: normalizePositiveTimestamp(raw.updatedAt),
    completedAt: normalizeNullableTimestamp(raw.completedAt),
    candidates,
    summary: normalizeExplorationSummary(raw.summary)
  }
}

const normalizeContinuationText = (value, maxLength = CONTINUATION_RESULT_TEXT_MAX_LENGTH) => normalizeString(value).slice(0, maxLength)

const normalizeContinuationResult = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const threadId = normalizeContinuationText(raw.threadId, 240).trim()
  const prompt = normalizeContinuationText(raw.prompt)

  if (!threadId || !prompt) {
    return null
  }

  return {
    threadId,
    sourceUpdatedAt: normalizeNullableTimestamp(raw.sourceUpdatedAt),
    summary: normalizeContinuationText(raw.summary),
    prompt,
    completedAt: normalizeNullableTimestamp(raw.completedAt) || Date.now(),
    unread: normalizeBoolean(raw.unread, false)
  }
}

const normalizeContinuationResults = rawResults => {
  const rawItems = Array.isArray(rawResults)
    ? rawResults
    : rawResults && typeof rawResults === 'object'
      ? Object.values(rawResults)
      : []
  const results = {}

  for (const rawItem of rawItems) {
    const result = normalizeContinuationResult(rawItem)

    if (!result) {
      continue
    }

    const existing = results[result.threadId]

    if (!existing || existing.completedAt <= result.completedAt) {
      results[result.threadId] = result
    }
  }

  return results
}

const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const createSidecarStore = dbPath => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      default_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_usage (
      thread_id TEXT PRIMARY KEY,
      percent INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      model_context_window INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thread_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_thread_id TEXT NOT NULL,
      to_thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS window_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exploration_runs (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuation_results (
      thread_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      source_updated_at INTEGER,
      completed_at INTEGER NOT NULL,
      unread INTEGER NOT NULL
    );
  `)

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schemaVersion', String(SIDECAR_STORE_SCHEMA_VERSION))

  const settingCount = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count
  if (settingCount === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    const defaultSettings = createDefaultSidecarSettings()
    const seedSettings = db.transaction(() => {
      for (const [key, value] of Object.entries(defaultSettings)) {
        insertSetting.run(key, JSON.stringify(value))
      }
    })
    seedSettings()
  }

  const promptCount = db.prepare('SELECT COUNT(*) AS count FROM prompt_templates').get().count
  if (promptCount === 0) {
    const insertPrompt = db.prepare(`
      INSERT INTO prompt_templates (id, name, body, default_path, sort_order)
      VALUES (@id, @name, @body, @defaultPath, @sortOrder)
    `)
    const seedPrompts = db.transaction(() => {
      for (const [index, template] of createDefaultPromptTemplates().entries()) {
        insertPrompt.run({ ...template, sortOrder: index })
      }
    })
    seedPrompts()
  }

  const getSettings = () => {
    const rows = db.prepare('SELECT key, value FROM settings').all()
    const raw = {}

    for (const row of rows) {
      raw[row.key] = parseJson(row.value, row.value)
    }

    return normalizeSidecarSettings(raw)
  }

  const updateSettings = patch => {
    const nextSettings = normalizeSidecarSettings({
      ...getSettings(),
      ...(patch && typeof patch === 'object' ? patch : {})
    })
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    const write = db.transaction(() => {
      for (const [key, value] of Object.entries(nextSettings)) {
        insert.run(key, JSON.stringify(value))
      }
    })

    write()
    return nextSettings
  }

  const listPromptTemplates = () => {
    return db.prepare('SELECT id, name, body, default_path AS defaultPath FROM prompt_templates ORDER BY sort_order ASC').all()
  }

  const savePromptTemplates = templates => {
    const normalized = normalizePromptTemplates(templates)
    const remove = db.prepare('DELETE FROM prompt_templates')
    const insert = db.prepare(`
      INSERT INTO prompt_templates (id, name, body, default_path, sort_order)
      VALUES (@id, @name, @body, @defaultPath, @sortOrder)
    `)
    const write = db.transaction(() => {
      remove.run()
      for (const [index, template] of normalized.entries()) {
        insert.run({ ...template, sortOrder: index })
      }
    })

    write()
    return listPromptTemplates()
  }

  const replaceFavoriteRows = favorites => {
    const remove = db.prepare('DELETE FROM favorites')
    const insert = db.prepare('INSERT INTO favorites (key, payload, created_at) VALUES (?, ?, ?)')
    const write = db.transaction(() => {
      remove.run()

      for (const favorite of favorites) {
        insert.run(favoriteItemKey(favorite), JSON.stringify(favorite), favorite.createdAt)
      }
    })

    write()
  }

  const listFavorites = () => {
    const rows = db.prepare('SELECT key, payload FROM favorites ORDER BY created_at DESC').all()
    const favorites = normalizeFavoriteItems(rows.map(row => parseJson(row.payload, null)))
    const existingKeys = rows.map(row => row.key)
    const normalizedKeys = favorites.map(favoriteItemKey)
    const needsRewrite = rows.length !== favorites.length
      || normalizedKeys.some((key, index) => key !== existingKeys[index])

    if (needsRewrite) {
      replaceFavoriteRows(favorites)
    }

    return favorites
  }

  const setFavorite = (item, favorite) => {
    const normalizedItem = normalizeFavoriteItem(item)

    if (!normalizedItem) {
      throw new Error('favorite item is invalid.')
    }

    const key = favoriteItemKey(normalizedItem)

    if (favorite) {
      db.prepare('INSERT OR REPLACE INTO favorites (key, payload, created_at) VALUES (?, ?, ?)').run(
        key,
        JSON.stringify(normalizedItem),
        normalizedItem.createdAt
      )
    } else {
      listFavorites()
      db.prepare('DELETE FROM favorites WHERE key = ?').run(key)
    }

    const savedItem = listFavorites().find(candidate => favoriteItemKey(candidate) === key) || null

    return {
      key,
      favorite: Boolean(savedItem),
      item: savedItem || normalizedItem
    }
  }

  const getContextUsageByThread = () => {
    const rows = db.prepare(`
      SELECT thread_id AS threadId, percent, total_tokens AS totalTokens, model_context_window AS modelContextWindow, updated_at AS updatedAt
      FROM context_usage
    `).all()
    const usageByThread = {}

    for (const row of rows) {
      const usage = normalizeContextUsage(row)

      if (usage) {
        usageByThread[row.threadId] = usage
      }
    }

    return usageByThread
  }

  const setContextUsage = (threadId, usage) => {
    const normalizedThreadId = normalizeString(threadId).trim()
    const normalizedUsage = normalizeContextUsage(usage)

    if (!normalizedThreadId || !normalizedUsage) {
      return null
    }

    db.prepare(`
      INSERT OR REPLACE INTO context_usage (thread_id, percent, total_tokens, model_context_window, updated_at)
      VALUES (@threadId, @percent, @totalTokens, @modelContextWindow, @updatedAt)
    `).run({
      threadId: normalizedThreadId,
      ...normalizedUsage
    })

    return normalizedUsage
  }

  const listThreadLinks = () => {
    return db.prepare(`
      SELECT from_thread_id AS fromThreadId, to_thread_id AS toThreadId, created_at AS createdAt, summary
      FROM thread_links
      ORDER BY created_at DESC
    `).all()
  }

  const listContinuationResults = () => {
    const rows = db.prepare('SELECT payload FROM continuation_results ORDER BY completed_at DESC').all()
    return normalizeContinuationResults(rows.map(row => parseJson(row.payload, null)))
  }

  const getContinuationResult = threadId => {
    const normalizedThreadId = normalizeString(threadId).trim()

    if (!normalizedThreadId) {
      return null
    }

    const row = db.prepare('SELECT payload FROM continuation_results WHERE thread_id = ?').get(normalizedThreadId)
    return row ? normalizeContinuationResult(parseJson(row.payload, null)) : null
  }

  const saveContinuationResult = result => {
    const normalizedResult = normalizeContinuationResult(result)

    if (!normalizedResult) {
      throw new Error('continuation result is invalid.')
    }

    db.prepare(`
      INSERT OR REPLACE INTO continuation_results (thread_id, payload, source_updated_at, completed_at, unread)
      VALUES (@threadId, @payload, @sourceUpdatedAt, @completedAt, @unread)
    `).run({
      threadId: normalizedResult.threadId,
      payload: JSON.stringify(normalizedResult),
      sourceUpdatedAt: normalizedResult.sourceUpdatedAt,
      completedAt: normalizedResult.completedAt,
      unread: normalizedResult.unread ? 1 : 0
    })

    return normalizedResult
  }

  const setContinuationResultUnread = (threadId, unread) => {
    const result = getContinuationResult(threadId)

    if (!result) {
      return null
    }

    return saveContinuationResult({
      ...result,
      unread: Boolean(unread)
    })
  }

  const replaceContinuationResults = rawResults => {
    const results = normalizeContinuationResults(rawResults)
    const insertResult = db.prepare(`
      INSERT INTO continuation_results (thread_id, payload, source_updated_at, completed_at, unread)
      VALUES (@threadId, @payload, @sourceUpdatedAt, @completedAt, @unread)
    `)
    const write = db.transaction(() => {
      db.prepare('DELETE FROM continuation_results').run()

      for (const result of Object.values(results)) {
        insertResult.run({
          threadId: result.threadId,
          payload: JSON.stringify(result),
          sourceUpdatedAt: result.sourceUpdatedAt,
          completedAt: result.completedAt,
          unread: result.unread ? 1 : 0
        })
      }
    })

    write()
    return listContinuationResults()
  }

  const getSidecarData = () => ({
    schemaVersion: SIDECAR_STORE_SCHEMA_VERSION,
    promptTemplates: listPromptTemplates(),
    favorites: listFavorites(),
    contextUsageByThread: getContextUsageByThread(),
    threadLinks: listThreadLinks(),
    continuationResults: listContinuationResults(),
    settings: getSettings()
  })

  const getWindowState = () => {
    const rows = db.prepare('SELECT key, value FROM window_state').all()
    const raw = {}

    for (const row of rows) {
      raw[row.key] = parseJson(row.value, row.value)
    }

    return {
      schemaVersion: Number(raw.schemaVersion) || 1,
      positionsByMode: raw.positionsByMode && typeof raw.positionsByMode === 'object' ? raw.positionsByMode : {},
      sizesByMode: raw.sizesByMode && typeof raw.sizesByMode === 'object' ? raw.sizesByMode : {}
    }
  }

  const saveWindowState = state => {
    const normalized = state && typeof state === 'object'
      ? state
      : { schemaVersion: 1, positionsByMode: {}, sizesByMode: {} }
    const insert = db.prepare('INSERT INTO window_state (key, value) VALUES (?, ?)')
    const write = db.transaction(() => {
      db.prepare('DELETE FROM window_state').run()
      insert.run('schemaVersion', JSON.stringify(normalized.schemaVersion || 1))
      insert.run('positionsByMode', JSON.stringify(normalized.positionsByMode || {}))
      insert.run('sizesByMode', JSON.stringify(normalized.sizesByMode || {}))
    })

    write()
    return getWindowState()
  }

  const replaceSidecarData = data => {
    const normalizedSettings = normalizeSidecarSettings(data?.settings)
    const normalizedPrompts = normalizePromptTemplates(data?.promptTemplates)
    const normalizedFavorites = normalizeFavoriteItems(data?.favorites)
    const rawUsageByThread = data?.contextUsageByThread && typeof data.contextUsageByThread === 'object'
      ? data.contextUsageByThread
      : {}
    const rawThreadLinks = Array.isArray(data?.threadLinks) ? data.threadLinks : []
    const normalizedContinuationResults = normalizeContinuationResults(data?.continuationResults)
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    const insertPrompt = db.prepare(`
      INSERT INTO prompt_templates (id, name, body, default_path, sort_order)
      VALUES (@id, @name, @body, @defaultPath, @sortOrder)
    `)
    const insertFavorite = db.prepare('INSERT INTO favorites (key, payload, created_at) VALUES (?, ?, ?)')
    const insertUsage = db.prepare(`
      INSERT INTO context_usage (thread_id, percent, total_tokens, model_context_window, updated_at)
      VALUES (@threadId, @percent, @totalTokens, @modelContextWindow, @updatedAt)
    `)
    const insertThreadLink = db.prepare(`
      INSERT INTO thread_links (from_thread_id, to_thread_id, created_at, summary)
      VALUES (@fromThreadId, @toThreadId, @createdAt, @summary)
    `)
    const insertContinuationResult = db.prepare(`
      INSERT INTO continuation_results (thread_id, payload, source_updated_at, completed_at, unread)
      VALUES (@threadId, @payload, @sourceUpdatedAt, @completedAt, @unread)
    `)
    const write = db.transaction(() => {
      db.prepare('DELETE FROM settings').run()
      db.prepare('DELETE FROM prompt_templates').run()
      db.prepare('DELETE FROM favorites').run()
      db.prepare('DELETE FROM context_usage').run()
      db.prepare('DELETE FROM thread_links').run()
      db.prepare('DELETE FROM continuation_results').run()

      for (const [key, value] of Object.entries(normalizedSettings)) {
        insertSetting.run(key, JSON.stringify(value))
      }

      for (const [index, template] of normalizedPrompts.entries()) {
        insertPrompt.run({ ...template, sortOrder: index })
      }

      for (const favorite of normalizedFavorites) {
        insertFavorite.run(favoriteItemKey(favorite), JSON.stringify(favorite), favorite.createdAt)
      }

      for (const [threadId, usage] of Object.entries(rawUsageByThread)) {
        const normalizedUsage = normalizeContextUsage(usage)

        if (normalizedUsage) {
          insertUsage.run({ threadId, ...normalizedUsage })
        }
      }

      for (const link of rawThreadLinks) {
        if (!link || typeof link !== 'object' || !link.fromThreadId || !link.toThreadId) {
          continue
        }

        insertThreadLink.run({
          fromThreadId: normalizeString(link.fromThreadId),
          toThreadId: normalizeString(link.toThreadId),
          createdAt: normalizeTimestamp(link.createdAt) || Date.now(),
          summary: normalizeString(link.summary) || null
        })
      }

      for (const result of Object.values(normalizedContinuationResults)) {
        insertContinuationResult.run({
          threadId: result.threadId,
          payload: JSON.stringify(result),
          sourceUpdatedAt: result.sourceUpdatedAt,
          completedAt: result.completedAt,
          unread: result.unread ? 1 : 0
        })
      }
    })

    write()
    return getSidecarData()
  }

  const listExplorationRuns = () => {
    const rows = db.prepare('SELECT payload FROM exploration_runs ORDER BY created_at DESC LIMIT ?').all(EXPLORATION_RUN_LIMIT)
    return rows.map(row => normalizeExplorationRun(parseJson(row.payload, null))).filter(Boolean)
  }

  const getExplorationRun = runId => {
    const normalizedRunId = normalizeString(runId).trim()

    if (!normalizedRunId) {
      return null
    }

    const row = db.prepare('SELECT payload FROM exploration_runs WHERE id = ?').get(normalizedRunId)
    return row ? normalizeExplorationRun(parseJson(row.payload, null)) : null
  }

  const saveExplorationRun = run => {
    const normalizedRun = normalizeExplorationRun(run)

    if (!normalizedRun) {
      throw new Error('exploration run is invalid.')
    }

    db.prepare(`
      INSERT OR REPLACE INTO exploration_runs (id, payload, status, created_at, updated_at)
      VALUES (@id, @payload, @status, @createdAt, @updatedAt)
    `).run({
      id: normalizedRun.id,
      payload: JSON.stringify(normalizedRun),
      status: normalizedRun.status,
      createdAt: normalizedRun.createdAt,
      updatedAt: normalizedRun.updatedAt
    })

    return normalizedRun
  }

  const replaceExplorationRuns = runs => {
    const normalizedRuns = Array.isArray(runs)
      ? runs.map(normalizeExplorationRun).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt).slice(0, EXPLORATION_RUN_LIMIT)
      : []
    const insertRun = db.prepare(`
      INSERT INTO exploration_runs (id, payload, status, created_at, updated_at)
      VALUES (@id, @payload, @status, @createdAt, @updatedAt)
    `)
    const write = db.transaction(() => {
      db.prepare('DELETE FROM exploration_runs').run()
      for (const run of normalizedRuns) {
        insertRun.run({
          id: run.id,
          payload: JSON.stringify(run),
          status: run.status,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt
        })
      }
    })

    write()
    return listExplorationRuns()
  }

  return {
    close: () => db.close(),
    db,
    getSettings,
    updateSettings,
    listPromptTemplates,
    savePromptTemplates,
    listFavorites,
    setFavorite,
    getContextUsageByThread,
    setContextUsage,
    listThreadLinks,
    listContinuationResults,
    getContinuationResult,
    saveContinuationResult,
    setContinuationResultUnread,
    replaceContinuationResults,
    getSidecarData,
    getWindowState,
    saveWindowState,
    replaceSidecarData,
    listExplorationRuns,
    getExplorationRun,
    saveExplorationRun,
    replaceExplorationRuns
  }
}

module.exports = {
  SIDECAR_STORE_SCHEMA_VERSION,
  createDefaultSidecarSettings,
  createDefaultPromptTemplates,
  createSidecarStore,
  normalizeExplorationRun,
  normalizeContinuationResult,
  normalizeContinuationResults,
  normalizeFavoriteItem,
  normalizeFavoriteItems,
  normalizePromptTemplates,
  normalizeSidecarSettings
}
