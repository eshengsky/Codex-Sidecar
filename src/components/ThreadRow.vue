<template>
  <article
    class="flex min-w-0 cursor-pointer items-start gap-2.5 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-gray-100 dark:hover:bg-neutral-800"
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
        <div class="flex flex-none items-center justify-end gap-1" @keydown.stop>
          <UTooltip v-if="contextUsagePercent !== null" :text="contextUsageTooltip">
            <span
              class="relative inline-flex size-3.5 mr-1 cursor-default flex-none items-center justify-center rounded-full [-webkit-app-region:no-drag]"
              :class="contextUsageToneClass"
              :aria-label="contextUsageTooltip"
              role="img"
              @click.stop
            >
              <svg class="absolute inset-0 size-3.5 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                <circle
                  class="stroke-gray-200 dark:stroke-neutral-700"
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke-width="5"
                />
                <circle
                  class="stroke-current transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke-width="5"
                  stroke-linecap="round"
                  pathLength="100"
                  stroke-dasharray="100"
                  :stroke-dashoffset="contextUsageDashOffset"
                />
              </svg>
              <!-- <span class="numeric-mono relative text-[8px] leading-none">{{ contextUsageLabel }}</span> -->
            </span>
          </UTooltip>
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
            <span class="relative inline-flex">
              <UButton
                icon="i-lucide-unplug"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                :loading="continuing"
                :disabled="continueDisabled"
                @click.stop="$emit('continue-thread', thread)"
              />
              <span
                v-if="continuationUnread"
                class="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-900"
              />
            </span>
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
import { getContextUsageTooltipKey } from '@/utils/context-usage-tooltip'
import { formatRelativeTime } from '@/utils/format'

const props = defineProps<{
  thread: ThreadSummary
  selected: boolean
  continuing: boolean
  continueDisabled: boolean
  continuationUnread: boolean
}>()

defineEmits<{
  open: [thread: ThreadSummary]
  toggleFavorite: [thread: ThreadSummary]
  'open-navigation': [thread: ThreadSummary]
  'continue-thread': [thread: ThreadSummary]
}>()

const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')

const contextUsagePercent = computed(() => {
  const percent = Number(props.thread.contextUsage?.percent)

  if (!Number.isFinite(percent)) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round(percent)))
})

const contextUsageLabel = computed(() => {
  return contextUsagePercent.value === null ? '' : `${contextUsagePercent.value}`
})

const contextUsageTooltip = computed(() => {
  return contextUsagePercent.value === null
    ? ''
    : t(getContextUsageTooltipKey(contextUsagePercent.value), { percent: contextUsagePercent.value })
})

const contextUsageDashOffset = computed(() => {
  return contextUsagePercent.value === null ? 100 : 100 - contextUsagePercent.value
})

const contextUsageToneClass = computed(() => {
  if ((contextUsagePercent.value || 0) >= 90) {
    return 'text-red-600 dark:text-red-400'
  }

  if ((contextUsagePercent.value || 0) >= 70) {
    return 'text-orange-500 dark:text-orange-400'
  }

  return 'text-sky-600 dark:text-sky-400'
})

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
