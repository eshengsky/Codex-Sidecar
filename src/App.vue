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
      :rate-limits="snapshot?.rateLimits || null"
      :prompt-templates="snapshot?.sidecarData.promptTemplates || []"
      :show-prompts="showMiniPrompts"
      :usage-mode="usageMode"
      :class="modeSwitching ? 'opacity-0 pointer-events-none' : ''"
      @expand="setMode('full')"
      @prompts-click="handleMiniPromptsClick"
      @status-click="handleStatusTileClick"
      @toggle-mode="toggleUsageMode"
    />

    <div
      v-else
      class="flex h-full w-full flex-col overflow-hidden bg-white text-gray-900 dark:bg-neutral-950 dark:text-gray-100"
      :class="modeSwitching ? 'opacity-0 pointer-events-none' : ''"
    >
      <header class="flex h-9 min-w-0 flex-none items-center justify-end px-2.5 [-webkit-app-region:drag]">
        <UTooltip :text="t('app.miniMode')">
          <UButton icon="i-lucide-minimize-2" color="neutral" variant="ghost" size="xs" square class="[-webkit-app-region:no-drag]" @click="setMode('mini')" />
        </UTooltip>
      </header>

      <main class="relative flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden px-2.5 pb-2.5">
      <section v-if="snapshot?.error || usageWarning" class="flex min-w-0 flex-col">
        <UAlert
          v-if="snapshot?.error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="t('app.dataReadFailed')"
          :description="snapshot.error"
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
                activePanel === 'threads' && activeFilter === tile.key ? 'bg-elevated' : '',
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

      <section v-if="snapshot?.rateLimits?.primary || snapshot?.rateLimits?.secondary" class="flex min-w-0 gap-2">
        <UsageMeter v-if="snapshot?.rateLimits?.primary" :window="snapshot.rateLimits.primary" :mode="usageMode" class="min-w-0 flex-1 basis-0" @toggle-mode="toggleUsageMode" />
        <UsageMeter v-if="snapshot?.rateLimits?.secondary" :window="snapshot.rateLimits.secondary" :mode="usageMode" class="min-w-0 flex-1 basis-0" @toggle-mode="toggleUsageMode" />
      </section>

      <section v-if="activePanel === 'threads'" class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
        <div class="flex min-w-0 flex-col gap-2">
          <UInput v-model="searchTerm" icon="i-lucide-search" :placeholder="t('threads.search')" size="sm" color="neutral" />

          <div class="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
            <UButton
              v-for="filter in visibleFilters"
              :key="filter.key"
              type="button"
              color="neutral"
              :variant="activeFilter === filter.key ? 'subtle' : 'soft'"
              size="sm"
              class="flex-none"
              @click="activeFilter = filter.key"
            >
              <span>{{ filter.label }}</span>
              <span class="text-current">{{ filter.count }}</span>
            </UButton>
          </div>
        </div>

        <div class="flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-2.5 -mr-2.5 pb-2">
          <div v-if="loading && !snapshot" class="flex flex-col gap-2">
            <USkeleton v-for="index in 7" :key="index" class="h-[104px] rounded-lg" />
          </div>

          <UEmpty
            v-else-if="filteredThreads.length === 0"
            :title="t('threads.emptyTitle')"
            :description="t('threads.emptyDescription')"
            variant="naked"
            size="xs"
            class="min-h-[220px] self-center"
          />

          <template v-else>
            <ThreadRow
              v-for="thread in filteredThreads"
              :key="thread.id"
              :thread="thread"
              :selected="thread.id === selectedThreadId"
              :continuing="continuationThreadId === thread.id"
              :continue-disabled="Boolean(continuationThreadId) && continuationThreadId !== thread.id"
              @open="openThread"
              @toggle-favorite="toggleFavorite"
              @open-navigation="openThreadNavigation"
              @continue-thread="openContinuationConfirm"
            />
          </template>
        </div>
      </section>

      <section v-else-if="activePanel === 'bookmarks'" class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
        <div class="flex min-w-0 flex-col gap-2">
          <div class="flex gap-1 rounded-lg bg-neutral-200/70 p-0.5 dark:bg-neutral-800" role="tablist" :aria-label="t('bookmarks.typeLabel')">
            <button
              v-for="tab in bookmarkTabs"
              :key="tab.key"
              type="button"
              class="inline-flex h-7 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-[7px] border-0 px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
              :class="bookmarkTab === tab.key ? 'bg-white text-gray-950 dark:bg-neutral-700 dark:text-white' : 'bg-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
              role="tab"
              :aria-selected="bookmarkTab === tab.key"
              @click="bookmarkTab = tab.key"
            >
              <span>{{ tab.label }}</span>
              <span class="text-current">{{ tab.count }}</span>
            </button>
          </div>

          <UInput v-model="bookmarkSearchTerm" icon="i-lucide-search" :placeholder="bookmarkSearchPlaceholder" size="sm" color="neutral" />
        </div>

        <div class="flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-2.5 -mr-2.5 pb-2">
          <template v-if="bookmarkTab === 'conversations'">
            <UEmpty
              v-if="filteredBookmarkedThreads.length === 0"
              :title="t('bookmarks.emptyConversationsTitle')"
              :description="t('bookmarks.emptyConversationsDescription')"
              variant="naked"
              size="xs"
              class="min-h-[220px] self-center"
            />

            <template v-else>
              <ThreadRow
                v-for="thread in filteredBookmarkedThreads"
                :key="thread.id"
                :thread="thread"
                :selected="thread.id === selectedThreadId"
                :continuing="continuationThreadId === thread.id"
                :continue-disabled="Boolean(continuationThreadId) && continuationThreadId !== thread.id"
                @open="openThread"
                @toggle-favorite="toggleFavorite"
                @open-navigation="openThreadNavigation"
                @continue-thread="openContinuationConfirm"
              />
            </template>
          </template>

          <template v-else>
            <UEmpty
              v-if="filteredMessageBookmarks.length === 0"
              :title="t('bookmarks.emptyMessagesTitle')"
              :description="t('bookmarks.emptyMessagesDescription')"
              variant="naked"
              size="xs"
              class="min-h-[220px] self-center"
            />

            <template v-else>
              <article
                v-for="bookmark in filteredMessageBookmarks"
                :key="bookmark.id"
                class="flex min-w-0 flex-col gap-1.5 rounded-[9px] border border-gray-100 bg-white p-2.5 text-gray-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-100"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <h3 class="m-0 min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[1.25] font-[760] text-gray-900 dark:text-gray-100">
                    {{ getBookmarkThreadTitle(bookmark) }}
                  </h3>
                  <UTooltip :text="t('bookmarks.remove')">
                    <UButton
                      icon="i-lucide-bookmark-x"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      square
                      @click="removeMessageBookmark(bookmark)"
                    />
                  </UTooltip>
                </div>

                <button
                  type="button"
                  class="flex rounded-lg border-0 bg-gray-50 px-2.5 py-2 text-left text-[13px] leading-[1.45] text-gray-900 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700"
                  @click="openMessageBookmark(bookmark)"
                >
                  <span class="line-clamp-3 [overflow-wrap:anywhere]">{{ bookmark.preview }}</span>
                </button>

                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.2] text-gray-500 dark:text-gray-400">{{ getBookmarkProjectName(bookmark) }}</span>
                  <span class="text-[11px] leading-none whitespace-nowrap text-gray-500 dark:text-gray-400">{{ formatNavigationMessageTime(bookmark.createdAt, appLocale) }}</span>
                </div>
              </article>
            </template>
          </template>
        </div>
      </section>

      <section v-else-if="activePanel === 'prompts'" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PromptManager
          :templates="snapshot?.sidecarData.promptTemplates || []"
          class="min-h-0 flex-1"
          @save="savePromptTemplates"
          @copied="setFeedback(t('feedback.copied'))"
          @failed="setFeedback"
        />
      </section>

      <section v-else class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-auto pb-2">
        <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-white p-2.5 text-gray-900 dark:bg-neutral-900 dark:text-gray-100">
          <div class="min-w-0 flex-1 basis-0">
            <h3 class="m-0 text-[13px]">{{ t('settings.language') }}</h3>
          </div>
          <USelect
            :model-value="languageMode"
            :items="languageOptions"
            value-key="value"
            label-key="label"
            color="neutral"
            variant="outline"
            size="sm"
            class="w-[100px] flex-none"
            :aria-label="t('settings.language')"
            :disabled="languageSaving"
            @update:model-value="saveLanguageMode"
          />
        </article>

        <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-white p-2.5 text-gray-900 dark:bg-neutral-900 dark:text-gray-100">
          <div class="min-w-0 flex-1 basis-0">
            <h3 class="m-0 text-[13px]">{{ t('settings.theme') }}</h3>
          </div>
          <div
            ref="themeControlRef"
            class="flex flex-none rounded-lg bg-neutral-200/70 p-0.5 dark:bg-neutral-800"
            role="radiogroup"
            :aria-label="t('settings.theme')"
          >
            <UTooltip
              v-for="option in themeOptions"
              :key="option.value"
              :text="option.label"
            >
              <button
                type="button"
                class="inline-flex h-6 w-9 items-center justify-center rounded-[7px] border-0 bg-transparent text-gray-500 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 disabled:cursor-default disabled:opacity-60 dark:text-gray-400"
                :class="themeMode === option.value ? 'bg-white text-gray-950 shadow-sm dark:bg-neutral-700 dark:text-white' : 'hover:text-gray-900 dark:hover:text-gray-100'"
                role="radio"
                :aria-checked="themeMode === option.value"
                :aria-label="option.label"
                :disabled="themeSaving"
                @click="saveThemeMode(option.value, $event)"
              >
                <UIcon :name="option.icon" class="h-4 w-4" />
              </button>
            </UTooltip>
          </div>
        </article>

        <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-white p-2.5 text-gray-900 dark:bg-neutral-900 dark:text-gray-100">
          <div class="min-w-0 flex-1 basis-0">
            <h3 class="m-0 text-[13px]">{{ t('settings.miniOverDock') }}</h3>
          </div>
          <USwitch
            :model-value="miniOverDock"
            color="neutral"
            :disabled="miniOverDockSaving"
            :aria-label="t('settings.miniOverDock')"
            @update:model-value="saveMiniOverDock"
          />
        </article>

        <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-white p-2.5 text-gray-900 dark:bg-neutral-900 dark:text-gray-100">
          <div class="min-w-0 flex-1 basis-0">
            <h3 class="m-0 text-[13px]">{{ t('settings.showMiniPrompts') }}</h3>
          </div>
          <USwitch
            :model-value="showMiniPrompts"
            color="neutral"
            :disabled="showMiniPromptsSaving"
            :aria-label="t('settings.showMiniPrompts')"
            @update:model-value="saveShowMiniPrompts"
          />
        </article>

        <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-white p-2.5 text-gray-900 dark:bg-neutral-900 dark:text-gray-100">
          <div class="min-w-0 flex-1 basis-0">
            <h3 class="m-0 text-[13px]">{{ t('settings.data') }}</h3>
          </div>
          <div class="flex flex-none gap-1.5">
            <UButton color="neutral" variant="soft" size="sm" class="justify-center" :loading="exporting" :disabled="importing" @click="exportData">
              {{ t('common.export') }}
            </UButton>
            <UButton color="neutral" variant="outline" size="sm" class="justify-center" :loading="importing" :disabled="exporting" @click="importData">
              {{ t('common.import') }}
            </UButton>
          </div>
        </article>
      </section>

      <nav class="-mx-3 -mb-3 mt-[-8px] flex min-w-0 flex-none gap-1 border-t border-gray-100 px-3 pt-1 pb-1 dark:border-neutral-800 dark:bg-neutral-950/95 max-[410px]:-mx-2.5 max-[410px]:-mb-2.5 max-[410px]:px-2.5" :aria-label="t('panels.ariaLabel')">
        <button
          v-for="panel in panels"
          :key="panel.key"
          type="button"
          class="flex h-[46px] min-w-0 flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-0 px-1.5 text-[11px] leading-none font-[680] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          :class="activePanel === panel.key ? 'bg-neutral-50 text-gray-950 dark:bg-neutral-900 dark:text-white' : 'bg-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
          :aria-current="activePanel === panel.key ? 'page' : undefined"
          @click="activePanel = panel.key"
        >
          <UIcon :name="panel.icon" class="h-[17px] w-[17px] flex-none" />
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
            <UAlert
              v-if="navigationAccessibilityGranted === false"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="t('navigation.accessibilityTitle')"
              :description="navigationAccessibilityDescription"
            />

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
                v-else-if="filteredNavigationMessages.length === 0"
                :title="t('navigation.empty')"
                variant="naked"
                size="xs"
                class="self-center p-0 sm:p-0 lg:p-0"
                :ui="{ root: 'p-0 sm:p-0 lg:p-0 gap-1', header: 'gap-1' }"
              />

              <div
                v-for="message in filteredNavigationMessages"
                :key="message.id"
                class="flex flex-col items-end gap-1 self-end"
              >
                <span class="self-end text-[10px] leading-none whitespace-nowrap text-gray-500 dark:text-gray-400">{{ formatNavigationMessageTime(message.createdAt, appLocale) }}</span>
                <div class="flex items-start justify-end gap-1.5">
                  <UTooltip :text="isNavigationMessageBookmarked(message) ? t('bookmarks.remove') : t('bookmarks.add')">
                    <UButton
                      icon="i-lucide-bookmark"
                      :color="isNavigationMessageBookmarked(message) ? 'warning' : 'neutral'"
                      :variant="isNavigationMessageBookmarked(message) ? 'soft' : 'ghost'"
                      size="xs"
                      square
                      @click="toggleNavigationMessageBookmark(message)"
                    />
                  </UTooltip>
                  <button
                    type="button"
                    class="flex min-w-0 rounded-xl border-0 bg-gray-100 px-3 py-2 text-left text-[13px] leading-[1.45] text-gray-900 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700"
                    :class="navigationJumping ? 'cursor-wait opacity-60' : 'cursor-pointer'"
                    :disabled="navigationJumping"
                    @click="jumpToUserMessage(message)"
                  >
                    <span class="line-clamp-2 [overflow-wrap:anywhere]">{{ message.preview }}</span>
                  </button>
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
          <div class="flex w-full flex-wrap justify-end gap-1.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="Boolean(continuationThreadId)"
              @click="closeContinuationConfirm"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="neutral"
              size="sm"
              :loading="Boolean(continuationThreadId)"
              :disabled="!pendingContinuationThread"
              @click="confirmContinueThreadWithSummary"
            >
              {{ t('continuation.confirm') }}
            </UButton>
          </div>
        </template>
      </UModal>

      <div v-if="feedback" class="absolute right-3 bottom-[72px] left-3 z-[5] rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-gray-900 shadow-[0_12px_28px_rgba(17,24,39,0.16)] dark:border-sky-500/30 dark:bg-sky-950 dark:text-sky-100">
        {{ feedback }}
      </div>
      </main>
    </div>
  </UApp>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MiniBar from '@/components/MiniBar.vue'
