const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sidecar', {
  getCodexStore: options => ipcRenderer.invoke('sidecar:getCodexStore', options),
  getSidecarData: () => ipcRenderer.invoke('sidecar:getSidecarData'),
  getHookStatus: options => ipcRenderer.invoke('sidecar:getHookStatus', options),
  openCodexSettings: () => ipcRenderer.invoke('sidecar:openCodexSettings'),
  openGitHub: () => ipcRenderer.invoke('sidecar:openGitHub'),
  getUpdateState: () => ipcRenderer.invoke('sidecar:getUpdateState'),
  installUpdate: () => ipcRenderer.invoke('sidecar:installUpdate'),
  setFavorite: (item, favorite) => ipcRenderer.invoke('sidecar:setFavorite', item, favorite),
  savePromptTemplates: templates => ipcRenderer.invoke('sidecar:savePromptTemplates', templates),
  setLanguageMode: languageMode => ipcRenderer.invoke('sidecar:setLanguageMode', languageMode),
  setThemeMode: themeMode => ipcRenderer.invoke('sidecar:setThemeMode', themeMode),
  setMiniOverDock: miniOverDock => ipcRenderer.invoke('sidecar:setMiniOverDock', miniOverDock),
  setShowMiniTool: showMiniTool => ipcRenderer.invoke('sidecar:setShowMiniTool', showMiniTool),
  setShowMiniPrompts: showMiniPrompts => ipcRenderer.invoke('sidecar:setShowMiniPrompts', showMiniPrompts),
  exportData: () => ipcRenderer.invoke('sidecar:exportData'),
  importData: () => ipcRenderer.invoke('sidecar:importData'),
  openThread: threadId => ipcRenderer.invoke('sidecar:openThread', threadId),
  continueThreadWithSummary: (threadId, cwd, sourceUpdatedAt) => ipcRenderer.invoke('sidecar:continueThreadWithSummary', threadId, cwd, sourceUpdatedAt),
  setContinuationResultUnread: (threadId, unread) => ipcRenderer.invoke('sidecar:setContinuationResultUnread', threadId, unread),
  chooseExplorationImages: () => ipcRenderer.invoke('sidecar:chooseExplorationImages'),
  createExplorationRun: request => ipcRenderer.invoke('sidecar:createExplorationRun', request),
  getExplorations: () => ipcRenderer.invoke('sidecar:getExplorations'),
  getExplorationRun: runId => ipcRenderer.invoke('sidecar:getExplorationRun', runId),
  deleteExplorationRun: runId => ipcRenderer.invoke('sidecar:deleteExplorationRun', runId),
  openExplorationResult: runId => ipcRenderer.invoke('sidecar:openExplorationResult', runId),
  getThreadTurnPreviews: threadId => ipcRenderer.invoke('sidecar:getThreadTurnPreviews', threadId),
  showPopupMenu: options => ipcRenderer.invoke('sidecar:showPopupMenu', options),
  getPopupMenuData: () => ipcRenderer.invoke('sidecar:getPopupMenuData'),
  selectPopupMenuItem: itemId => ipcRenderer.invoke('sidecar:selectPopupMenuItem', itemId),
  closePopupMenu: () => ipcRenderer.invoke('sidecar:closePopupMenu'),
  showThreadMenu: (items, point) => ipcRenderer.invoke('sidecar:showThreadMenu', items, point),
  openNewThread: options => ipcRenderer.invoke('sidecar:openNewThread', options),
  copyText: text => ipcRenderer.invoke('sidecar:copyText', text),
  closeWindow: () => ipcRenderer.invoke('sidecar:closeWindow'),
  getWindowMode: () => ipcRenderer.invoke('sidecar:getWindowMode'),
  showMainWindow: () => ipcRenderer.invoke('sidecar:showMainWindow'),
  setWindowMode: (mode, options) => ipcRenderer.invoke('sidecar:setWindowMode', mode, options),
  startMiniDrag: point => ipcRenderer.send('sidecar:miniDragStart', point),
  moveMiniDrag: point => ipcRenderer.send('sidecar:miniDragMove', point),
  endMiniDrag: point => ipcRenderer.send('sidecar:miniDragEnd', point),
  onWindowMode: callback => {
    const listener = (_event, mode) => callback(mode)

    ipcRenderer.on('sidecar:windowMode', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:windowMode', listener)
    }
  },
  onSelectPanel: callback => {
    const listener = (_event, panel) => callback(panel)

    ipcRenderer.on('sidecar:selectPanel', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:selectPanel', listener)
    }
  },
  onPopupMenuData: callback => {
    const listener = (_event, data) => callback(data)

    ipcRenderer.on('sidecar:popupMenuData', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:popupMenuData', listener)
    }
  },
  onCodexStore: callback => {
    const listener = (_event, codexStore) => callback(codexStore)

    ipcRenderer.on('sidecar:codexStore', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:codexStore', listener)
    }
  },
  onSidecarDataChanged: callback => {
    const listener = (_event, sidecarData) => callback(sidecarData)

    ipcRenderer.on('sidecar:sidecarDataChanged', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:sidecarDataChanged', listener)
    }
  },
  onHookStatusChanged: callback => {
    const listener = (_event, hookStatus) => callback(hookStatus)

    ipcRenderer.on('sidecar:hookStatusChanged', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:hookStatusChanged', listener)
    }
  },
  onUpdateStateChanged: callback => {
    const listener = (_event, updateState) => callback(updateState)

    ipcRenderer.on('sidecar:updateStateChanged', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:updateStateChanged', listener)
    }
  },
  onExplorationsChanged: callback => {
    const listener = (_event, explorations) => callback(explorations)

    ipcRenderer.on('sidecar:explorationsChanged', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:explorationsChanged', listener)
    }
  }
})
