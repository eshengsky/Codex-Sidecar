<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex gap-1 rounded-lg bg-neutral-200/70 p-0.5 dark:bg-neutral-800" role="tablist" :aria-label="t('bookmarks.typeLabel')">
        <button
          v-for="tab in bookmarkTabs"
          :key="tab.key"
          type="button"
          class="inline-flex h-7 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-[7px] border-0 px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          :class="bookmarkTab === tab.key ? 'bg-default text-gray-950 dark:bg-accented dark:text-white' : 'bg-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
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
            :continuing="continuationThreadIdSet.has(thread.id)"
            :continue-disabled="continuationThreadIdSet.has(thread.id)"
            :continuation-unread="continuationUnreadThreadIdSet.has(thread.id)"
            @open="emit('open', $event)"
            @toggle-favorite="emit('toggleFavorite', $event)"
            @open-navigation="emit('openNavigation', $event)"
            @continue-thread="emit('continueThread', $event)"
          />
        </template>
      </template>

      <template v-else>
        <UEmpty
          v-if="filteredTurnBookmarks.length === 0"
          :title="t('bookmarks.emptyMessagesTitle')"
          :description="t('bookmarks.emptyMessagesDescription')"
          variant="naked"
          size="xs"
          class="min-h-[220px] self-center"
        />

        <template v-else>
          <article
            v-for="bookmark in filteredTurnBookmarks"
            :key="bookmark.id"
            class="flex min-w-0 flex-col gap-1.5 rounded-[9px] border border-gray-100 bg-default p-2.5 text-gray-900 dark:border-neutral-800 dark:text-gray-100"
          >
            <div class="flex min-w-0 items-center gap-2">
              <h3 class="m-0 min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[1.25] font-[760] text-gray-900 dark:text-gray-100">
                {{ getBookmarkThreadTitle(bookmark) }}
              </h3>
              <UTooltip :text="t('bookmarks.removeTurn')">
                <UButton
                  icon="i-lucide-bookmark-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  @click="emit('removeTurnBookmark', bookmark)"
                />
              </UTooltip>
            </div>

            <button
              type="button"
              class="flex rounded-lg border-0 bg-gray-50 px-2.5 py-2 text-left text-[13px] leading-[1.45] text-gray-900 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700"
              @click="emit('openTurnBookmark', bookmark)"
            >
              <span class="line-clamp-3 [overflow-wrap:anywhere]">{{ bookmark.userPreview }}</span>
            </button>

            <div
              v-if="bookmark.assistantPreview"
              class="flex rounded-lg bg-gray-50 px-2.5 py-2 text-left text-[13px] leading-[1.45] text-gray-700 dark:bg-neutral-900 dark:text-gray-300"
            >
              <span class="line-clamp-3 [overflow-wrap:anywhere]">{{ bookmark.assistantPreview }}</span>
            </div>

            <div class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.2] text-gray-500 dark:text-gray-400">{{ getBookmarkProjectName(bookmark) }}</span>
              <span class="text-[11px] leading-none whitespace-nowrap text-gray-500 dark:text-gray-400">{{ formatNavigationMessageTime(bookmark.createdAt, appLocale) }}</span>
            </div>
          </article>
        </template>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ThreadRow from '@/components/ThreadRow.vue'
import type { AppLocale, ThreadSummary, TurnBookmark } from '@/types/sidecar'
import { formatNavigationMessageTime } from '@/utils/format'

type BookmarkTabKey = 'conversations' | 'messages'

const props = defineProps<{
  threads: ThreadSummary[]
  turnBookmarks: TurnBookmark[]
  selectedThreadId: string
  continuationThreadIds: string[]
  continuationUnreadThreadIds: string[]
  appLocale: AppLocale
}>()

const emit = defineEmits<{
  open: [thread: ThreadSummary]
  toggleFavorite: [thread: ThreadSummary]
  openNavigation: [thread: ThreadSummary]
  continueThread: [thread: ThreadSummary]
  removeTurnBookmark: [bookmark: TurnBookmark]
  openTurnBookmark: [bookmark: TurnBookmark]
}>()

const { t } = useI18n()
const bookmarkTab = ref<BookmarkTabKey>('conversations')
const bookmarkSearchTerm = ref('')
const continuationThreadIdSet = computed(() => new Set(props.continuationThreadIds))
const continuationUnreadThreadIdSet = computed(() => new Set(props.continuationUnreadThreadIds))

const favoriteThreads = computed(() => props.threads.filter(thread => thread.favorite))

const bookmarkTabs = computed<Array<{ key: BookmarkTabKey, label: string, count: number }>>(() => [
  { key: 'conversations', label: t('bookmarks.conversations'), count: favoriteThreads.value.length },
  { key: 'messages', label: t('bookmarks.messages'), count: props.turnBookmarks.length }
])

const bookmarkSearchPlaceholder = computed(() => {
  return bookmarkTab.value === 'conversations'
    ? t('bookmarks.searchConversations')
    : t('bookmarks.searchMessages')
})

const getBookmarkedThread = (bookmark: TurnBookmark) => props.threads.find(thread => thread.id === bookmark.threadId) || null

const getBookmarkThreadTitle = (bookmark: TurnBookmark) => getBookmarkedThread(bookmark)?.title || bookmark.threadTitle || t('common.unnamedThread')

const getBookmarkProjectName = (bookmark: TurnBookmark) => getBookmarkedThread(bookmark)?.projectName || bookmark.projectName || t('common.unnamedProject')

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

const filteredTurnBookmarks = computed(() => {
  const term = bookmarkSearchTerm.value.trim().toLowerCase()

  return props.turnBookmarks.filter(bookmark => {
    if (!term) {
      return true
    }

    return [
      bookmark.userPreview,
      bookmark.userSearchText,
      bookmark.assistantPreview,
      getBookmarkThreadTitle(bookmark),
      getBookmarkProjectName(bookmark),
      bookmark.cwd,
      bookmark.threadId
    ].some(value => String(value || '').toLowerCase().includes(term))
  })
})
</script>
