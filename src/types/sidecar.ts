export type ThreadStatusKind = 'idle' | 'running' | 'waiting' | 'failed'
export type SidecarThreadStatus = 'unknown' | 'idle' | 'completedUnread' | 'running' | 'waiting' | 'failed'
export type UsageDisplayMode = 'used' | 'remaining'
export type AppLocale = 'en' | 'zh'
export type LanguageMode = 'auto' | AppLocale
export type ThemeMode = 'auto' | 'light' | 'dark'

export interface PopupMenuPoint {
  screenX: number
  screenY: number
}

export interface PopupMenuItem {
  id: string
  label: string
  description?: string
  disabled?: boolean
}

export interface PopupMenuData {
  id: string
  items: PopupMenuItem[]
  languageMode: LanguageMode
  themeMode: ThemeMode
}

export interface PopupMenuShowOptions {
  items: PopupMenuItem[]
  point?: PopupMenuPoint
  width?: number
}

export interface PopupMenuResult {
  selectedId: string | null
}

export interface ThreadStatus {
  type: 'notLoaded' | 'idle' | 'systemError' | 'active'
  activeFlags?: Array<'waitingOnApproval' | 'waitingOnUserInput'>
}

export interface ContextUsageCache {
  percent: number
  totalTokens: number
  modelContextWindow: number
  updatedAt: number
}

export interface ThreadSummary {
  id: string
  sessionId: string
  title: string
  codexTitle: string
  preview: string
  cwd: string
  projectName: string
  createdAt: number | null
  updatedAt: number | null
  status: ThreadStatus
  statusKind: ThreadStatusKind
  sidecarStatus: SidecarThreadStatus
  latestTurnStatus: string | null
  lastUserMessagePreview: string
  recentActivity: string
  unread: boolean
  completedUnread: boolean
  favorite: boolean
  contextUsage: ContextUsageCache | null
  gitBranch: string | null
  source: unknown
  path: string | null
}

export type SnapshotThreadSummary = Omit<ThreadSummary, 'favorite'>

export interface RateLimitWindow {
  label: string
  usedPercent: number
  remainingPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface RateLimitSummary {
  limitId: string | null
  limitName: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
}

export interface ThreadFavoriteItem {
  type: 'thread'
  id: string
  threadId: string
  createdAt: number
}

export interface MessageFavoriteItem {
  type: 'message'
  id: string
  threadId: string
  messageId: string
  turnId: string
  itemId: string
  index: number
  preview: string
  searchText: string
  messageCreatedAt: number | null
  createdAt: number
  threadTitle: string
  codexTitle: string
  cwd: string
  projectName: string
}

export type FavoriteItem = ThreadFavoriteItem | MessageFavoriteItem
export type MessageBookmark = MessageFavoriteItem

export interface PromptTemplate {
  id: string
  name: string
  body: string
  defaultPath?: string
}

export interface ThreadUserMessagePreview {
  id: string
  turnId: string
  itemId: string
  preview: string
  searchText: string
  createdAt: number | null
  index: number
}

export interface SidecarSettings {
  languageMode: LanguageMode
  themeMode: ThemeMode
  miniOverDock: boolean
  showMiniPrompts: boolean
}

export interface SidecarData {
  schemaVersion: number
  promptTemplates: PromptTemplate[]
  favorites: FavoriteItem[]
  contextUsageByThread: Record<string, ContextUsageCache>
  threadLinks: Array<{ fromThreadId: string, toThreadId: string, createdAt: number, summary?: string }>
  settings: SidecarSettings
}

export interface NativeUnreadState {
  available: boolean
  path: string
  count: number
  error: string | null
}

export interface SidecarSnapshot {
  generatedAt: number
  connection: {
    connected: boolean
    lastError: string | null
  }
  nativeUnread: NativeUnreadState
  rateLimits: RateLimitSummary | null
  threads: SnapshotThreadSummary[]
  sidecarData: SidecarData
  error?: string
}

export interface OpenNewThreadOptions {
  prompt?: string
  path?: string
}
