/// <reference types="vite/client" />

import type {
  ExplorationCreateRequest,
  ExplorationRun,
  FavoriteItem,
  LanguageMode,
  OpenNewThreadOptions,
  PopupMenuData,
  PopupMenuResult,
  PopupMenuShowOptions,
  PromptTemplate,
  CodexStore,
  SidecarData,
  SidecarHookStatus,
  SidecarSettings,
  ThemeMode,
  ThreadContinuationRunResult,
  ThreadContinuationResult,
  ThreadTurnPreview
} from './types/sidecar'

interface MiniDragPoint {
  screenX: number
  screenY: number
}

interface SidecarUpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'downloaded' | 'not-available' | 'error'
  currentVersion: string
  downloadedVersion: string | null
  error: string | null
  canInstall: boolean
  isPackaged: boolean
}

type WindowMode = 'mini' | 'full' | 'popup-menu' | 'exploration-result'
type PanelKey = 'threads' | 'bookmarks' | 'explorations' | 'prompts' | 'data'

declare global {
  interface Window {
    sidecar: {
      getCodexStore: (options?: unknown) => Promise<CodexStore>
      getSidecarData: () => Promise<SidecarData>
      getHookStatus: (options?: { refresh?: boolean }) => Promise<SidecarHookStatus>
      openCodexSettings: () => Promise<boolean>
      openGitHub: () => Promise<boolean>
      getUpdateState: () => Promise<SidecarUpdateState>
      installUpdate: () => Promise<{ ok: boolean, error?: string }>
      setFavorite: (item: FavoriteItem, favorite: boolean) => Promise<{ key: string, favorite: boolean, item: FavoriteItem }>
      savePromptTemplates: (templates: PromptTemplate[]) => Promise<PromptTemplate[]>
      setLanguageMode: (languageMode: LanguageMode) => Promise<SidecarSettings>
      setThemeMode: (themeMode: ThemeMode) => Promise<SidecarSettings>
      setMiniOverDock: (miniOverDock: boolean) => Promise<SidecarSettings>
      setShowMiniTool: (showMiniTool: boolean) => Promise<SidecarSettings>
      setShowMiniPrompts: (showMiniPrompts: boolean) => Promise<SidecarSettings>
      exportData: () => Promise<{ canceled: boolean, filePath?: string }>
      importData: () => Promise<{ canceled: boolean, filePath?: string }>
      openThread: (threadId: string) => Promise<boolean>
      continueThreadWithSummary: (threadId: string, cwd: string, sourceUpdatedAt: number | null) => Promise<ThreadContinuationRunResult>
      setContinuationResultUnread: (threadId: string, unread: boolean) => Promise<ThreadContinuationResult | null>
      chooseExplorationImages: () => Promise<Array<{ path: string, name: string }>>
      createExplorationRun: (request: ExplorationCreateRequest) => Promise<ExplorationRun>
      getExplorations: () => Promise<ExplorationRun[]>
      getExplorationRun: (runId: string) => Promise<ExplorationRun | null>
      deleteExplorationRun: (runId: string) => Promise<ExplorationRun | null>
      openExplorationResult: (runId: string) => Promise<boolean>
      getThreadTurnPreviews: (threadId: string) => Promise<{ threadId: string, turnPreviews: ThreadTurnPreview[] }>
      showPopupMenu: (options: PopupMenuShowOptions) => Promise<PopupMenuResult>
      getPopupMenuData: () => Promise<PopupMenuData | null>
      selectPopupMenuItem: (itemId: string) => Promise<boolean>
      closePopupMenu: () => Promise<boolean>
      showThreadMenu: (items: Array<{ id: string, title: string }>, point?: PopupMenuShowOptions['point']) => Promise<boolean>
      openNewThread: (options: OpenNewThreadOptions) => Promise<boolean>
      copyText: (text: string) => Promise<boolean>
      closeWindow: () => Promise<boolean>
      getWindowMode: () => Promise<WindowMode>
      showMainWindow: () => Promise<boolean>
      setWindowMode: (mode: WindowMode, options?: { activePanel?: PanelKey }) => Promise<boolean>
      startMiniDrag: (point: MiniDragPoint) => void
      moveMiniDrag: (point: MiniDragPoint) => void
      endMiniDrag: (point: MiniDragPoint) => void
      onWindowMode: (callback: (mode: WindowMode) => void) => () => void
      onSelectPanel: (callback: (panel: PanelKey) => void) => () => void
      onPopupMenuData: (callback: (data: PopupMenuData) => void) => () => void
      onCodexStore: (callback: (codexStore: CodexStore) => void) => () => void
      onSidecarDataChanged: (callback: (sidecarData: SidecarData) => void) => () => void
      onHookStatusChanged: (callback: (hookStatus: SidecarHookStatus) => void) => () => void
      onUpdateStateChanged: (callback: (state: SidecarUpdateState) => void) => () => void
      onExplorationsChanged: (callback: (explorations: ExplorationRun[]) => void) => () => void
    }
  }
}

export {}