import PopupMenu from '@/components/PopupMenu.vue'
import PromptManager from '@/components/PromptManager.vue'
import ThreadRow from '@/components/ThreadRow.vue'
import UsageMeter from '@/components/UsageMeter.vue'
import { applyI18nLanguageMode } from '@/i18n'
import type { AppLocale, FavoriteItem, LanguageMode, MessageBookmark, PopupMenuData, PopupMenuShowOptions, PromptTemplate, SidecarData, SidecarSettings, SidecarSnapshot, ThemeMode, ThreadSummary, ThreadUserMessagePreview, UsageDisplayMode } from '@/types/sidecar'
import { formatNavigationMessageTime } from '@/utils/format'

type StatusTileKey = 'completedUnread' | 'running' | 'waiting' | 'failed'
type FilterKey = 'all' | StatusTileKey | 'contextRisk'
type PanelKey = 'threads' | 'bookmarks' | 'prompts' | 'data'
type BookmarkTabKey = 'conversations' | 'messages'
type StatusTileTone = 'completed' | 'running' | 'waiting' | 'failed'
type WindowMode = 'mini' | 'full' | 'popup-menu'

const getInitialWindowMode = (): WindowMode => {
  try {
    const windowMode = new URLSearchParams(window.location.search).get('windowMode')

    return windowMode === 'mini' || windowMode === 'popup-menu' ? windowMode : 'full'
  } catch {
    return 'full'
  }
}

