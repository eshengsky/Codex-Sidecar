<template>
  <UApp
    :tooltip="{ disableHoverableContent: true, ignoreNonKeyboardFocus: true, delayDuration: 0 }"
  >
    <PopupMenu
      v-if="mode === 'popup-menu'"
      :menu="popupMenu"
      @select="selectPopupMenuItem"
      @close="closePopupMenu"
    />

    <MiniBar
      v-else-if="mode === 'mini'"
      :counts="counts"
      :rate-limits="codexStore?.rateLimits || null"
      :prompt-templates="promptTemplates"
      :show-prompts="showMiniPrompts"
      :usage-mode="usageMode"
      :class="modeSwitching ? 'opacity-0 pointer-events-none' : ''"
      @expand="showMainWindow"
      @prompts-click="handleMiniPromptsClick"
      @status-click="handleStatusTileClick"
      @toggle-mode="toggleUsageMode"
    />

    <div
      v-else-if="mode === 'exploration-result'"
      class="relative flex h-full w-full flex-col overflow-hidden bg-default text-gray-900 dark:text-gray-100"
    >
      <header class="flex h-10 min-w-0 flex-none items-center justify-center border-b border-gray-100 px-3 [-webkit-app-region:drag] dark:border-neutral-800">
        <div class="min-w-0 flex-1 basis-0 px-16 text-center">
          <h1 class="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[760]">
            {{ t('explorations.resultTitle') }}
          </h1>
        </div>
      </header>

      <main class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div v-if="explorationResultLoading && !explorationResultRun" class="flex min-h-0 flex-1 flex-col gap-2">
          <USkeleton class="h-8 rounded-lg" />
          <USkeleton class="h-10 rounded-lg" />
          <USkeleton class="min-h-0 flex-1 rounded-lg" />
        </div>

        <UEmpty
          v-else-if="!explorationResultRun"
          :title="explorationResultError || t('explorations.missingResult')"
          variant="naked"
          size="sm"
          class="min-h-[260px] self-center"
        />

        <template v-else>
          <div class="flex min-w-0 flex-none flex-col gap-1.5 text-xs leading-[1.45] text-gray-500 dark:text-gray-400">
            <span v-if="explorationResultSourceLabel" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ t('explorations.basedOn', { title: explorationResultSourceLabel }) }}
            </span>

            <div class="flex min-w-0 items-start gap-2">
              <p class="m-0 line-clamp-3 min-w-0 flex-1 basis-0 text-[13px] leading-[1.45] text-gray-700 [overflow-wrap:anywhere] dark:text-gray-200">
                {{ explorationResultPromptText }}
              </p>
              <UPopover
                mode="click"
                :content="{ side: 'bottom', align: 'end', sideOffset: 6 }"
              >
                <button
                  type="button"
                  class="flex-none border-0 bg-transparent p-0 text-xs leading-[1.45] whitespace-nowrap text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  {{ t('explorations.viewFullRequest') }}
                </button>

                <template #content>
                  <div class="max-h-[55vh] w-[calc(100vw-2rem)] max-w-[560px] overflow-auto px-3 py-2.5 text-[13px] leading-[1.55] text-gray-700 dark:text-gray-200">
                    <div class="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{{ t('explorations.originalRequest') }}</div>
                    <p class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ explorationResultPromptText }}</p>
                  </div>
                </template>
              </UPopover>
            </div>
          </div>

          <div class="flex min-w-0 flex-none items-center justify-between gap-2">
            <div class="min-w-0 flex-1 basis-0">
              <div class="flex min-w-0 w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-neutral-200/70 p-0.5 dark:bg-neutral-800" role="tablist">
                <button
                  v-for="tab in explorationResultTabs"
                  :key="tab.key"
                  type="button"
                  class="inline-flex h-8 flex-none items-center justify-center rounded-[7px] border-0 px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                  :class="explorationResultTab === tab.key ? 'bg-default text-gray-950 dark:bg-accented dark:text-white' : 'bg-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
                  role="tab"
                  :aria-selected="explorationResultTab === tab.key"
                  @click="explorationResultTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>

            <div class="flex flex-none items-center gap-1">
              <UButton
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-copy"
                class="whitespace-nowrap"
                :disabled="!selectedExplorationResultText"
                @click="copyCurrentExplorationResult"
              >
                {{ t('explorations.copyContent') }}
              </UButton>
              <UButton
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-message-square-text"
                class="whitespace-nowrap"
                :disabled="!selectedExplorationContinuationText"
                @click="copyCurrentExplorationContinuation"
              >
                {{ t('explorations.copyContinuation') }}
              </UButton>
            </div>
          </div>

          <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[9px] border border-default bg-default">
            <div
              v-if="selectedExplorationResultText"
              class="min-h-0 flex-1 overflow-auto p-4"
            >
              <MarkdownBlock :content="selectedExplorationResultText" />
            </div>
            <div v-else class="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              {{ selectedExplorationResultEmptyText }}
            </div>
          </section>
        </template>
      </main>

    </div>

    <div
      v-else
      class="flex h-full w-full flex-col overflow-hidden bg-default text-gray-900 dark:text-gray-100"
      :class="modeSwitching ? 'opacity-0 pointer-events-none' : ''"
    >
      <header class="h-9 flex-none [-webkit-app-region:drag]" />

      <main class="relative flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden px-2.5 pb-2.5">
      <section
        v-if="showHookSetup"
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-8"
      >
        <UAlert
          v-if="hookSetupStatusText"
          color="warning"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="hookSetupStatusText"
          class="w-full max-w-[300px] text-left p-3"
        />

        <p class="m-0 max-w-[300px] text-center text-[13px] leading-[1.55] text-gray-600 dark:text-gray-300">
          {{ t('hookSetup.description') }}
        </p>

        <ol class="m-0 flex w-full max-w-[280px] list-none flex-col gap-2 p-0 text-left text-[13px] leading-[1.45] text-gray-700 dark:text-gray-200">
          <li
            v-for="step in hookSetupSteps"
            :key="step.index"
            class="flex min-w-0 items-center gap-2.5"
          >
            <span class="numeric-mono inline-flex size-5 flex-none items-center justify-center rounded-full bg-neutral-100 text-[11px] font-semibold text-gray-700 dark:bg-neutral-800 dark:text-gray-200">
              {{ step.index }}
            </span>
            <span class="min-w-0 flex-1 basis-0">{{ step.label }}</span>
          </li>
        </ol>

        <UButton
          color="neutral"
          size="sm"
          icon="i-lucide-settings"
          @click="openCodexSettings"
        >
          {{ t('hookSetup.openSettings') }}
        </UButton>
      </section>

      <template v-else>
      <section v-if="codexStore?.error || usageWarning" class="flex min-w-0 flex-col">
        <UAlert
          v-if="codexStore?.error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="t('app.dataReadFailed')"
          :description="codexStore.error"
        />

        <UAlert
          v-else-if="usageWarning"
          :color="usageWarning.color"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="usageWarning.title"
          :description="usageWarning.description"
        />
      </section>

      <section class="flex min-w-0 items-center gap-1">
        <div
          v-for="tile in statusTiles"
          :key="tile.key"
          class="min-w-0 flex-1 basis-0"
        >
          <UTooltip
            :text="tile.tooltip"
          >
            <button
              type="button"
              class="inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-[7px] border-0 bg-transparent px-1.5 text-gray-600 dark:text-gray-400"
              :class="[
                tile.count === 0 ? 'cursor-default opacity-35 hover:bg-transparent' : 'cursor-pointer hover:bg-elevated'
              ]"
              :aria-label="tile.label"
              @click="handleStatusTileClick(tile.key, $event)"
            >
              <span class="relative h-[10px] w-[10px] flex-none">
                <span
                  v-if="tile.count > 0 && isBreathingStatusTone(tile.tone)"
                  class="sidecar-status-breathe absolute inset-0 rounded-full"
                  :class="statusTilePingClass(tile.tone)"
                />
                <span class="relative block h-full w-full rounded-full" :class="statusTileDotClass(tile.tone)" />
              </span>
              <span class="numeric-mono text-[13px] leading-none text-gray-900 dark:text-gray-100">{{ formatStatusCount(tile.count) }}</span>
            </button>
          </UTooltip>
        </div>
      </section>

      <section v-if="codexStore?.rateLimits?.primary || codexStore?.rateLimits?.secondary" class="flex min-w-0 gap-2">
        <UsageMeter v-if="codexStore?.rateLimits?.primary" :window="codexStore.rateLimits.primary" :mode="usageMode" class="min-w-0 flex-1 basis-0" @toggle-mode="toggleUsageMode" />
        <UsageMeter v-if="codexStore?.rateLimits?.secondary" :window="codexStore.rateLimits.secondary" :mode="usageMode" class="min-w-0 flex-1 basis-0" @toggle-mode="toggleUsageMode" />
      </section>

      <ThreadsPanel
        v-if="activePanel === 'threads'"
        :threads="threads"
        :counts="counts"
        :loading="loading"
        :has-codex-store="Boolean(codexStore)"
        :selected-thread-id="selectedThreadId"
        :continuation-thread-ids="continuationThreadIds"
        :continuation-unread-thread-ids="continuationUnreadThreadIds"
        @open="openThread"
        @toggle-favorite="toggleFavorite"
        @open-navigation="openThreadNavigation"
        @continue-thread="openContinuationConfirm"
      />

      <BookmarksPanel
        v-else-if="activePanel === 'bookmarks'"
        :threads="threads"
        :turn-bookmarks="turnBookmarks"
        :selected-thread-id="selectedThreadId"
        :continuation-thread-ids="continuationThreadIds"
        :continuation-unread-thread-ids="continuationUnreadThreadIds"
        :app-locale="appLocale"
        @open="openThread"
        @toggle-favorite="toggleFavorite"
        @open-navigation="openThreadNavigation"
        @continue-thread="openContinuationConfirm"
        @remove-turn-bookmark="removeTurnBookmark"
        @open-turn-bookmark="openTurnBookmark"
      />

      <ExplorationsPanel
        v-else-if="activePanel === 'explorations'"
        :explorations="explorations"
        :threads="threads"
        :app-locale="appLocale"
        @created="handleExplorationCreated"
        @feedback="setFeedback"
        @open-source-thread="openThreadById"
      />

      <PromptsPanel
        v-else-if="activePanel === 'prompts'"
        :templates="promptTemplates"
        @save="savePromptTemplates"
        @copied="setFeedback(t('feedback.copied'))"
        @failed="setFeedback"
      />

      <SettingsPanel
        v-else
        :language-mode="languageMode"
        :language-options="languageOptions"
        :theme-mode="themeMode"
        :theme-options="themeOptions"
        :show-mini-tool="showMiniTool"
        :mini-over-dock="miniOverDock"
        :show-mini-prompts="showMiniPrompts"
        :exporting="exporting"
        :importing="importing"
        @apply-language-mode="applyLanguageMode"
        @apply-theme-mode="applyThemeMode"
        @apply-show-mini-tool="applyShowMiniTool"
        @apply-mini-over-dock="applyMiniOverDock"
        @apply-show-mini-prompts="applyShowMiniPrompts"
        @feedback="setFeedback"
        @export-data="exportData"
        @import-data="importData"
      />

      <nav class="-mx-3 -mb-3 mt-[-8px] flex min-w-0 flex-none gap-1 border-t border-gray-100 px-3 pt-1 pb-1 dark:border-neutral-800 max-[410px]:-mx-2.5 max-[410px]:-mb-2.5 max-[410px]:px-2.5" :aria-label="t('panels.ariaLabel')">
        <button
          v-for="panel in panels"
          :key="panel.key"
          type="button"
          class="flex h-[46px] min-w-0 flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-0 px-1.5 text-[11px] leading-none font-[680] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          :class="activePanel === panel.key ? 'bg-neutral-100 text-gray-950 dark:bg-neutral-800 dark:text-white' : 'bg-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
          :aria-current="activePanel === panel.key ? 'page' : undefined"
          @click="activePanel = panel.key"
        >
          <UIcon :name="panel.icon" class="size-4 flex-none" />
          <span class="truncate">{{ panel.label }}</span>
        </button>
      </nav>

      <UDrawer
        :open="navigationOpen"
        :title="t('navigation.title')"
        :description="t('navigation.description')"
        direction="bottom"
        :ui="{ content: 'h-[80vh] max-h-[80vh] overflow-hidden' }"
        @update:open="handleNavigationOpenChange"
      >
        <template #content>
          <div class="flex h-full min-h-0 flex-col gap-2 p-3">
            <div class="flex min-w-0 flex-col">
              <UInput
                v-model="navigationSearchTerm"
                icon="i-lucide-search"
                :placeholder="t('navigation.search')"
                size="sm"
                autofocus
                color="neutral"
              />
            </div>

            <div ref="navigationListRef" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-3 -mr-3">
              <template v-if="navigationLoading">
                <USkeleton v-for="index in 4" :key="index" class="ml-auto h-12 w-[86%] rounded-lg" />
              </template>

              <div v-else-if="navigationError" class="self-end rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-right text-xs leading-[1.45] text-red-700">
                {{ navigationError }}
              </div>

              <UEmpty
                v-else-if="filteredNavigationTurnPreviews.length === 0"
                :title="t('navigation.empty')"
                variant="naked"
                size="xs"
                class="self-center p-0 sm:p-0 lg:p-0"
                :ui="{ root: 'p-0 sm:p-0 lg:p-0 gap-1', header: 'gap-1' }"
              />

              <div
                v-for="turnPreview in filteredNavigationTurnPreviews"
                :key="turnPreview.id"
                class="flex max-w-full flex-col items-end gap-1 self-end"
              >
                <span class="self-end text-[10px] leading-none whitespace-nowrap text-gray-500 dark:text-gray-400">{{ formatNavigationMessageTime(turnPreview.createdAt, appLocale) }}</span>
                <div class="flex max-w-full items-start justify-end gap-1.5">
                  <UTooltip :text="isNavigationTurnBookmarked(turnPreview) ? t('bookmarks.removeTurn') : t('bookmarks.addTurn')">
                    <UButton
                      icon="i-lucide-bookmark"
                      :color="isNavigationTurnBookmarked(turnPreview) ? 'warning' : 'neutral'"
                      :variant="isNavigationTurnBookmarked(turnPreview) ? 'soft' : 'ghost'"
                      size="xs"
                      square
                      @click="toggleNavigationTurnBookmark(turnPreview)"
                    />
                  </UTooltip>
                  <div class="flex min-w-0 max-w-[86%] flex-col items-end gap-1">
                    <button
                      type="button"
                      class="flex max-w-full rounded-xl border-0 bg-gray-100 px-3 py-2 text-left text-[13px] leading-[1.45] text-gray-900 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700"
                      :class="navigationJumping ? 'cursor-wait opacity-60' : 'cursor-pointer'"
                      :disabled="navigationJumping"
                      @click="openNavigationThread"
                    >
                      <span class="line-clamp-2 [overflow-wrap:anywhere]">{{ turnPreview.userPreview }}</span>
                    </button>
                    <div
                      v-if="turnPreview.assistantPreview"
                      class="flex max-w-full rounded-xl bg-gray-50 px-3 py-2 text-left text-[13px] leading-[1.45] text-gray-700 dark:bg-neutral-900 dark:text-gray-300"
                    >
                      <span class="line-clamp-3 [overflow-wrap:anywhere]">{{ turnPreview.assistantPreview }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </UDrawer>

      <UModal
        :open="continuationConfirmOpen"
        :title="t('continuation.title')"
        @update:open="handleContinuationConfirmOpenChange"
      >
        <template #body>
          <div class="flex flex-col gap-3 text-[13px] leading-[1.55] text-gray-700 dark:text-gray-200">
            <p class="m-0">
              {{ t('continuation.body', { title: pendingContinuationThread?.title || t('continuation.currentThread') }) }}
            </p>
            <div class="flex flex-col gap-1.5 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
              <span>{{ t('continuation.detailOne') }}</span>
              <span>{{ t('continuation.detailTwo') }}</span>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full flex-wrap items-center gap-1.5">
            <UTooltip
              v-if="pendingContinuationResult"
              :text="formatContinuationGeneratedAt(pendingContinuationResult.completedAt)"
              :content="{ side: 'top' }"
            >
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-copy"
                @click="copyLastContinuation"
              >
                {{ t('continuation.copyLast') }}
              </UButton>
            </UTooltip>
            <div class="ml-auto flex flex-wrap justify-end gap-1.5">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                @click="closeContinuationConfirm"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                color="neutral"
                size="sm"
                :disabled="!pendingContinuationThread"
                @click="confirmContinueThreadWithSummary"
              >
                {{ pendingContinuationResult ? t('continuation.regenerate') : t('continuation.confirm') }}
              </UButton>
            </div>
          </div>
        </template>
      </UModal>

      </template>
      </main>
    </div>

    <Teleport to="body">
      <div
        v-if="feedback && (mode === 'full' || mode === 'exploration-result')"
        class="pointer-events-none fixed left-1/2 z-[999999] w-fit max-w-[calc(100%-24px)] -translate-x-1/2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-center text-xs text-gray-900 shadow-[0_12px_28px_rgba(17,24,39,0.16)] [overflow-wrap:anywhere] dark:border-sky-500/30 dark:bg-sky-950 dark:text-sky-100"
        :class="mode === 'exploration-result' ? 'bottom-3' : 'bottom-[72px]'"
      >
        {{ feedback }}
      </div>
    </Teleport>
  </UApp>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniBar from '@/components/MiniBar.vue'
import BookmarksPanel from '@/components/panels/BookmarksPanel.vue'
import ExplorationsPanel from '@/components/panels/ExplorationsPanel.vue'
import MarkdownBlock from '@/components/MarkdownBlock.vue'
import PromptsPanel from '@/components/panels/PromptsPanel.vue'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import ThreadsPanel from '@/components/panels/ThreadsPanel.vue'
import PopupMenu from '@/components/PopupMenu.vue'
import UsageMeter from '@/components/UsageMeter.vue'
import { applyI18nLanguageMode } from '@/i18n'
import type { AppLocale, CodexStore, ExplorationCandidate, ExplorationRun, FavoriteItem, LanguageMode, PopupMenuData, PopupMenuShowOptions, PromptTemplate, SidecarData, SidecarHookStatus, ThemeMode, ThreadContinuationResult, ThreadSummary, ThreadTurnPreview, TurnBookmark, UsageDisplayMode } from '@/types/sidecar'
import { formatNavigationMessageTime, formatResetDateTime } from '@/utils/format'

type StatusTileKey = 'completedUnread' | 'running' | 'waiting' | 'failed'
type PanelKey = 'threads' | 'bookmarks' | 'explorations' | 'prompts' | 'data'
type StatusTileTone = 'completed' | 'running' | 'waiting' | 'failed'
type WindowMode = 'mini' | 'full' | 'popup-menu' | 'exploration-result'
type ExplorationResultTabKey = 'summary' | `candidate:${string}`
const HOOK_STATUS_REFRESH_MS = 2500
const getInitialWindowMode = (): WindowMode => {
  try {
    const windowMode = new URLSearchParams(window.location.search).get('windowMode')

    return windowMode === 'mini' || windowMode === 'popup-menu' || windowMode === 'exploration-result' ? windowMode : 'full'
  } catch {
    return 'full'
  }
}

const getInitialExplorationId = () => {
  try {
    return new URLSearchParams(window.location.search).get('explorationId') || ''
  } catch {
    return ''
  }
}

const codexStore = ref<CodexStore | null>(null)
const promptTemplates = ref<PromptTemplate[]>([])
const bookmarkItems = ref<FavoriteItem[]>([])
const explorations = ref<ExplorationRun[]>([])
const loading = ref(false)
const exporting = ref(false)
const importing = ref(false)
const languageMode = ref<LanguageMode>('auto')
const themeMode = ref<ThemeMode>('auto')
const miniOverDock = ref(true)
const showMiniTool = ref(true)
const showMiniPrompts = ref(true)
const hookStatus = ref<SidecarHookStatus | null>(null)
const mode = ref<WindowMode>(getInitialWindowMode())
const modeSwitching = ref(false)
const activePanel = ref<PanelKey>('threads')
const selectedThreadId = ref('')
const continuationThreadIds = ref<string[]>([])
const continuationConfirmOpen = ref(false)
const pendingContinuationThread = ref<ThreadSummary | null>(null)
const continuationResults = ref<Record<string, ThreadContinuationResult>>({})
const feedback = ref('')
const usageMode = ref<UsageDisplayMode>('used')
const navigationOpen = ref(false)
const navigationLoading = ref(false)
const navigationJumping = ref(false)
const navigationThreadId = ref('')
const navigationSearchTerm = ref('')
const navigationTurnPreviews = ref<ThreadTurnPreview[]>([])
const navigationError = ref('')
const popupMenu = ref<PopupMenuData | null>(null)
const explorationResultRun = ref<ExplorationRun | null>(null)
const explorationResultTab = ref<ExplorationResultTabKey>('summary')
const explorationResultLoading = ref(false)
const explorationResultError = ref('')
const navigationListRef = ref<HTMLElement | null>(null)
let refreshTimer: number | undefined
let hookStatusTimer: number | undefined
let explorationResultTimer: number | undefined
let feedbackTimer: number | undefined
let unsubscribeCodexStore: (() => void) | undefined
let unsubscribeExplorationsChanged: (() => void) | undefined
let unsubscribeSidecarDataChanged: (() => void) | undefined
let unsubscribeHookStatusChanged: (() => void) | undefined
let unsubscribeWindowMode: (() => void) | undefined
let unsubscribeSelectPanel: (() => void) | undefined
let unsubscribePopupMenuData: (() => void) | undefined
let systemThemeMediaQuery: MediaQueryList | undefined
let codexStoreRequestId = 0
let hookStatusRequestId = 0
let navigationRequestId = 0
let explorationResultRequestId = 0
let bookmarkMutationVersion = 0
const bookmarkMutationVersionByKey = new Map<string, number>()
const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')
const initialExplorationId = getInitialExplorationId()

const languageOptions = computed(() => [
  { value: 'auto' as const, label: t('settings.languageOptions.auto') },
  { value: 'en' as const, label: t('settings.languageOptions.en') },
  { value: 'zh' as const, label: t('settings.languageOptions.zh') }
])

const themeOptions = computed(() => [
  { value: 'auto' as const, label: t('settings.themeOptions.auto'), icon: 'i-proicons:dark-theme' },
  { value: 'light' as const, label: t('settings.themeOptions.light'), icon: 'i-lucide-sun' },
  { value: 'dark' as const, label: t('settings.themeOptions.dark'), icon: 'i-lucide-moon' }
])

const showHookSetup = computed(() => mode.value === 'full' && hookStatus.value !== null && !hookStatus.value.ready)

const hookSetupStatusText = computed(() => {
  const status = hookStatus.value

  if (!status || status.ready) {
    return ''
  }

  if (status.issue === 'untrusted') {
    return t('hookSetup.status.untrusted')
  }

  if (status.issue === 'disabled') {
    return t('hookSetup.status.disabled')
  }

  return t('hookSetup.status.missing')
})

const hookSetupSteps = computed(() => [
  { index: 1, label: t('hookSetup.steps.openSettings') },
  { index: 2, label: t('hookSetup.steps.openHooks') },
  { index: 3, label: t('hookSetup.steps.trustHooks') }
])

function getFavoriteKey(item: FavoriteItem) {
  return `${item.type}:${item.id}`
}

function getThreadFavoriteKey(threadId: string) {
  return `thread:${threadId}`
}

function getTurnBookmarkId(threadId: string, turnId: string) {
  return `${threadId}:${turnId}`
}

function getTurnFavoriteKey(threadId: string, turnId: string) {
  return `turn:${getTurnBookmarkId(threadId, turnId)}`
}

const favoriteItemsByKey = computed(() => new Map<string, FavoriteItem>(
  bookmarkItems.value.map(item => [getFavoriteKey(item), item] as const)
))

const isFavoriteActive = (key: string) => favoriteItemsByKey.value.has(key)

const threads = computed<ThreadSummary[]>(() => (codexStore.value?.threads || []).map(thread => ({
  ...thread,
  favorite: isFavoriteActive(getThreadFavoriteKey(thread.id))
})))
const selectedThread = computed(() => threads.value.find(thread => thread.id === selectedThreadId.value) || null)
const navigationThread = computed(() => threads.value.find(thread => thread.id === navigationThreadId.value) || null)
const turnBookmarks = computed(() => bookmarkItems.value.filter((item): item is TurnBookmark => item.type === 'turn'))
const getCurrentContinuationResult = (thread: ThreadSummary) => {
  const result = continuationResults.value[thread.id]

  if (!result || result.sourceUpdatedAt !== thread.updatedAt) {
    return null
  }

  return result
}
const pendingContinuationResult = computed(() => {
  const thread = pendingContinuationThread.value

  if (!thread) {
    return null
  }

  return getCurrentContinuationResult(threads.value.find(item => item.id === thread.id) || thread)
})
const continuationUnreadThreadIds = computed(() => threads.value
  .filter(thread => getCurrentContinuationResult(thread)?.unread)
  .map(thread => thread.id))

const counts = computed(() => ({
  completedUnread: threads.value.filter(thread => thread.sidecarStatus === 'completedUnread').length,
  running: threads.value.filter(thread => thread.sidecarStatus === 'running').length,
  waiting: threads.value.filter(thread => thread.sidecarStatus === 'waiting').length,
  failed: threads.value.filter(thread => thread.sidecarStatus === 'failed').length,
  contextRisk: threads.value.filter(thread => (thread.contextUsage?.percent || 0) >= 75).length,
  favorite: threads.value.filter(thread => thread.favorite).length,
  turnBookmark: turnBookmarks.value.length,
  all: threads.value.length
}))

const panels = computed<Array<{ key: PanelKey, label: string, icon: string }>>(() => [
  { key: 'threads', label: t('panels.threads'), icon: 'i-lucide-message-square-code' },
  { key: 'bookmarks', label: t('panels.bookmarks'), icon: 'i-lucide-bookmark' },
  { key: 'explorations', label: t('panels.explorations'), icon: 'i-lucide-sparkles' },
  { key: 'prompts', label: t('panels.prompts'), icon: 'i-lucide-pencil-sparkles' },
  { key: 'data', label: t('panels.settings'), icon: 'i-lucide-settings' }
])

const statusTiles = computed<Array<{ key: StatusTileKey, label: string, tooltip: string, count: number, tone: StatusTileTone }>>(() => [
  { key: 'running', label: t('status.running'), tooltip: t('status.runningTooltip'), count: counts.value.running, tone: 'running' },
  { key: 'waiting', label: t('status.waiting'), tooltip: t('status.waitingTooltip'), count: counts.value.waiting, tone: 'waiting' },
  { key: 'completedUnread', label: t('status.completedUnread'), tooltip: t('status.completedUnread'), count: counts.value.completedUnread, tone: 'completed' },
  { key: 'failed', label: t('status.failed'), tooltip: t('status.failedTooltip'), count: counts.value.failed, tone: 'failed' }
])

const formatStatusCount = (count: number) => count > 99 ? '99' : String(count)

const formatContinuationGeneratedAt = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return t('continuation.generatedAtUnknown')
  }

  return t('continuation.generatedAt', {
    time: formatResetDateTime(value, appLocale.value)
  })
}

