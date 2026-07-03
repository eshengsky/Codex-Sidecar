<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
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
      <div v-if="loading && !hasCodexStore" class="flex flex-col gap-2">
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
          :continuing="continuationThreadIdSet.has(thread.id)"
          :continue-disabled="continuationThreadIdSet.has(thread.id)"
          :continuation-unread="continuationUnreadThreadIdSet.has(thread.id)"
          @open="emit('open', $event)"
          @toggle-favorite="emit('toggleFavorite', $event)"
          @open-navigation="emit('openNavigation', $event)"
          @continue-thread="emit('continueThread', $event)"
        />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ThreadRow from '@/components/ThreadRow.vue'
import type { ThreadSummary } from '@/types/sidecar'

type StatusTileKey = 'completedUnread' | 'running' | 'waiting' | 'failed'
type FilterKey = 'all' | StatusTileKey | 'contextRisk'

const props = defineProps<{
  threads: ThreadSummary[]
  counts: Record<FilterKey, number>
  loading: boolean
  hasCodexStore: boolean
  selectedThreadId: string
  continuationThreadIds: string[]
  continuationUnreadThreadIds: string[]
}>()

const emit = defineEmits<{
  open: [thread: ThreadSummary]
  toggleFavorite: [thread: ThreadSummary]
  openNavigation: [thread: ThreadSummary]
  continueThread: [thread: ThreadSummary]
}>()

const { t } = useI18n()
const searchTerm = ref('')
const activeFilter = ref<FilterKey>('all')
const continuationThreadIdSet = computed(() => new Set(props.continuationThreadIds))
const continuationUnreadThreadIdSet = computed(() => new Set(props.continuationUnreadThreadIds))

const visibleFilters = computed<Array<{ key: FilterKey, label: string, count: number }>>(() => [
  { key: 'all', label: t('filters.all'), count: props.counts.all },
  { key: 'running', label: t('filters.running'), count: props.counts.running },
  { key: 'waiting', label: t('filters.waiting'), count: props.counts.waiting },
  { key: 'completedUnread', label: t('filters.completedUnread'), count: props.counts.completedUnread },
  { key: 'failed', label: t('filters.failed'), count: props.counts.failed }
])

const filteredThreads = computed(() => {
  const term = searchTerm.value.trim().toLowerCase()

  return props.threads.filter(thread => {
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
</script>
