const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')

const { createSidecarStore } = require('./sidecar-store.cjs')

const createTempStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-store-'))
  const dbPath = path.join(dir, 'sidecar.sqlite')
  const store = createSidecarStore(dbPath)

  return { dir, dbPath, store }
}

test('persists Sidecar-owned settings, prompts, favorites, window state, usage, and explorations', () => {
  const { dbPath, store } = createTempStore()
  const initialData = store.getSidecarData()

  assert.equal(initialData.settings.themeMode, 'auto')
  assert.equal(initialData.settings.languageMode, 'auto')
  assert.equal(initialData.settings.showMiniTool, true)
  assert.deepEqual(initialData.promptTemplates, [])
  assert.deepEqual(initialData.favorites, [])

  const savedSettings = store.updateSettings({
    themeMode: 'dark',
    languageMode: 'zh',
    miniOverDock: false,
    showMiniTool: false,
    showMiniPrompts: false
  })
  const templates = [
    { id: 'prompt-a', name: 'Prompt A', body: 'Body A', defaultPath: '/tmp/a' },
    { id: 'prompt-b', name: 'Prompt B', body: 'Body B', defaultPath: '' }
  ]
  const favorite = {
    type: 'thread',
    id: 'thread-1',
    threadId: 'thread-1',
    createdAt: 123
  }
  const run = {
    id: 'run-1',
    title: 'Run 1',
    prompt: 'Explore',
    images: [],
    concurrency: 2,
    sourceThreadId: null,
    sourceThreadTitle: null,
    sourceThreadCwd: null,
    status: 'running',
    createdAt: 100,
    updatedAt: 200,
    completedAt: null,
    candidates: [],
    summary: {
      threadId: null,
      turnId: null,
      status: 'pending',
      output: '',
      error: null,
      startedAt: null,
      completedAt: null
    }
  }

  store.savePromptTemplates(templates)
  store.setFavorite(favorite, true)
  store.setContextUsage('thread-1', {
    percent: 42,
    totalTokens: 420,
    modelContextWindow: 1000,
    updatedAt: 456
  })
  store.saveWindowState({
    schemaVersion: 2,
    positionsByMode: {
      full: { x: 10, y: 20 }
    },
    sizesByMode: {
      full: { width: 360, height: 600 }
    }
  })
  store.saveExplorationRun(run)
  store.close()

  const reopened = createSidecarStore(dbPath)
  const data = reopened.getSidecarData()

  assert.deepEqual(savedSettings, data.settings)
  assert.deepEqual(data.promptTemplates, templates)
  assert.deepEqual(data.favorites, [favorite])
  assert.deepEqual(data.contextUsageByThread['thread-1'], {
    percent: 42,
    totalTokens: 420,
    modelContextWindow: 1000,
    updatedAt: 456
  })
  assert.deepEqual(reopened.getWindowState(), {
    schemaVersion: 2,
    positionsByMode: {
      full: { x: 10, y: 20 }
    },
    sizesByMode: {
      full: { width: 360, height: 600 }
    }
  })
  assert.deepEqual(reopened.listExplorationRuns(), [run])
  assert.deepEqual(reopened.getExplorationRun('run-1'), run)

  reopened.close()
})

test('persists latest thread continuation results and includes them in Sidecar data replacement', () => {
  const { dbPath, store } = createTempStore()
  const continuationResult = {
    threadId: 'thread-1',
    sourceUpdatedAt: 123,
    summary: 'Summary A',
    prompt: 'Continuation prompt A',
    completedAt: 456,
    unread: true
  }

  assert.deepEqual(store.getSidecarData().continuationResults, {})

  assert.deepEqual(store.saveContinuationResult(continuationResult), continuationResult)
  store.close()

  const reopened = createSidecarStore(dbPath)

  assert.deepEqual(reopened.getSidecarData().continuationResults, {
    'thread-1': continuationResult
  })

  assert.deepEqual(reopened.setContinuationResultUnread('thread-1', false), {
    ...continuationResult,
    unread: false
  })

  reopened.replaceSidecarData({
    ...reopened.getSidecarData(),
    continuationResults: {
      'thread-2': {
        threadId: 'thread-2',
        sourceUpdatedAt: null,
        summary: 'Summary B',
        prompt: 'Continuation prompt B',
        completedAt: 789,
        unread: true
      }
    }
  })

  assert.deepEqual(reopened.getSidecarData().continuationResults, {
    'thread-2': {
      threadId: 'thread-2',
      sourceUpdatedAt: null,
      summary: 'Summary B',
      prompt: 'Continuation prompt B',
      completedAt: 789,
      unread: true
    }
  })

  reopened.close()
})