const statusTileDotClass = (tone: StatusTileTone) => {
  if (tone === 'completed') {
    return 'bg-emerald-500'
  }

  if (tone === 'running') {
    return 'bg-sky-500'
  }

  if (tone === 'waiting') {
    return 'bg-amber-400'
  }

  return 'bg-red-500'
}

const isBreathingStatusTone = (tone: StatusTileTone) => tone === 'running' || tone === 'waiting'

const statusTilePingClass = (tone: StatusTileTone) => {
  if (tone === 'running') {
    return 'bg-sky-300'
  }

  if (tone === 'waiting') {
    return 'bg-amber-300'
  }

  return ''
}

const isExplorationFinal = (run: ExplorationRun) => run.status === 'completed' || run.status === 'partialFailed' || run.status === 'failed'

const usageWarning = computed(() => {
  const windows = [codexStore.value?.rateLimits?.primary, codexStore.value?.rateLimits?.secondary].filter(Boolean)
  const lowest = windows.reduce<number | null>((current, item) => {
    if (!item) {
      return current
    }

    return current == null ? item.remainingPercent : Math.min(current, item.remainingPercent)
  }, null)

  if (lowest == null || lowest > 20) {
    return null
  }

  if (lowest <= 10) {
    return {
      color: 'error' as const,
      title: t('usage.veryLowTitle'),
      description: t('usage.veryLowDescription')
    }
  }

  return {
    color: 'warning' as const,
    title: t('usage.lowTitle'),
    description: t('usage.lowDescription')
  }
})

