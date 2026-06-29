const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sidecar', {
  getSnapshot: options => ipcRenderer.invoke('sidecar:getSnapshot', options),
  getSidecarData: () => ipcRenderer.invoke('sidecar:getSidecarData'),
  setFavorite: (item, favorite) => ipcRenderer.invoke('sidecar:setFavorite', item, favorite),
  savePromptTemplates: templates => ipcRenderer.invoke('sidecar:savePromptTemplates', templates),
  setLanguageMode: languageMode => ipcRenderer.invoke('sidecar:setLanguageMode', languageMode),
  setThemeMode: themeMode => ipcRenderer.invoke('sidecar:setThemeMode', themeMode),
  setMiniOverDock: miniOverDock => ipcRenderer.invoke('sidecar:setMiniOverDock', miniOverDock),
  setShowMiniPrompts: showMiniPrompts => ipcRenderer.invoke('sidecar:setShowMiniPrompts', showMiniPrompts),
  exportData: () => ipcRenderer.invoke('sidecar:exportData'),
  importData: () => ipcRenderer.invoke('sidecar:importData'),
  openThread: threadId => ipcRenderer.invoke('sidecar:openThread', threadId),
  openThreadAndSearch: (threadId, searchText) => ipcRenderer.invoke('sidecar:openThreadAndSearch', threadId, searchText),
  continueThreadWithSummary: (threadId, cwd) => ipcRenderer.invoke('sidecar:continueThreadWithSummary', threadId, cwd),
  checkAccessibilityPermission: () => ipcRenderer.invoke('sidecar:checkAccessibilityPermission'),
  getThreadUserMessages: threadId => ipcRenderer.invoke('sidecar:getThreadUserMessages', threadId),
  showPopupMenu: options => ipcRenderer.invoke('sidecar:showPopupMenu', options),
  getPopupMenuData: () => ipcRenderer.invoke('sidecar:getPopupMenuData'),
  selectPopupMenuItem: itemId => ipcRenderer.invoke('sidecar:selectPopupMenuItem', itemId),
  closePopupMenu: () => ipcRenderer.invoke('sidecar:closePopupMenu'),
  showThreadMenu: (items, point) => ipcRenderer.invoke('sidecar:showThreadMenu', items, point),
  openNewThread: options => ipcRenderer.invoke('sidecar:openNewThread', options),
  copyText: text => ipcRenderer.invoke('sidecar:copyText', text),
  closeWindow: () => ipcRenderer.invoke('sidecar:closeWindow'),
  getWindowMode: () => ipcRenderer.invoke('sidecar:getWindowMode'),
  setWindowMode: mode => ipcRenderer.invoke('sidecar:setWindowMode', mode),
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
  onPopupMenuData: callback => {
    const listener = (_event, data) => callback(data)

    ipcRenderer.on('sidecar:popupMenuData', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:popupMenuData', listener)
    }
  },
  onSnapshot: callback => {
    const listener = (_event, snapshot) => callback(snapshot)

    ipcRenderer.on('sidecar:snapshot', listener)

    return () => {
      ipcRenderer.removeListener('sidecar:snapshot', listener)
    }
  }
})
