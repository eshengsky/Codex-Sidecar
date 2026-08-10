const { EventEmitter } = require('node:events')

const createDataEngineStoreClient = supervisor => ({
  deleteExplorationRun: runId => supervisor.request('explorations.delete', {
    runId
  }),
  getContinuationResult: threadId => supervisor.request('continuation.get', {
    threadId
  }),
  getExplorationRun: runId => supervisor.request('explorations.get', {
    runId
  }),
  getSidecarData: () => supervisor.request('sidecarData.get', null),
  getWindowState: () => supervisor.request('windowState.get', null),
  listExplorationRuns: () => supervisor.request('explorations.list', null),
  saveContinuationResult: result => supervisor.request('continuation.save', result),
  saveExplorationRun: run => supervisor.request('explorations.save', run),
  savePromptTemplates: templates => supervisor.request('prompts.save', templates),
  saveWindowState: state => supervisor.request('windowState.save', state),
  setContinuationResultUnread: (threadId, unread) => supervisor.request('continuation.setUnread', {
    threadId,
    unread
  }),
  setFavorite: (item, favorite) => supervisor.request('favorites.set', {
    item,
    favorite
  }),
  updateSettings: patch => supervisor.request('settings.update', patch)
})

const createCodexClientProxy = supervisor => {
  const events = new EventEmitter()
  let disposed = false

  const handleEngineEvent = message => {
    if (message?.event === 'codexNotification' && message.value?.method) {
      events.emit('notification', message.value)
    }
  }
  const handleHealth = health => {
    if (!disposed && ['restarting', 'failed', 'stopped'].includes(health?.status)) {
      events.emit('close', new Error(health.lastError || 'Sidecar data engine is unavailable.'))
    }
  }

  supervisor.events.on('event', handleEngineEvent)
  supervisor.events.on('health', handleHealth)

  return {
    connect: () => supervisor.start(),
    dispose: () => {
      disposed = true
      supervisor.events.off('event', handleEngineEvent)
      supervisor.events.off('health', handleHealth)
    },
    events,
    getStatus: () => {
      const health = supervisor.getHealth()

      return {
        connected: health.status === 'ready',
        lastError: health.lastError || null
      }
    },
    request: (method, params, timeoutMs = 12000) => supervisor.request('codex.request', {
      method,
      params,
      timeoutMs
    }, {
      timeoutMs: timeoutMs + 1000
    })
  }
}

module.exports = {
  createCodexClientProxy,
  createDataEngineStoreClient
}