const filteredNavigationTurnPreviews = computed(() => {
  const term = navigationSearchTerm.value.trim().toLowerCase()

  if (!term) {
    return navigationTurnPreviews.value
  }

  return navigationTurnPreviews.value.filter(turnPreview => [
    turnPreview.userPreview,
    turnPreview.assistantPreview
  ].some(value => value.toLowerCase().includes(term)))
})

const explorationResultTabs = computed<Array<{ key: ExplorationResultTabKey, label: string }>>(() => {
  const run = explorationResultRun.value

  if (!run) {
    return []
  }

  return [
    { key: 'summary', label: t('explorations.summary') },
    ...run.candidates.map(candidate => ({
      key: `candidate:${candidate.id}` as const,
      label: t('explorations.candidate', { index: candidate.index + 1 })
    }))
  ]
})

const selectedExplorationCandidate = computed<ExplorationCandidate | null>(() => {
  const run = explorationResultRun.value

  if (!run || !explorationResultTab.value.startsWith('candidate:')) {
    return null
  }

  const candidateId = explorationResultTab.value.slice('candidate:'.length)
  return run.candidates.find(candidate => candidate.id === candidateId) || null
})

const explorationResultSourceLabel = computed(() => {
  const run = explorationResultRun.value

  if (!run?.sourceThreadId) {
    return ''
  }

  return run.sourceThreadTitle || run.sourceThreadId
})