const snapshot = ref<SidecarSnapshot | null>(null)
const bookmarkItems = ref<FavoriteItem[]>([])
const loading = ref(false)
const exporting = ref(false)
const importing = ref(false)
const languageMode = ref<LanguageMode>('auto')
const languageSaving = ref(false)
const themeMode = ref<ThemeMode>('auto')
const themeSaving = ref(false)
const miniOverDock = ref(true)
const miniOverDockSaving = ref(false)
const showMiniPrompts = ref(true)
const showMiniPromptsSaving = ref(false)
const mode = ref<WindowMode>(getInitialWindowMode())
const modeSwitching = ref(false)
const activeFilter = ref<FilterKey>('all')
const activePanel = ref<PanelKey>('threads')
const bookmarkTab = ref<BookmarkTabKey>('conversations')
const searchTerm = ref('')
const bookmarkSearchTerm = ref('')
const selectedThreadId = ref('')
const continuationThreadId = ref('')
const continuationConfirmOpen = ref(false)
const pendingContinuationThread = ref<ThreadSummary | null>(null)
const feedback = ref('')
const usageMode = ref<UsageDisplayMode>('used')
const navigationOpen = ref(false)
const navigationLoading = ref(false)
const navigationJumping = ref(false)
const navigationAccessibilityGranted = ref<boolean | null>(null)
const navigationAccessibilityError = ref('')
const navigationThreadId = ref('')
const navigationSearchTerm = ref('')
const navigationMessages = ref<ThreadUserMessagePreview[]>([])
const navigationError = ref('')
const popupMenu = ref<PopupMenuData | null>(null)
const navigationListRef = ref<HTMLElement | null>(null)
const themeControlRef = ref<HTMLElement | null>(null)
let refreshTimer: number | undefined
let feedbackTimer: number | undefined
let unsubscribeSnapshot: (() => void) | undefined
let unsubscribeWindowMode: (() => void) | undefined
let unsubscribePopupMenuData: (() => void) | undefined
let systemThemeMediaQuery: MediaQueryList | undefined
let snapshotRequestId = 0
let navigationRequestId = 0
let navigationAccessibilityRequestId = 0
let bookmarkMutationVersion = 0
let languageMutationVersion = 0
let themeMutationVersion = 0
let miniOverDockMutationVersion = 0
let showMiniPromptsMutationVersion = 0
const bookmarkMutationVersionByKey = new Map<string, number>()
const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')

