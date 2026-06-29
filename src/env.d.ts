/// <reference types="vite/client" />

import type {
  FavoriteItem,
  LanguageMode,
  OpenNewThreadOptions,
  PopupMenuData,
  PopupMenuResult,
  PopupMenuShowOptions,
  PromptTemplate,
  SidecarData,
  SidecarSettings,
  SidecarSnapshot,
  ThemeMode,
  ThreadUserMessagePreview
} from './types/sidecar'

interface MiniDragPoint {
  screenX: number
  screenY: number
}

type WindowMode = 'mini' | 'full' | 'popup-menu'

declare global {
  interface Window {
    sidecar: {
      getSnapshot: (options?: unknown) => Promise<SidecarSnapshot>
      getSidecarData: () => Promise<SidecarData>
      setFavorite: (item: FavoriteItem, favorite: boolean) => Promise<{ key: string, favorite: boolean, item: FavoriteItem }>
      savePromptTemplates: (templates: PromptTemplate[]) => Promise<PromptTemplate[]>
      setLanguageMode: (languageMode: LanguageMode) => Promise<SidecarSettings>
      setThemeMode: (themeMode: ThemeMode) => Promise<SidecarSettings>
      setMiniOverDock: (miniOverDock: boolean) => Promise<SidecarSettings>
      setShowMiniPrompts: (showMiniPrompts: boolean) => Promise<SidecarSettings>
      exportData: () => Promise<{ canceled: boolean, filePath?: string }>
      importData: () => Promise<{ canceled: boolean, filePath?: string }>
      openThread: (threadId: string) => Promise<boolean>
      openThreadAndSearch: (threadId: string, searchText: string) => Promise<boolean>
      continueThreadWithSummary: (threadId: string, cwd: string) => Promise<{ threadId: string, forkThreadId: string, summary: string, prompt: string }>
      checkAccessibilityPermission: () => Promise<{ granted: boolean, error: string | null }>
      getThreadUserMessages: (threadId: string) => Promise<{ threadId: string, messages: ThreadUserMessagePreview[] }>
      showPopupMenu: (options: PopupMenuShowOptions) => Promise<PopupMenuResult>
      getPopupMenuData: () => Promise<PopupMenuData | null>
      selectPopupMenuItem: (itemId: string) => Promise<boolean>
      closePopupMenu: () => Promise<boolean>
      showThreadMenu: (items: Array<{ id: string, title: string }>, point?: PopupMenuShowOptions['point']) => Promise<boolean>
      openNewThread: (options: OpenNewThreadOptions) => Promise<boolean>
      copyText: (text: string) => Promise<boolean>
      closeWindow: () => Promise<boolean>
      getWindowMode: () => Promise<WindowMode>
      setWindowMode: (mode: WindowMode) => Promise<boolean>
      startMiniDrag: (point: MiniDragPoint) => void
      moveMiniDrag: (point: MiniDragPoint) => void
      endMiniDrag: (point: MiniDragPoint) => void
      onWindowMode: (callback: (mode: WindowMode) => void) => () => void
      onPopupMenuData: (callback: (data: PopupMenuData) => void) => () => void
      onSnapshot: (callback: (snapshot: SidecarSnapshot) => void) => () => void
    }
  }
}

export {}