const explorationResultPromptText = computed(() => {
  const run = explorationResultRun.value

  if (!run) {
    return ''
  }

  const prompt = run.prompt.trim()

  if (prompt) {
    return prompt
  }

  if (run.images.length > 0) {
    return t('explorations.imageOnlyRequest', { count: run.images.length })
  }

  return t('explorations.emptyRequest')
})

const selectedExplorationResultText = computed(() => {
  const run = explorationResultRun.value

  if (!run) {
    return ''
  }

  if (explorationResultTab.value === 'summary') {
    return run.summary.output.trim()
  }

  const candidate = selectedExplorationCandidate.value

  if (!candidate) {
    return ''
  }

  return candidate.output.trim() || candidate.error || ''
})

const selectedExplorationAnalysisText = computed(() => {
  const run = explorationResultRun.value

  if (!run) {
    return ''
  }

  if (explorationResultTab.value === 'summary') {
    return run.summary.output.trim()
  }

  return selectedExplorationCandidate.value?.output.trim() || ''
})

const createContinuationPromptText = (summary: string, targetLocale: AppLocale) => {
  const normalizedSummary = summary.trim()

  if (!normalizedSummary) {
    return ''
  }

  if (targetLocale === 'zh') {
    return [
      '以下是从旧 Codex 对话生成的接续摘要。请把它作为本对话的初始上下文。你不能假设自己还能访问旧对话完整历史；如果需要确认事实，请读取当前仓库文件或让我提供证据。',
      '如果摘要中包含原线程 ID，它只作为追溯线索；不要依赖一定能按 ID 读取旧对话原文。',
      '后续回答语言请根据用户明确要求、原始问题、历史对话上下文和目标产物自动判断；不要根据本段接续说明的语言决定回答语言。',
      '',
      '<接续摘要>',
      normalizedSummary,
      '</接续摘要>',
      '',
      '请先完整理解以上接续摘要，把它作为当前对话上下文；如果本条消息没有新的明确任务，请等待我下一步指令。'
    ].join('\n')
  }

  return [
    'The following is a continuation summary generated from an earlier Codex conversation. Use it as the initial context for this conversation. Do not assume you can access the full previous conversation; if facts need to be confirmed, read the current repository files or ask me for evidence.',
    'If the summary includes an original thread ID, treat it only as a traceability hint. Do not rely on being able to read the old conversation by ID.',
    "Decide the response language from the user's explicit request, the original request, conversation context, and target artifact. Do not use the language of these continuation instructions as the response-language signal.",
    '',
    '<Continuation Summary>',
    normalizedSummary,
    '</Continuation Summary>',
    '',
    'First fully understand the continuation summary above and use it as the context for this conversation. If this message does not include a new explicit task, wait for my next instruction.'
  ].join('\n')
}

