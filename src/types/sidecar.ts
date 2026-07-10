export type ThreadStatusKind = 'idle' | 'running' | 'waiting' | 'failed'
export type SidecarThreadStatus = 'unknown' | 'idle' | 'completedUnread' | 'running' | 'waiting' | 'failed'
export type UsageDisplayMode = 'used' | 'remaining'
export type AppLocale = 'en' | 'zh'
export type LanguageMode = 'auto' | AppLocale
export type ThemeMode = 'auto' | 'light' | 'dark'
export type SidecarHookIssue = 'missing' | 'untrusted' | 'disabled'

export interface SidecarHookStatus {
  ready: boolean
  issue: SidecarHookIssue | null
  missingEvents: string[]
  untrustedEvents: string[]
  disabledEvents: string[]
  checkedAt: number
  error: string | null
}

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

export type CodexStoreThreadSummary = Omit<ThreadSummary, 'favorite'>

export interface RateLimitWindow {
  label: string | null
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

export interface AccountUsageDailyBucket {
  startDate: string
  tokens: number
}

export interface AccountUsageSummary {
  lifetimeTokens: number
  peakDailyTokens: number
  longestRunningTurnSec: number
  currentStreakDays: number
  longestStreakDays: number
}

export interface AccountUsageLocalTodayEstimate {
  date: string
  tokens: number
  source: 'localTranscript'
  threadCount: number
  eventCount: number
  updatedAt: number
}

export interface AccountUsage {
  summary: AccountUsageSummary
  dailyUsageBuckets: AccountUsageDailyBucket[]
  updatedAt: number
  localTodayEstimate?: AccountUsageLocalTodayEstimate | null
}

export interface ThreadFavoriteItem {
  type: 'thread'
  id: string
  threadId: string
  createdAt: number
}

export interface TurnFavoriteItem {
  type: 'turn'
  id: string
  threadId: string
  turnId: string
  userItemId: string
  userPreview: string
  userSearchText: string
  assistantItemId: string
  assistantPreview: string
  turnCreatedAt: number | null
  createdAt: number
  threadTitle: string
  codexTitle: string
  cwd: string
  projectName: string
}

export type FavoriteItem = ThreadFavoriteItem | TurnFavoriteItem
export type TurnBookmark = TurnFavoriteItem

export interface PromptTemplate {
  id: string
  name: string
  body: string
  defaultPath?: string
}

export interface ThreadTurnPreview {
  id: string
  turnId: string
  userItemId: string
  userPreview: string
  userSearchText: string
  assistantItemId: string
  assistantPreview: string
  createdAt: number | null
  index: number
}

export type ExplorationRunStatus = 'running' | 'summarizing' | 'completed' | 'partialFailed' | 'failed'
export type ExplorationCandidateStatus = 'pending' | 'running' | 'completed' | 'failed'
export type ExplorationSummaryStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ExplorationImage {
  id: string
  name: string
  path: string
  createdAt: number
}

export interface ExplorationCandidate {
  id: string
  index: number
  threadId: string | null
  turnId: string | null
  status: ExplorationCandidateStatus
  output: string
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface ExplorationSummary {
  threadId: string | null
  turnId: string | null
  status: ExplorationSummaryStatus
  output: string
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface ExplorationRun {
  id: string
  title: string
  prompt: string
  images: ExplorationImage[]
  concurrency: number
  sourceThreadId: string | null
  sourceThreadTitle: string | null
  sourceThreadCwd: string | null
  status: ExplorationRunStatus
  createdAt: number
  updatedAt: number
  completedAt: number | null
  candidates: ExplorationCandidate[]
  summary: ExplorationSummary
}

export interface ExplorationCreateRequest {
  prompt: string
  imagePaths: string[]
  concurrency: number
  sourceThreadId?: string | null
}

export interface SidecarSettings {
  languageMode: LanguageMode
  themeMode: ThemeMode
  miniOverDock: boolean
  showMiniTool: boolean
  showMiniPrompts: boolean
}

export interface ThreadContinuationResult {
  threadId: string
  sourceUpdatedAt: number | null
  summary: string
  prompt: string
  completedAt: number
  unread: boolean
}

export interface ThreadContinuationRunResult extends ThreadContinuationResult {
  forkThreadId: string
}

export interface SidecarData {
  schemaVersion: number
  promptTemplates: PromptTemplate[]
  favorites: FavoriteItem[]
  contextUsageByThread: Record<string, ContextUsageCache>
  threadLinks: Array<{ fromThreadId: string, toThreadId: string, createdAt: number, summary?: string }>
  continuationResults: Record<string, ThreadContinuationResult>
  settings: SidecarSettings
}

export interface NativeUnreadState {
  available: boolean
  path: string
  count: number
  error: string | null
}

export interface CodexStore {
  generatedAt: number
  connection: {
    connected: boolean
    lastError: string | null
  }
  nativeUnread: NativeUnreadState
  rateLimits: RateLimitSummary | null
  accountUsage: AccountUsage | null
  threads: CodexStoreThreadSummary[]
  error?: string
}

export interface OpenNewThreadOptions {
  prompt?: string
  path?: string
}
