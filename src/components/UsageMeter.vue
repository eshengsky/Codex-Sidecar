<template>
  <div class="flex min-w-0 flex-col gap-1.5 rounded-lg border border-gray-200 bg-default px-2.5 py-2 dark:border-neutral-800">
    <div class="flex items-center justify-between gap-2.5 text-xs text-gray-700 dark:text-gray-200">
      <span>{{ displayWindowLabel }}</span>
      <span class="numeric-mono text-[13px]" :class="toneClass.text">{{ displayPercent }}%</span>
    </div>
    <div class="relative h-2.5 w-full">
      <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-700">
        <div class="h-full rounded-[inherit] transition-[width] duration-300 ease-out motion-reduce:transition-none" :class="[toneClass.bar, percentWidthClass(displayPercent)]" />
      </div>
      <UTooltip v-if="timeReferencePercent !== null" :text="timeReferenceTooltip">
        <span
          class="absolute top-0 z-[1] flex h-[7px] w-4 -translate-x-1/2 items-start justify-center"
          :style="{ left: `${timeReferencePercent}%` }"
          :aria-label="t('usage.timeReference')"
        >
          <span class="block h-full w-0.5 rounded-full bg-gray-500/80 dark:bg-gray-300/80" />
        </span>
      </UTooltip>
    </div>
    <div class="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
      <span class="inline-flex min-w-0 items-center gap-0.5">
        <span>{{ usageLabel }}</span>
        <UTooltip :text="toggleTooltip">
          <UButton
            icon="i-lucide-arrow-right-left"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :ui="{ leadingIcon: 'size-2.5' }"
            :aria-label="toggleTooltip"
            @click="$emit('toggle-mode')"
          />
        </UTooltip>
      </span>
      <span>
        {{ t('usage.reset') }}
        <UTooltip :text="resetTooltip">
          <span>{{ resetDisplayTime }}</span>
        </UTooltip>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppLocale, RateLimitWindow, UsageDisplayMode } from '@/types/sidecar'
import { formatResetDate, formatResetDateTime, formatResetTime } from '@/utils/format'
import { formatRateLimitWindowLabel, shouldShowRateLimitResetDate } from '@/utils/rate-limit-window-label'
import { getRateLimitTimeReferencePercent } from '@/utils/rate-limit-time-reference'
import { percentWidthClass, usageToneClass } from '@/utils/tailwind'

const props = defineProps<{
  window: RateLimitWindow
  mode: UsageDisplayMode
}>()

defineEmits<{
  'toggle-mode': []
}>()

const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')
const nowMs = ref(Date.now())
let nowInterval: ReturnType<typeof setInterval> | null = null

const displayPercent = computed(() => {
  return props.mode === 'remaining' ? props.window.remainingPercent : props.window.usedPercent
})

const usageLabel = computed(() => {
  return props.mode === 'remaining' ? t('usage.remaining') : t('usage.used')
})

const toggleTooltip = computed(() => {
  return props.mode === 'remaining' ? t('usage.toggleToUsed') : t('usage.toggleToRemaining')
})

const timeReferenceTooltip = computed(() => {
  return props.mode === 'remaining' ? t('usage.timeReferenceTooltipRemaining') : t('usage.timeReferenceTooltipUsed')
})

const displayWindowLabel = computed(() => {
  return formatRateLimitWindowLabel(props.window.windowDurationMins, appLocale.value, props.window.label)
})

const resetDisplayTime = computed(() => {
  return shouldShowRateLimitResetDate(props.window.windowDurationMins)
    ? formatResetDate(props.window.resetsAt, appLocale.value)
    : formatResetTime(props.window.resetsAt, appLocale.value)
})

const resetTooltip = computed(() => {
  return formatResetDateTime(props.window.resetsAt, appLocale.value)
})

const timeReferencePercent = computed(() => {
  return getRateLimitTimeReferencePercent({
    windowDurationMins: props.window.windowDurationMins,
    resetsAt: props.window.resetsAt,
    mode: props.mode,
    nowMs: nowMs.value
  })
})

const toneClass = computed(() => usageToneClass(props.window.usedPercent))

onMounted(() => {
  nowInterval = setInterval(() => {
    nowMs.value = Date.now()
  }, 60 * 1000)
})

onUnmounted(() => {
  if (nowInterval) {
    clearInterval(nowInterval)
  }
})
</script>