const selectedExplorationContinuationText = computed(() => {
  const run = explorationResultRun.value
  const analysis = selectedExplorationAnalysisText.value

  if (!run || !analysis) {
    return ''
  }

  const isZh = appLocale.value === 'zh'
  const prompt = run.prompt.trim() || (isZh ? '用户未输入文本，只上传了图片。' : 'The user did not enter text and only uploaded images.')
  const imageBlock = run.images.length > 0
    ? [
        '',
        isZh ? '<原始图片>' : '<Original Images>',
        isZh
          ? `本次任务包含 ${run.images.length} 张图片；如果继续工作需要图片内容，我会重新上传或补充说明。`
          : `This task included ${run.images.length} image(s). If continuing requires image content, I will upload them again or provide details.`,
        isZh ? '</原始图片>' : '</Original Images>'
      ].join('\n')
    : ''

  return [
    isZh ? '请基于下面内容继续工作。' : 'Please continue based on the content below.',
    '',
    isZh ? '<原始问题>' : '<Original Request>',
    prompt,
    isZh ? '</原始问题>' : '</Original Request>',
    imageBlock,
    '',
    isZh ? '<已有分析>' : '<Existing Analysis>',
    analysis,
    isZh ? '</已有分析>' : '</Existing Analysis>',
    '',
    isZh
      ? '后续回答语言请根据用户明确要求、原始问题、历史对话上下文和目标产物自动判断；不要根据本段接续说明的语言决定回答语言。'
      : "Decide the response language from the user's explicit request, the original request, conversation context, and target artifact. Do not use the language of these continuation instructions as the response-language signal.",
    '',
    isZh
      ? '这段已有分析仅供参考；后续以原始问题、当前仓库事实和我补充的信息为准。请先确认你理解当前任务状态，然后等待我的下一步指令。'
      : 'Use the existing analysis as reference only. For next steps, rely on the original request, current repository facts, and any additional information I provide. First confirm that you understand the current task state, then wait for my next instruction.'
  ].filter(Boolean).join('\n')
})