test('persists turn bookmarks and reads legacy message bookmarks as turn bookmarks', () => {
  const { dbPath, store } = createTempStore()
  const turnBookmark = {
    type: 'turn',
    id: 'thread-1:turn-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    userItemId: 'user-item-1',
    userPreview: 'How should we handle assistant navigation?',
    userSearchText: 'How should we handle assistant navigation?',
    assistantItemId: 'assistant-item-1',
    assistantPreview: 'Use only the final assistant answer.',
    turnCreatedAt: 456,
    createdAt: 789,
    threadTitle: 'Navigation design',
    codexTitle: 'Navigation design',
    cwd: '/tmp/project',
    projectName: 'project'
  }

  store.setFavorite(turnBookmark, true)
  store.close()

  const reopened = createSidecarStore(dbPath)

  assert.deepEqual(reopened.getSidecarData().favorites, [turnBookmark])

  const legacyMessageBookmark = {
    type: 'message',
    id: 'thread-2:turn-2:user-item-2',
    threadId: 'thread-2',
    messageId: 'thread-2:turn-2:user-item-2',
    turnId: 'turn-2',
    itemId: 'user-item-2',
    index: 1,
    preview: 'Legacy user preview',
    searchText: 'Legacy user preview',
    messageCreatedAt: 111,
    createdAt: 222,
    threadTitle: 'Legacy thread',
    codexTitle: 'Legacy thread',
    cwd: '/tmp/legacy',
    projectName: 'legacy'
  }

  reopened.replaceSidecarData({
    ...reopened.getSidecarData(),
    favorites: [legacyMessageBookmark]
  })

  assert.deepEqual(reopened.getSidecarData().favorites, [{
    type: 'turn',
    id: 'thread-2:turn-2',
    threadId: 'thread-2',
    turnId: 'turn-2',
    userItemId: 'user-item-2',
    userPreview: 'Legacy user preview',
    userSearchText: 'Legacy user preview',
    assistantItemId: '',
    assistantPreview: '',
    turnCreatedAt: 111,
    createdAt: 222,
    threadTitle: 'Legacy thread',
    codexTitle: 'Legacy thread',
    cwd: '/tmp/legacy',
    projectName: 'legacy'
  }])

  reopened.close()
})

test('migrates legacy message favorite rows so they can be removed as turn bookmarks', () => {
  const { dbPath, store } = createTempStore()
  const legacyMessageBookmark = {
    type: 'message',
    id: 'thread-3:turn-3:user-item-3',
    threadId: 'thread-3',
    messageId: 'thread-3:turn-3:user-item-3',
    turnId: 'turn-3',
    itemId: 'user-item-3',
    index: 1,
    preview: 'Legacy removable user preview',
    searchText: 'Legacy removable user preview',
    messageCreatedAt: 333,
    createdAt: 444,
    threadTitle: 'Legacy removable thread',
    codexTitle: 'Legacy removable thread',
    cwd: '/tmp/removable',
    projectName: 'removable'
  }

  store.close()

  const db = new Database(dbPath)
  db.prepare('INSERT INTO favorites (key, payload, created_at) VALUES (?, ?, ?)').run(
    `message:${legacyMessageBookmark.id}`,
    JSON.stringify(legacyMessageBookmark),
    legacyMessageBookmark.createdAt
  )
  db.close()

  const reopened = createSidecarStore(dbPath)
  const [bookmark] = reopened.getSidecarData().favorites

  assert.equal(bookmark.type, 'turn')
  assert.equal(bookmark.id, 'thread-3:turn-3')

  reopened.setFavorite(bookmark, false)
  assert.deepEqual(reopened.getSidecarData().favorites, [])

  reopened.close()
})
