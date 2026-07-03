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
      <span
        v-for="marker in referenceMarkers"
        :key="marker.label"
        class="absolute top-0 z-[1] flex h-[7px] w-4 -translate-x-1/2 items-start justify-center"
        :class="marker.positionClass"
        :aria-label="marker.label"
      >
        <span class="block h-full w-0.5 rounded-full bg-gray-200 dark:bg-neutral-700" />
      </span>
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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppLocale, RateLimitWindow, UsageDisplayMode } from '@/types/sidecar'
import { formatResetDate, formatResetDateTime, formatResetTime } from '@/utils/format'
import { percentWidthClass, usageToneClass } from '@/utils/tailwind'

interface ReferenceMarker {
  label: string
  positionClass: string
}

const hourlyMarkerPositionClasses = ['left-[20%]', 'left-[40%]', 'left-[60%]', 'left-[80%]'] as const
const dailyMarkerPositionClasses = [
  'left-[14.2857%]',
  'left-[28.5714%]',
  'left-[42.8571%]',
  'left-[57.1429%]',
  'left-[71.4286%]',
  'left-[85.7143%]'
] as const

const props = defineProps<{
  window: RateLimitWindow
  mode: UsageDisplayMode
}>()

defineEmits<{
  'toggle-mode': []
}>()

const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')

const displayPercent = computed(() => {
  return props.mode === 'remaining' ? props.window.remainingPercent : props.window.usedPercent
})

const usageLabel = computed(() => {
  return props.mode === 'remaining' ? t('usage.remaining') : t('usage.used')
})

const toggleTooltip = computed(() => {
  return props.mode === 'remaining' ? t('usage.toggleToUsed') : t('usage.toggleToRemaining')
})

const displayWindowLabel = computed(() => {
  if (props.window.windowDurationMins === 300) {
    return t('usage.windowFiveHours')
  }

  if (props.window.windowDurationMins === 10080) {
    return t('usage.windowOneWeek')
  }

  return props.window.label
})

const resetDisplayTime = computed(() => {
  return props.window.windowDurationMins === 10080
    ? formatResetDate(props.window.resetsAt, appLocale.value)
    : formatResetTime(props.window.resetsAt, appLocale.value)
})

const resetTooltip = computed(() => {
  return formatResetDateTime(props.window.resetsAt, appLocale.value)
})

const referenceMarkers = computed<ReferenceMarker[]>(() => {
  if (props.window.windowDurationMins === 300 || props.window.label === '5 小时') {
    return hourlyMarkerPositionClasses.map((positionClass, index) => ({
      label: t('usage.referencePoint', { index: index + 1 }),
      positionClass
    }))
  }

  if (props.window.windowDurationMins === 10080 || props.window.label === '1 周') {
    return dailyMarkerPositionClasses.map((positionClass, index) => ({
      label: t('usage.referencePoint', { index: index + 1 }),
      positionClass
    }))
  }

  return []
})

const toneClass = computed(() => usageToneClass(props.window.usedPercent))
</script>