const selectedExplorationResultEmptyText = computed(() => {
  if (explorationResultTab.value === 'summary') {
    return explorationResultRun.value?.summary.error || t('explorations.resultPending')
  }

  const candidate = selectedExplorationCandidate.value
  return candidate?.error || t('explorations.resultPending')
})

const toggleUsageMode = () => {
  usageMode.value = usageMode.value === 'used' ? 'remaining' : 'used'
}

const getThreadsByStatus = (status: StatusTileKey) => {
  return threads.value.filter(thread => thread.sidecarStatus === status)
}

const getMenuPopupPoint = (event?: MouseEvent): PopupMenuShowOptions['point'] => {
  if (!event) {
    return undefined
  }

  return {
    screenX: Math.round(event.screenX),
    screenY: Math.round(event.screenY)
  }
}

const handleStatusTileClick = async (status: StatusTileKey, event?: MouseEvent) => {
  const matchedThreads = getThreadsByStatus(status)

  if (matchedThreads.length === 0) {
    return
  }

  if (matchedThreads.length === 1) {
    await openThread(matchedThreads[0])
    return
  }

  try {
    const result = await window.sidecar.showPopupMenu({
      items: matchedThreads.map(thread => ({
        id: thread.id,
        label: thread.title || thread.codexTitle || t('common.unnamedThread')
      })),
      point: getMenuPopupPoint(event)
    })
    const selectedThread = matchedThreads.find(thread => thread.id === result.selectedId)

    if (selectedThread) {
      await openThread(selectedThread)
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const getPromptMenuDescription = (template: PromptTemplate) => {
  return template.body.replace(/\s+/g, ' ').trim()
}

const handleMiniPromptsClick = async (event?: MouseEvent) => {
  if (promptTemplates.value.length === 0) {
    await setMode('full', { activePanel: 'prompts' })
    return
  }

  try {
    const result = await window.sidecar.showPopupMenu({
      items: promptTemplates.value.map(template => ({
        id: template.id,
        label: template.name || t('common.unnamedPrompt'),
        description: getPromptMenuDescription(template)
      })),
      point: getMenuPopupPoint(event),
      width: 340
    })
    const selectedTemplate = promptTemplates.value.find(template => template.id === result.selectedId)

    if (selectedTemplate) {
      await window.sidecar.copyText(selectedTemplate.body)
      setFeedback(t('feedback.copied'))
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const copyCurrentExplorationResult = async () => {
  const text = selectedExplorationResultText.value

  if (!text) {
    return
  }

  try {
    await window.sidecar.copyText(text)
    setFeedback(t('feedback.copied'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const copyCurrentExplorationContinuation = async () => {
  const text = selectedExplorationContinuationText.value

  if (!text) {
    return
  }

  try {
    await window.sidecar.copyText(text)
    setFeedback(t('feedback.copied'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const copyLastContinuation = async () => {
  const result = pendingContinuationResult.value

  if (!result) {
    return
  }

  try {
    await window.sidecar.copyText(createContinuationPromptText(result.summary, appLocale.value))
    setFeedback(t('feedback.copied'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const loadExplorationResult = async () => {
  if (!initialExplorationId) {
    explorationResultError.value = t('explorations.missingResult')
    return
  }

  const requestId = ++explorationResultRequestId
  explorationResultLoading.value = true
  explorationResultError.value = ''

  try {
    const run = await window.sidecar.getExplorationRun(initialExplorationId)

    if (requestId !== explorationResultRequestId) {
      return
    }

    explorationResultRun.value = run

    if (!run) {
      explorationResultError.value = t('explorations.missingResult')
      return
    }

    if (isExplorationFinal(run) && explorationResultTimer) {
      window.clearInterval(explorationResultTimer)
      explorationResultTimer = undefined
    }

    const tabKeys = new Set(explorationResultTabs.value.map(tab => tab.key))

    if (!tabKeys.has(explorationResultTab.value)) {
      explorationResultTab.value = 'summary'
    }
  } catch (error) {
    if (requestId === explorationResultRequestId) {
      explorationResultError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (requestId === explorationResultRequestId) {
      explorationResultLoading.value = false
    }
  }
}

const setFeedback = (message: string) => {
  feedback.value = message

  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }

  feedbackTimer = window.setTimeout(() => {
    feedback.value = ''
  }, 2600)
}

const shouldPollHookStatus = () => mode.value === 'full' && hookStatus.value !== null && !hookStatus.value.ready

const stopHookStatusPolling = () => {
  if (hookStatusTimer) {
    window.clearInterval(hookStatusTimer)
    hookStatusTimer = undefined
  }
}

const syncHookStatusPolling = () => {
  if (!shouldPollHookStatus()) {
    stopHookStatusPolling()
    return
  }

  if (!hookStatusTimer) {
    hookStatusTimer = window.setInterval(() => {
      void loadHookStatus()
    }, HOOK_STATUS_REFRESH_MS)
  }
}

const applyHookStatus = (nextHookStatus: SidecarHookStatus) => {
  hookStatus.value = nextHookStatus
  syncHookStatusPolling()
}

const loadHookStatus = async (options?: { refresh?: boolean }) => {
  const requestId = ++hookStatusRequestId

  try {
    const nextHookStatus = await window.sidecar.getHookStatus(options)

    if (requestId === hookStatusRequestId) {
      applyHookStatus(nextHookStatus)
    }
  } catch (error) {
    if (requestId === hookStatusRequestId) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  }
}

const openCodexSettings = async () => {
  try {
    await window.sidecar.openCodexSettings()
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const handleWindowFocus = () => {
  if (shouldPollHookStatus()) {
    void loadHookStatus()
  }
}

const applyCodexStore = (nextCodexStore: CodexStore) => {
  codexStore.value = nextCodexStore
}

const refreshCodexStore = async () => {
  const requestId = ++codexStoreRequestId
  loading.value = true

  try {
    const nextCodexStore = await window.sidecar.getCodexStore()

    if (requestId === codexStoreRequestId) {
      applyCodexStore(nextCodexStore)
    }
  } catch (error) {
    if (requestId === codexStoreRequestId) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (requestId === codexStoreRequestId) {
      loading.value = false
    }
  }
}

const setMode = async (nextMode: WindowMode, options?: { activePanel?: PanelKey }) => {
  if (mode.value === nextMode || modeSwitching.value) {
    return
  }

  modeSwitching.value = true
  await nextTick()

  try {
    await window.sidecar.setWindowMode(nextMode, options)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    modeSwitching.value = false
  }
}

const showMainWindow = async () => {
  try {
    await window.sidecar.showMainWindow()
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const getFavoriteItem = (key: string) => favoriteItemsByKey.value.get(key) || null

const createThreadFavorite = (thread: ThreadSummary): FavoriteItem => ({
  type: 'thread',
  id: thread.id,
  threadId: thread.id,
  createdAt: Date.now()
})

const toPlainFavoriteItem = (item: FavoriteItem): FavoriteItem => {
  if (item.type === 'thread') {
    return {
      type: 'thread',
      id: item.id,
      threadId: item.threadId,
      createdAt: item.createdAt
    }
  }

  return {
    type: 'turn',
    id: item.id,
    threadId: item.threadId,
    turnId: item.turnId,
    userItemId: item.userItemId,
    userPreview: item.userPreview,
    userSearchText: item.userSearchText,
    assistantItemId: item.assistantItemId,
    assistantPreview: item.assistantPreview,
    turnCreatedAt: item.turnCreatedAt,
    createdAt: item.createdAt,
    threadTitle: item.threadTitle,
    codexTitle: item.codexTitle,
    cwd: item.cwd,
    projectName: item.projectName
  }
}

const patchLocalFavoriteItem = (item: FavoriteItem, favorite: boolean) => {
  const key = getFavoriteKey(item)
  const remainingItems = bookmarkItems.value.filter(candidate => getFavoriteKey(candidate) !== key)

  bookmarkItems.value = favorite
    ? [item, ...remainingItems].sort((a, b) => b.createdAt - a.createdAt)
    : remainingItems
}

const applyLanguageMode = (nextLanguageMode: LanguageMode) => {
  languageMode.value = nextLanguageMode
  applyI18nLanguageMode(nextLanguageMode)
}

const getSystemThemeMode = (): Exclude<ThemeMode, 'auto'> => {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const resolveThemeMode = (nextThemeMode: ThemeMode): Exclude<ThemeMode, 'auto'> => {
  return nextThemeMode === 'auto' ? getSystemThemeMode() : nextThemeMode
}

const applyDocumentThemeMode = (nextThemeMode: ThemeMode) => {
  if (typeof document === 'undefined') {
    return
  }

  const resolvedThemeMode = resolveThemeMode(nextThemeMode)

  document.documentElement.classList.toggle('dark', resolvedThemeMode === 'dark')
  document.documentElement.style.colorScheme = resolvedThemeMode
}

const applyThemeMode = (nextThemeMode: ThemeMode) => {
  themeMode.value = nextThemeMode
  applyDocumentThemeMode(nextThemeMode)
}

const applyMiniOverDock = (nextMiniOverDock: boolean) => {
  miniOverDock.value = nextMiniOverDock
}

const applyShowMiniTool = (nextShowMiniTool: boolean) => {
  showMiniTool.value = nextShowMiniTool
}

const applyShowMiniPrompts = (nextShowMiniPrompts: boolean) => {
  showMiniPrompts.value = nextShowMiniPrompts
}

const applyPopupMenuData = (data: PopupMenuData) => {
  popupMenu.value = data
  languageMode.value = data.languageMode
  applyI18nLanguageMode(data.languageMode)
  themeMode.value = data.themeMode
  applyDocumentThemeMode(data.themeMode)
}

const selectPopupMenuItem = async (itemId: string) => {
  try {
    await window.sidecar.selectPopupMenuItem(itemId)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const closePopupMenu = async () => {
  try {
    await window.sidecar.closePopupMenu()
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const applySidecarData = (data: SidecarData) => {
  applyLanguageMode(data.settings.languageMode)
  applyThemeMode(data.settings.themeMode)
  applyMiniOverDock(data.settings.miniOverDock)
  applyShowMiniTool(data.settings.showMiniTool)
  applyShowMiniPrompts(data.settings.showMiniPrompts)
  promptTemplates.value = data.promptTemplates
  continuationResults.value = data.continuationResults || {}

  bookmarkItems.value = data.favorites
    .map(item => toPlainFavoriteItem(item))
    .sort((a, b) => b.createdAt - a.createdAt)
}

const loadSidecarData = async () => {
  applySidecarData(await window.sidecar.getSidecarData())
}

const applyExplorations = (nextExplorations: ExplorationRun[]) => {
  explorations.value = nextExplorations
}

const handleExplorationCreated = (run: ExplorationRun) => {
  explorations.value = [run, ...explorations.value.filter(item => item.id !== run.id)]
  activePanel.value = 'explorations'
}

const loadExplorations = async () => {
  applyExplorations(await window.sidecar.getExplorations())
}

const saveFavoriteItem = async (item: FavoriteItem, favorite: boolean) => {
  const plainItem = toPlainFavoriteItem(item)
  const key = getFavoriteKey(plainItem)
  const previousItem = favoriteItemsByKey.value.get(key) || null
  const version = ++bookmarkMutationVersion

  bookmarkMutationVersionByKey.set(key, version)
  patchLocalFavoriteItem(plainItem, favorite)

  try {
    await window.sidecar.setFavorite(plainItem, favorite)
  } catch (error) {
    if (bookmarkMutationVersionByKey.get(key) === version) {
      patchLocalFavoriteItem(previousItem ? toPlainFavoriteItem(previousItem) : plainItem, Boolean(previousItem))
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (bookmarkMutationVersionByKey.get(key) === version) {
      bookmarkMutationVersionByKey.delete(key)
    }
  }
}

const toggleFavorite = async (thread: ThreadSummary) => {
  const key = getThreadFavoriteKey(thread.id)
  const favorite = !isFavoriteActive(key)

  await saveFavoriteItem(getFavoriteItem(key) || createThreadFavorite(thread), favorite)
}

const createTurnBookmark = (thread: ThreadSummary, turnPreview: ThreadTurnPreview): TurnBookmark => ({
  type: 'turn',
  id: getTurnBookmarkId(thread.id, turnPreview.turnId),
  threadId: thread.id,
  turnId: turnPreview.turnId,
  userItemId: turnPreview.userItemId,
  userPreview: turnPreview.userPreview,
  userSearchText: turnPreview.userSearchText,
  assistantItemId: turnPreview.assistantItemId,
  assistantPreview: turnPreview.assistantPreview,
  turnCreatedAt: turnPreview.createdAt,
  createdAt: Date.now(),
  threadTitle: thread.title,
  codexTitle: thread.codexTitle,
  cwd: thread.cwd,
  projectName: thread.projectName
})

const isNavigationTurnBookmarked = (turnPreview: ThreadTurnPreview) => {
  return Boolean(navigationThreadId.value && isFavoriteActive(getTurnFavoriteKey(navigationThreadId.value, turnPreview.turnId)))
}

const toggleNavigationTurnBookmark = async (turnPreview: ThreadTurnPreview) => {
  const thread = navigationThread.value

  if (!thread) {
    setFeedback(t('feedback.turnBookmarkThreadMissing'))
    return
  }

  const key = getTurnFavoriteKey(thread.id, turnPreview.turnId)
  const favorite = !isFavoriteActive(key)

  await saveFavoriteItem((getFavoriteItem(key) as TurnBookmark | null) || createTurnBookmark(thread, turnPreview), favorite)
}

const removeTurnBookmark = async (bookmark: TurnBookmark) => {
  await saveFavoriteItem(bookmark, false)
}

const openTurnBookmark = async (bookmark: TurnBookmark) => {
  try {
    await window.sidecar.openThread(bookmark.threadId)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const openThreadById = async (threadId: string) => {
  selectedThreadId.value = threadId

  try {
    await window.sidecar.openThread(threadId)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const openThread = async (thread: ThreadSummary) => {
  await openThreadById(thread.id)
}

const openContinuationConfirm = (thread: ThreadSummary) => {
  if (continuationThreadIds.value.includes(thread.id)) {
    return
  }

  selectedThreadId.value = thread.id
  pendingContinuationThread.value = thread
  const result = getCurrentContinuationResult(thread)

  if (result?.unread) {
    continuationResults.value = {
      ...continuationResults.value,
      [thread.id]: {
        ...result,
        unread: false
      }
    }
    void window.sidecar.setContinuationResultUnread(thread.id, false).catch(error => {
      setFeedback(error instanceof Error ? error.message : String(error))
    })
  }

  continuationConfirmOpen.value = true
}

const closeContinuationConfirm = () => {
  continuationConfirmOpen.value = false
  pendingContinuationThread.value = null
}

const handleContinuationConfirmOpenChange = (open: boolean) => {
  if (open) {
    continuationConfirmOpen.value = true
    return
  }

  closeContinuationConfirm()
}

const confirmContinueThreadWithSummary = async () => {
  const thread = pendingContinuationThread.value

  if (!thread || continuationThreadIds.value.includes(thread.id)) {
    return
  }

  selectedThreadId.value = thread.id
  continuationThreadIds.value = [...continuationThreadIds.value, thread.id]
  continuationConfirmOpen.value = false
  pendingContinuationThread.value = null

  try {
    const result = await window.sidecar.continueThreadWithSummary(thread.id, thread.cwd, thread.updatedAt)
    const continuationResult: ThreadContinuationResult = {
      threadId: result.threadId,
      sourceUpdatedAt: result.sourceUpdatedAt,
      summary: result.summary,
      prompt: result.prompt,
      completedAt: result.completedAt,
      unread: result.unread
    }
    continuationResults.value = {
      ...continuationResults.value,
      [thread.id]: continuationResult
    }
    setFeedback(t('feedback.summaryOpened'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    continuationThreadIds.value = continuationThreadIds.value.filter(threadId => threadId !== thread.id)
  }
}

const closeNavigation = () => {
  navigationRequestId += 1
  navigationOpen.value = false
  navigationLoading.value = false
  navigationJumping.value = false
  navigationError.value = ''
}

const handleNavigationOpenChange = (open: boolean) => {
  if (open) {
    navigationOpen.value = true
    return
  }

  closeNavigation()
}

const scrollNavigationListToBottom = async () => {
  await nextTick()

  const element = navigationListRef.value

  if (element) {
    element.scrollTop = element.scrollHeight
  }
}

const loadNavigationTurnPreviews = async (thread: ThreadSummary) => {
  const requestId = ++navigationRequestId
  navigationLoading.value = true
  navigationError.value = ''
  navigationTurnPreviews.value = []
  let shouldScrollToBottom = false

  try {
    const result = await window.sidecar.getThreadTurnPreviews(thread.id)

    if (requestId === navigationRequestId && navigationThreadId.value === thread.id) {
      navigationTurnPreviews.value = result.turnPreviews
      shouldScrollToBottom = true
    }
  } catch (error) {
    if (requestId === navigationRequestId) {
      navigationError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (requestId === navigationRequestId) {
      navigationLoading.value = false

      if (shouldScrollToBottom) {
        await scrollNavigationListToBottom()
      }
    }
  }
}

const openThreadNavigation = async (thread: ThreadSummary) => {
  selectedThreadId.value = thread.id
  navigationThreadId.value = thread.id
  navigationSearchTerm.value = ''
  navigationOpen.value = true

  await loadNavigationTurnPreviews(thread)
}

const openNavigationThread = async () => {
  const threadId = navigationThreadId.value

  if (!threadId || navigationJumping.value) {
    return
  }

  navigationJumping.value = true

  try {
    await window.sidecar.openThread(threadId)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    navigationJumping.value = false
  }
}

const savePromptTemplates = async (templates: PromptTemplate[]) => {
  promptTemplates.value = await window.sidecar.savePromptTemplates(templates)
}

const exportData = async () => {
  if (exporting.value) {
    return
  }

  exporting.value = true

  try {
    const result = await window.sidecar.exportData()

    if (!result.canceled) {
      setFeedback(t('feedback.exported'))
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    exporting.value = false
  }
}

const importData = async () => {
  if (importing.value) {
    return
  }

  importing.value = true

  try {
    const result = await window.sidecar.importData()

    if (!result.canceled) {
      await loadSidecarData()
      await loadExplorations()
      await refreshCodexStore()
      setFeedback(t('feedback.imported'))
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    importing.value = false
  }
}

const handleSystemThemeChange = () => {
  if (themeMode.value === 'auto') {
    applyDocumentThemeMode('auto')
  }
}

applyDocumentThemeMode(themeMode.value)

onMounted(async () => {
  systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange)
  window.addEventListener('focus', handleWindowFocus)
  unsubscribeWindowMode = window.sidecar.onWindowMode(nextMode => {
    mode.value = nextMode
    modeSwitching.value = false
    syncHookStatusPolling()
  })
  unsubscribeSelectPanel = window.sidecar.onSelectPanel(nextPanel => {
    activePanel.value = nextPanel
  })

  try {
    mode.value = await window.sidecar.getWindowMode()
  } catch {
    mode.value = getInitialWindowMode()
  }

  unsubscribeSidecarDataChanged = window.sidecar.onSidecarDataChanged(applySidecarData)

  if (mode.value === 'popup-menu') {
    unsubscribePopupMenuData = window.sidecar.onPopupMenuData(applyPopupMenuData)

    try {
      const data = await window.sidecar.getPopupMenuData()

      if (data) {
        applyPopupMenuData(data)
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }

    return
  }

  try {
    await loadSidecarData()
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }

  if (mode.value === 'exploration-result') {
    await loadExplorationResult()
    explorationResultTimer = window.setInterval(loadExplorationResult, 2500)
    return
  }

  unsubscribeHookStatusChanged = window.sidecar.onHookStatusChanged(applyHookStatus)
  await loadHookStatus({ refresh: false })

  try {
    await loadExplorations()
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }

  unsubscribeCodexStore = window.sidecar.onCodexStore(applyCodexStore)
  unsubscribeExplorationsChanged = window.sidecar.onExplorationsChanged(applyExplorations)
  await refreshCodexStore()
  refreshTimer = window.setInterval(refreshCodexStore, 5000)
})

onBeforeUnmount(() => {
  unsubscribeCodexStore?.()
  unsubscribeExplorationsChanged?.()
  unsubscribeSidecarDataChanged?.()
  unsubscribeHookStatusChanged?.()
  unsubscribeWindowMode?.()
  unsubscribeSelectPanel?.()
  unsubscribePopupMenuData?.()
  systemThemeMediaQuery?.removeEventListener('change', handleSystemThemeChange)
  window.removeEventListener('focus', handleWindowFocus)

  if (refreshTimer) {
    window.clearInterval(refreshTimer)
  }

  stopHookStatusPolling()

  if (explorationResultTimer) {
    window.clearInterval(explorationResultTimer)
  }

  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }
})
</script>
