<template>
  <article
    class="flex min-w-0 cursor-pointer items-start gap-2.5 rounded-[9px] border border-default bg-white p-2.5 text-gray-900 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:bg-neutral-900 dark:text-gray-100 dark:hover:bg-neutral-800"
    :class="selected ? 'bg-gray-50 dark:bg-neutral-800' : ''"
    role="button"
    tabindex="0"
    @click="$emit('open', thread)"
    @keydown.enter="$emit('open', thread)"
    @keydown.space.prevent="$emit('open', thread)"
  >
    <span class="relative mt-[5px] h-2 w-2 flex-none">
      <span
        v-if="isBreathingStatus"
        class="sidecar-status-breathe absolute inset-0 rounded-full"
        :class="statusPingClass"
      />
      <span class="relative block h-2 w-2 rounded-full" :class="statusClass" />
    </span>

    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex min-w-0 items-center gap-2">
        <h3 class="m-0 min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[1.25] font-[760] text-gray-900 dark:text-gray-100">
          {{ thread.title }}
        </h3>
        <span class="flex-none text-[11px] leading-none whitespace-nowrap text-gray-500 dark:text-gray-400">{{ formatRelativeTime(thread.updatedAt, appLocale) }}</span>
      </div>

      <p v-if="thread.lastUserMessagePreview" class="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[1.25] text-gray-600 dark:text-gray-300">
        {{ thread.lastUserMessagePreview }}
      </p>

      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.2] text-gray-500 dark:text-gray-400">{{ thread.projectName || t('common.unnamedProject') }}</span>
        <div class="flex flex-none items-center justify-end gap-1.5" @keydown.stop>
          <UTooltip :text="thread.favorite ? t('bookmarks.remove') : t('bookmarks.add')">
            <UButton
              icon="i-lucide-bookmark"
              :color="thread.favorite ? 'warning' : 'neutral'"
              :variant="thread.favorite ? 'soft' : 'ghost'"
              size="xs"
              square
              @click.stop="$emit('toggleFavorite', thread)"
            />
          </UTooltip>
          <UTooltip :text="t('navigation.title')">
            <UButton
              icon="i-lucide-table-of-contents"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              @click.stop="$emit('open-navigation', thread)"
            />
          </UTooltip>
          <UTooltip :text="t('continuation.title')">
            <UButton
              icon="i-lucide-message-square-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              :loading="continuing"
              :disabled="continueDisabled"
              @click.stop="$emit('continue-thread', thread)"
            />
          </UTooltip>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppLocale, ThreadSummary } from '@/types/sidecar'
import { formatRelativeTime } from '@/utils/format'

const props = defineProps<{
  thread: ThreadSummary
  selected: boolean
  continuing: boolean
  continueDisabled: boolean
}>()

defineEmits<{
  open: [thread: ThreadSummary]
  toggleFavorite: [thread: ThreadSummary]
  'open-navigation': [thread: ThreadSummary]
  'continue-thread': [thread: ThreadSummary]
}>()

const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')

const statusClass = computed(() => {
  if (props.thread.sidecarStatus === 'completedUnread') {
    return 'bg-emerald-500'
  }

  if (props.thread.sidecarStatus === 'running') {
    return 'bg-sky-500'
  }

  if (props.thread.sidecarStatus === 'waiting') {
    return 'bg-amber-400'
  }

  if (props.thread.sidecarStatus === 'failed') {
    return 'bg-red-500'
  }

  return 'bg-neutral-300'
})

const isBreathingStatus = computed(() => props.thread.sidecarStatus === 'running' || props.thread.sidecarStatus === 'waiting')

const statusPingClass = computed(() => {
  if (props.thread.sidecarStatus === 'running') {
    return 'bg-sky-300'
  }

  if (props.thread.sidecarStatus === 'waiting') {
    return 'bg-amber-300'
  }

  return ''
})
</script>