const isLanguageMode = (value: unknown): value is LanguageMode => value === 'auto' || value === 'en' || value === 'zh'
const isThemeMode = (value: unknown): value is ThemeMode => value === 'auto' || value === 'light' || value === 'dark'

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

function getFavoriteKey(item: FavoriteItem) {
  return `${item.type}:${item.id}`
}

function getThreadFavoriteKey(threadId: string) {
  return `thread:${threadId}`
}

function getMessageBookmarkId(threadId: string, messageId: string) {
  return `${threadId}:${messageId}`
}

function getMessageFavoriteKey(threadId: string, messageId: string) {
  return `message:${getMessageBookmarkId(threadId, messageId)}`
}

const favoriteItemsByKey = computed(() => new Map<string, FavoriteItem>(
  bookmarkItems.value.map(item => [getFavoriteKey(item), item] as const)
))

const isFavoriteActive = (key: string) => favoriteItemsByKey.value.has(key)

const threads = computed<ThreadSummary[]>(() => (snapshot.value?.threads || []).map(thread => ({
  ...thread,
  favorite: isFavoriteActive(getThreadFavoriteKey(thread.id))
})))
const selectedThread = computed(() => threads.value.find(thread => thread.id === selectedThreadId.value) || null)
const navigationThread = computed(() => threads.value.find(thread => thread.id === navigationThreadId.value) || null)
const messageBookmarks = computed(() => bookmarkItems.value.filter((item): item is MessageBookmark => item.type === 'message'))

const counts = computed(() => ({
  completedUnread: threads.value.filter(thread => thread.sidecarStatus === 'completedUnread').length,
  running: threads.value.filter(thread => thread.sidecarStatus === 'running').length,
  waiting: threads.value.filter(thread => thread.sidecarStatus === 'waiting').length,
  failed: threads.value.filter(thread => thread.sidecarStatus === 'failed').length,
  contextRisk: threads.value.filter(thread => (thread.contextUsage?.percent || 0) >= 75).length,
  favorite: threads.value.filter(thread => thread.favorite).length,
  messageBookmark: messageBookmarks.value.length,
  all: threads.value.length
}))

const panels = computed<Array<{ key: PanelKey, label: string, icon: string }>>(() => [
  { key: 'threads', label: t('panels.threads'), icon: 'i-lucide-message-square-code' },
  { key: 'bookmarks', label: t('panels.bookmarks'), icon: 'i-lucide-bookmark' },
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

const visibleFilters = computed<Array<{ key: FilterKey, label: string, count: number }>>(() => [
  { key: 'all', label: t('filters.all'), count: counts.value.all },
  { key: 'running', label: t('filters.running'), count: counts.value.running },
  { key: 'waiting', label: t('filters.waiting'), count: counts.value.waiting },
  { key: 'completedUnread', label: t('filters.completedUnread'), count: counts.value.completedUnread },
  { key: 'failed', label: t('filters.failed'), count: counts.value.failed }
])

const filteredThreads = computed(() => {
  const term = searchTerm.value.trim().toLowerCase()

  return threads.value.filter(thread => {
    if (activeFilter.value === 'completedUnread' && thread.sidecarStatus !== 'completedUnread') {
      return false
    }

    if (activeFilter.value === 'running' && thread.sidecarStatus !== 'running') {
      return false
    }

    if (activeFilter.value === 'waiting' && thread.sidecarStatus !== 'waiting') {
      return false
    }

    if (activeFilter.value === 'failed' && thread.sidecarStatus !== 'failed') {
      return false
    }

    if (activeFilter.value === 'contextRisk' && (thread.contextUsage?.percent || 0) < 75) {
      return false
    }

    if (!term) {
      return true
    }

    return [
      thread.title,
      thread.codexTitle,
      thread.projectName,
      thread.cwd,
      thread.lastUserMessagePreview,
      thread.recentActivity,
      thread.preview,
      thread.id
    ].some(value => String(value || '').toLowerCase().includes(term))
  })
})

const bookmarkTabs = computed<Array<{ key: BookmarkTabKey, label: string, count: number }>>(() => [
  { key: 'conversations', label: t('bookmarks.conversations'), count: counts.value.favorite },
  { key: 'messages', label: t('bookmarks.messages'), count: counts.value.messageBookmark }
])

const favoriteThreads = computed(() => threads.value.filter(thread => thread.favorite))

const bookmarkSearchPlaceholder = computed(() => {
  return bookmarkTab.value === 'conversations'
    ? t('bookmarks.searchConversations')
    : t('bookmarks.searchMessages')
})

const filteredBookmarkedThreads = computed(() => {
  const term = bookmarkSearchTerm.value.trim().toLowerCase()

  return favoriteThreads.value.filter(thread => {
    if (!term) {
      return true
    }

    return [
      thread.title,
      thread.codexTitle,
      thread.projectName,
      thread.cwd,
      thread.lastUserMessagePreview,
      thread.recentActivity,
      thread.preview,
      thread.id
    ].some(value => String(value || '').toLowerCase().includes(term))
  })
})

const getBookmarkedThread = (bookmark: MessageBookmark) => threads.value.find(thread => thread.id === bookmark.threadId) || null

const getBookmarkThreadTitle = (bookmark: MessageBookmark) => getBookmarkedThread(bookmark)?.title || bookmark.threadTitle || t('common.unnamedThread')

const getBookmarkProjectName = (bookmark: MessageBookmark) => getBookmarkedThread(bookmark)?.projectName || bookmark.projectName || t('common.unnamedProject')

const filteredMessageBookmarks = computed(() => {
  const term = bookmarkSearchTerm.value.trim().toLowerCase()

  return messageBookmarks.value.filter(bookmark => {
    if (!term) {
      return true
    }

    return [
      bookmark.preview,
      bookmark.searchText,
      getBookmarkThreadTitle(bookmark),
      getBookmarkProjectName(bookmark),
      bookmark.cwd,
      bookmark.threadId
    ].some(value => String(value || '').toLowerCase().includes(term))
  })
})

const usageWarning = computed(() => {
  const windows = [snapshot.value?.rateLimits?.primary, snapshot.value?.rateLimits?.secondary].filter(Boolean)
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

const navigationAccessibilityDescription = computed(() => {
  if (navigationAccessibilityError.value) {
    return navigationAccessibilityError.value
  }

  return t('navigation.accessibilityDescription')
})

const filteredNavigationMessages = computed(() => {
  const term = navigationSearchTerm.value.trim().toLowerCase()

  if (!term) {
    return navigationMessages.value
  }

  return navigationMessages.value.filter(message => message.preview.toLowerCase().includes(term))
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
  const promptTemplates = snapshot.value?.sidecarData.promptTemplates || []

  if (promptTemplates.length === 0) {
    return
  }

  try {
    const result = await window.sidecar.showPopupMenu({
      items: promptTemplates.map(template => ({
        id: template.id,
        label: template.name || t('common.unnamedPrompt'),
        description: getPromptMenuDescription(template)
      })),
      point: getMenuPopupPoint(event),
      width: 340
    })
    const selectedTemplate = promptTemplates.find(template => template.id === result.selectedId)

    if (selectedTemplate) {
      await window.sidecar.copyText(selectedTemplate.body)
      setFeedback(t('feedback.copied'))
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
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

const applySnapshot = (nextSnapshot: SidecarSnapshot) => {
  syncSettingsFromSnapshot(nextSnapshot.sidecarData.settings)

  snapshot.value = {
    ...nextSnapshot,
    sidecarData: {
      ...nextSnapshot.sidecarData,
      favorites: []
    }
  }
}

const refreshSnapshot = async () => {
  const requestId = ++snapshotRequestId
  loading.value = true

  try {
    const nextSnapshot = await window.sidecar.getSnapshot()

    if (requestId === snapshotRequestId) {
      applySnapshot(nextSnapshot)
    }
  } catch (error) {
    if (requestId === snapshotRequestId) {
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (requestId === snapshotRequestId) {
      loading.value = false
    }
  }
}

const setMode = async (nextMode: WindowMode) => {
  if (mode.value === nextMode || modeSwitching.value) {
    return
  }

  modeSwitching.value = true
  await nextTick()

  try {
    await window.sidecar.setWindowMode(nextMode)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    modeSwitching.value = false
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
    type: 'message',
    id: item.id,
    threadId: item.threadId,
    messageId: item.messageId,
    turnId: item.turnId,
    itemId: item.itemId,
    index: item.index,
    preview: item.preview,
    searchText: item.searchText,
    messageCreatedAt: item.messageCreatedAt,
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

const patchLocalSettings = (settings: Partial<SidecarSettings>) => {
  if (snapshot.value) {
    const previousSettings = snapshot.value.sidecarData.settings || {
      languageMode: languageMode.value,
      themeMode: themeMode.value,
      miniOverDock: miniOverDock.value,
      showMiniPrompts: showMiniPrompts.value
    }

    snapshot.value = {
      ...snapshot.value,
      sidecarData: {
        ...snapshot.value.sidecarData,
        settings: {
          ...previousSettings,
          ...settings
        }
      }
    }
  }
}

const applyLanguageMode = (nextLanguageMode: LanguageMode) => {
  languageMode.value = nextLanguageMode
  applyI18nLanguageMode(nextLanguageMode)
  patchLocalSettings({ languageMode: nextLanguageMode })
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
  patchLocalSettings({ themeMode: nextThemeMode })
}

const applyMiniOverDock = (nextMiniOverDock: boolean) => {
  miniOverDock.value = nextMiniOverDock
  patchLocalSettings({ miniOverDock: nextMiniOverDock })
}

const applyShowMiniPrompts = (nextShowMiniPrompts: boolean) => {
  showMiniPrompts.value = nextShowMiniPrompts
  patchLocalSettings({ showMiniPrompts: nextShowMiniPrompts })
}

const syncSettingsFromSnapshot = (settings: SidecarSettings) => {
  if (settings.languageMode !== languageMode.value) {
    languageMode.value = settings.languageMode
    applyI18nLanguageMode(settings.languageMode)
  }

  if (settings.themeMode !== themeMode.value) {
    themeMode.value = settings.themeMode
    applyDocumentThemeMode(settings.themeMode)
  }

  if (settings.miniOverDock !== miniOverDock.value) {
    miniOverDock.value = settings.miniOverDock
  }

  if (settings.showMiniPrompts !== showMiniPrompts.value) {
    showMiniPrompts.value = settings.showMiniPrompts
  }
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

const applyThemeModeWithTransition = (nextThemeMode: ThemeMode, event?: MouseEvent) => {
  const viewTransitionDocument = document as Document & {
    startViewTransition?: (updateCallback: () => void) => { ready: Promise<void> }
  }
  const target = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : themeControlRef.value
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!target || typeof viewTransitionDocument.startViewTransition !== 'function' || reducedMotion) {
    applyThemeMode(nextThemeMode)
    return
  }

  const { top, left, width, height } = target.getBoundingClientRect()
  const x = left + width / 2
  const y = top + height / 2
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  viewTransitionDocument.startViewTransition(() => {
    applyThemeMode(nextThemeMode)
  }).ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`]
      },
      {
        duration: 800,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)'
      }
    )
  }).catch(() => undefined)
}

const applySidecarData = (data: SidecarData) => {
  applyLanguageMode(data.settings.languageMode)
  applyThemeMode(data.settings.themeMode)
  applyMiniOverDock(data.settings.miniOverDock)
  applyShowMiniPrompts(data.settings.showMiniPrompts)

  bookmarkItems.value = data.favorites
    .map(item => toPlainFavoriteItem(item))
    .sort((a, b) => b.createdAt - a.createdAt)

  if (snapshot.value) {
    snapshot.value = {
      ...snapshot.value,
      sidecarData: {
        ...snapshot.value.sidecarData,
        ...data,
        favorites: []
      }
    }
  }
}

const loadSidecarData = async () => {
  applySidecarData(await window.sidecar.getSidecarData())
}

const saveLanguageMode = async (value: unknown) => {
  if (!isLanguageMode(value) || value === languageMode.value) {
    return
  }

  const previousLanguageMode = languageMode.value
  const version = ++languageMutationVersion

  languageSaving.value = true
  applyLanguageMode(value)

  try {
    const settings = await window.sidecar.setLanguageMode(value)

    if (version === languageMutationVersion) {
      applyLanguageMode(settings.languageMode)
    }
  } catch (error) {
    if (version === languageMutationVersion) {
      applyLanguageMode(previousLanguageMode)
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === languageMutationVersion) {
      languageSaving.value = false
    }
  }
}

const saveThemeMode = async (value: unknown, event?: MouseEvent) => {
  if (!isThemeMode(value) || value === themeMode.value) {
    return
  }

  const previousThemeMode = themeMode.value
  const version = ++themeMutationVersion

  themeSaving.value = true
  applyThemeModeWithTransition(value, event)

  try {
    const settings = await window.sidecar.setThemeMode(value)

    if (version === themeMutationVersion) {
      applyThemeMode(settings.themeMode)
    }
  } catch (error) {
    if (version === themeMutationVersion) {
      applyThemeMode(previousThemeMode)
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === themeMutationVersion) {
      themeSaving.value = false
    }
  }
}

const saveMiniOverDock = async (value: unknown) => {
  if (typeof value !== 'boolean' || value === miniOverDock.value) {
    return
  }

  const previousMiniOverDock = miniOverDock.value
  const version = ++miniOverDockMutationVersion

  miniOverDockSaving.value = true
  applyMiniOverDock(value)

  try {
    const settings = await window.sidecar.setMiniOverDock(value)

    if (version === miniOverDockMutationVersion) {
      applyMiniOverDock(settings.miniOverDock)
    }
  } catch (error) {
    if (version === miniOverDockMutationVersion) {
      applyMiniOverDock(previousMiniOverDock)
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === miniOverDockMutationVersion) {
      miniOverDockSaving.value = false
    }
  }
}

const saveShowMiniPrompts = async (value: unknown) => {
  if (typeof value !== 'boolean' || value === showMiniPrompts.value) {
    return
  }

  const previousShowMiniPrompts = showMiniPrompts.value
  const version = ++showMiniPromptsMutationVersion

  showMiniPromptsSaving.value = true
  applyShowMiniPrompts(value)

  try {
    const settings = await window.sidecar.setShowMiniPrompts(value)

    if (version === showMiniPromptsMutationVersion) {
      applyShowMiniPrompts(settings.showMiniPrompts)
    }
  } catch (error) {
    if (version === showMiniPromptsMutationVersion) {
      applyShowMiniPrompts(previousShowMiniPrompts)
      setFeedback(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === showMiniPromptsMutationVersion) {
      showMiniPromptsSaving.value = false
    }
  }
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

const createMessageBookmark = (thread: ThreadSummary, message: ThreadUserMessagePreview): MessageBookmark => ({
  type: 'message',
  id: getMessageBookmarkId(thread.id, message.id),
  threadId: thread.id,
  messageId: message.id,
  turnId: message.turnId,
  itemId: message.itemId,
  index: message.index,
  preview: message.preview,
  searchText: message.searchText,
  messageCreatedAt: message.createdAt,
  createdAt: Date.now(),
  threadTitle: thread.title,
  codexTitle: thread.codexTitle,
  cwd: thread.cwd,
  projectName: thread.projectName
})

const isNavigationMessageBookmarked = (message: ThreadUserMessagePreview) => {
  return Boolean(navigationThreadId.value && isFavoriteActive(getMessageFavoriteKey(navigationThreadId.value, message.id)))
}

const toggleNavigationMessageBookmark = async (message: ThreadUserMessagePreview) => {
  const thread = navigationThread.value

  if (!thread) {
    setFeedback(t('feedback.messageBookmarkThreadMissing'))
    return
  }

  const key = getMessageFavoriteKey(thread.id, message.id)
  const favorite = !isFavoriteActive(key)

  await saveFavoriteItem((getFavoriteItem(key) as MessageBookmark | null) || createMessageBookmark(thread, message), favorite)
}

const removeMessageBookmark = async (bookmark: MessageBookmark) => {
  await saveFavoriteItem(bookmark, false)
}

const openMessageBookmark = async (bookmark: MessageBookmark) => {
  try {
    if (bookmark.searchText.trim()) {
      await window.sidecar.openThreadAndSearch(bookmark.threadId, bookmark.searchText)
      setFeedback(t('feedback.openedSearch'))
      return
    }

    await window.sidecar.openThread(bookmark.threadId)
    setFeedback(t('feedback.openedThread'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const openThread = async (thread: ThreadSummary) => {
  selectedThreadId.value = thread.id

  try {
    await window.sidecar.openThread(thread.id)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  }
}

const openContinuationConfirm = (thread: ThreadSummary) => {
  if (continuationThreadId.value) {
    return
  }

  selectedThreadId.value = thread.id
  pendingContinuationThread.value = thread
  continuationConfirmOpen.value = true
}

const closeContinuationConfirm = () => {
  if (continuationThreadId.value) {
    return
  }

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

  if (!thread || continuationThreadId.value) {
    return
  }

  selectedThreadId.value = thread.id
  continuationThreadId.value = thread.id

  try {
    await window.sidecar.continueThreadWithSummary(thread.id, thread.cwd)
    continuationConfirmOpen.value = false
    pendingContinuationThread.value = null
    setFeedback(t('feedback.summaryOpened'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    if (continuationThreadId.value === thread.id) {
      continuationThreadId.value = ''
    }
  }
}

const closeNavigation = () => {
  navigationRequestId += 1
  navigationAccessibilityRequestId += 1
  navigationOpen.value = false
  navigationLoading.value = false
  navigationJumping.value = false
  navigationAccessibilityGranted.value = null
  navigationAccessibilityError.value = ''
  navigationError.value = ''
}

const handleNavigationOpenChange = (open: boolean) => {
  if (open) {
    navigationOpen.value = true
    return
  }

  closeNavigation()
}

const checkNavigationAccessibility = async () => {
  const requestId = ++navigationAccessibilityRequestId
  navigationAccessibilityGranted.value = null
  navigationAccessibilityError.value = ''

  try {
    const result = await window.sidecar.checkAccessibilityPermission()

    if (requestId === navigationAccessibilityRequestId) {
      navigationAccessibilityGranted.value = result.granted
      navigationAccessibilityError.value = result.error || ''
    }
  } catch (error) {
    if (requestId === navigationAccessibilityRequestId) {
      navigationAccessibilityGranted.value = false
      navigationAccessibilityError.value = error instanceof Error ? error.message : String(error)
    }
  }
}

const scrollNavigationListToBottom = async () => {
  await nextTick()

  const element = navigationListRef.value

  if (element) {
    element.scrollTop = element.scrollHeight
  }
}

const loadNavigationMessages = async (thread: ThreadSummary) => {
  const requestId = ++navigationRequestId
  navigationLoading.value = true
  navigationError.value = ''
  navigationMessages.value = []
  let shouldScrollToBottom = false

  try {
    const result = await window.sidecar.getThreadUserMessages(thread.id)

    if (requestId === navigationRequestId && navigationThreadId.value === thread.id) {
      navigationMessages.value = result.messages
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

  void checkNavigationAccessibility()
  await loadNavigationMessages(thread)
}

const jumpToUserMessage = async (message: ThreadUserMessagePreview) => {
  const threadId = navigationThreadId.value

  if (!threadId || navigationJumping.value) {
    return
  }

  navigationJumping.value = true

  try {
    if (message.searchText.trim()) {
      await window.sidecar.openThreadAndSearch(threadId, message.searchText)
      setFeedback(t('feedback.openedSearch'))
      return
    }

    await window.sidecar.openThread(threadId)
    setFeedback(t('feedback.openedThread'))
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error))
  } finally {
    navigationJumping.value = false
  }
}

const savePromptTemplates = async (templates: PromptTemplate[]) => {
  if (snapshot.value) {
    snapshot.value = {
      ...snapshot.value,
      sidecarData: {
        ...snapshot.value.sidecarData,
        promptTemplates: templates
      }
    }
  }

  await window.sidecar.savePromptTemplates(templates)
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
      await refreshSnapshot()
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
  unsubscribeWindowMode = window.sidecar.onWindowMode(nextMode => {
    mode.value = nextMode
    modeSwitching.value = false
  })

  try {
    mode.value = await window.sidecar.getWindowMode()
  } catch {
    mode.value = getInitialWindowMode()
  }

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

  unsubscribeSnapshot = window.sidecar.onSnapshot(applySnapshot)
  await refreshSnapshot()
  refreshTimer = window.setInterval(refreshSnapshot, 5000)
})

onBeforeUnmount(() => {
  unsubscribeSnapshot?.()
  unsubscribeWindowMode?.()
  unsubscribePopupMenuData?.()
  systemThemeMediaQuery?.removeEventListener('change', handleSystemThemeChange)

  if (refreshTimer) {
    window.clearInterval(refreshTimer)
  }

  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }
})
</script>
