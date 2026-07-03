<template>
  <div
    class="group/mini flex h-full w-full cursor-default items-center gap-2 bg-default pr-1.5 pl-3 text-slate-900 select-none dark:text-gray-100"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerEnd"
    @pointercancel="handlePointerEnd"
    @lostpointercapture="handlePointerCaptureLost"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <div class="flex min-w-0 flex-none items-center gap-2.5">
        <button
          type="button"
          class="-mx-1.5 inline-flex min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs text-slate-900 transition-colors [-webkit-app-region:no-drag] dark:text-gray-100"
          :class="counts.running === 0 ? 'cursor-default opacity-35' : 'cursor-pointer hover:bg-elevated'"
          :aria-label="t('status.runningTooltip')"
          @click="$emit('status-click', 'running', $event)"
        >
          <span class="relative h-2.5 w-2.5 flex-none">
            <span v-if="counts.running > 0" class="sidecar-status-breathe absolute inset-0 rounded-full bg-sky-300" />
            <span class="relative block h-full w-full rounded-full bg-sky-500" />
          </span>
          <span class="numeric-mono leading-none">{{ formatStatusCount(counts.running) }}</span>
        </button>
        <button
          type="button"
          class="-mx-1.5 inline-flex min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs text-slate-900 transition-colors [-webkit-app-region:no-drag] dark:text-gray-100"
          :class="counts.waiting === 0 ? 'cursor-default opacity-35' : 'cursor-pointer hover:bg-elevated'"
          :aria-label="t('status.waitingTooltip')"
          @click="$emit('status-click', 'waiting', $event)"
        >
          <span class="relative h-2.5 w-2.5 flex-none">
            <span v-if="counts.waiting > 0" class="sidecar-status-breathe absolute inset-0 rounded-full bg-amber-300" />
            <span class="relative block h-full w-full rounded-full bg-amber-400" />
          </span>
          <span class="numeric-mono leading-none">{{ formatStatusCount(counts.waiting) }}</span>
        </button>
        <button
          type="button"
          class="-mx-1.5 inline-flex min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs text-slate-900 transition-colors [-webkit-app-region:no-drag] dark:text-gray-100"
          :class="counts.completedUnread === 0 ? 'cursor-default opacity-35' : 'cursor-pointer hover:bg-elevated'"
          :aria-label="t('status.completedUnread')"
          @click="$emit('status-click', 'completedUnread', $event)"
        >
          <span class="h-2.5 w-2.5 flex-none rounded-full bg-emerald-500" />
          <span class="numeric-mono leading-none">{{ formatStatusCount(counts.completedUnread) }}</span>
        </button>
        <button
          type="button"
          class="-mx-1.5 inline-flex min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs text-slate-900 transition-colors [-webkit-app-region:no-drag] dark:text-gray-100"
          :class="counts.failed === 0 ? 'cursor-default opacity-35' : 'cursor-pointer hover:bg-elevated'"
          :aria-label="t('status.failedTooltip')"
          @click="$emit('status-click', 'failed', $event)"
        >
          <span class="h-2.5 w-2.5 flex-none rounded-full bg-red-500" />
          <span class="numeric-mono leading-none">{{ formatStatusCount(counts.failed) }}</span>
        </button>
      </div>

      <div class="h-4 w-px flex-none bg-gray-200 dark:bg-neutral-800" />

      <div class="flex min-w-0 flex-none items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap">
        <button
          type="button"
          class="group inline-flex text-[11px] h-4 w-6 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-gray-500 [-webkit-app-region:no-drag] hover:text-gray-950 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:text-gray-100"
          :aria-label="toggleModeLabel"
          @click="$emit('toggle-mode')"
        >
          <span class="leading-none group-hover:hidden">{{ usageLabel }}</span>
          <UIcon name="i-lucide-arrow-right-left" class="hidden h-3 w-3 text-gray-500 group-hover:block dark:text-gray-400" />
        </button>
        <template v-if="rateLimits?.primary || rateLimits?.secondary">
          <span v-if="rateLimits?.primary" class="inline-flex items-baseline gap-0.5 text-gray-500 dark:text-gray-400">
            <span>5h</span>
            <UTooltip :text="formatRateLimitReset(rateLimits.primary)" :content="percentTooltipContent">
              <span class="numeric-mono [-webkit-app-region:no-drag]" :class="usageTextClass(rateLimits.primary)">{{ usagePercent(rateLimits.primary) }}%</span>
            </UTooltip>
          </span>
          <span v-if="rateLimits?.secondary" class="inline-flex items-baseline gap-0.5 text-gray-500 dark:text-gray-400">
            <span>7d</span>
            <UTooltip :text="formatRateLimitReset(rateLimits.secondary)" :content="percentTooltipContent">
              <span class="numeric-mono [-webkit-app-region:no-drag]" :class="usageTextClass(rateLimits.secondary)">{{ usagePercent(rateLimits.secondary) }}%</span>
            </UTooltip>
          </span>
        </template>
        <span v-else class="text-gray-500 dark:text-gray-400">--</span>
      </div>

      <div v-if="showPrompts" class="h-4 w-px flex-none bg-gray-200 dark:bg-neutral-800" />

      <button
        v-if="showPrompts"
        type="button"
        class="inline-flex size-3.5 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-gray-500 [-webkit-app-region:no-drag] hover:text-gray-950 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:text-gray-100"
        :aria-label="t('panels.prompts')"
        @click="$emit('prompts-click', $event)"
      >
        <UIcon name="i-lucide-pencil-sparkles" />
      </button>
    </div>
    <div class="flex h-full w-[18px] flex-none items-center justify-center [-webkit-app-region:no-drag]">
      <button
        type="button"
        class="inline-flex size-3.5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-gray-500 [-webkit-app-region:no-drag] hover:text-gray-950 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:text-gray-100"
        :aria-label="t('mini.expandFull')"
        @click="$emit('expand')"
      >
        <UIcon name="i-lucide-picture-in-picture-2" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppLocale, PromptTemplate, RateLimitSummary, RateLimitWindow, UsageDisplayMode } from '@/types/sidecar'
import { formatResetDateTime } from '@/utils/format'
import { usageToneClass } from '@/utils/tailwind'

type StatusClickKey = 'completedUnread' | 'running' | 'waiting' | 'failed'
type MiniDragPoint = { screenX: number, screenY: number }

const percentTooltipContent = {
  side: 'left',
  sideOffset: 4,
  collisionPadding: 4
} as const

const { t, locale } = useI18n()
const appLocale = computed<AppLocale>(() => locale.value === 'zh' ? 'zh' : 'en')
let activeDragPointerId: number | null = null

defineEmits<{
  expand: []
  'prompts-click': [event: MouseEvent]
  'status-click': [status: StatusClickKey, event: MouseEvent]
  'toggle-mode': []
}>()

const props = defineProps<{
  counts: {
    completedUnread: number
    running: number
    waiting: number
    failed: number
  }
  rateLimits: RateLimitSummary | null
  promptTemplates: PromptTemplate[]
  showPrompts: boolean
  usageMode: UsageDisplayMode
}>()

const getMiniDragPoint = (event: PointerEvent): MiniDragPoint => ({
  screenX: event.screenX,
  screenY: event.screenY
})

const isInteractiveTarget = (target: EventTarget | null) => {
  return target instanceof Element && Boolean(target.closest('button, a, input, textarea, select, [role="button"], [data-mini-drag-ignore="true"]'))
}

const releasePointerCapture = (event: PointerEvent) => {
  if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

const handlePointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary || isInteractiveTarget(event.target)) {
    return
  }

  activeDragPointerId = event.pointerId
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  event.preventDefault()
  window.sidecar.startMiniDrag(getMiniDragPoint(event))
}

const handlePointerMove = (event: PointerEvent) => {
  if (activeDragPointerId !== event.pointerId) {
    return
  }

  if (event.buttons === 0) {
    handlePointerEnd(event)
    return
  }

  event.preventDefault()
  window.sidecar.moveMiniDrag(getMiniDragPoint(event))
}

const handlePointerEnd = (event: PointerEvent) => {
  if (activeDragPointerId !== event.pointerId) {
    return
  }

  activeDragPointerId = null
  releasePointerCapture(event)
  event.preventDefault()
  window.sidecar.endMiniDrag(getMiniDragPoint(event))
}

const handlePointerCaptureLost = (event: PointerEvent) => {
  if (activeDragPointerId !== event.pointerId) {
    return
  }

  activeDragPointerId = null
  window.sidecar.endMiniDrag(getMiniDragPoint(event))
}

const usageLabel = computed(() => props.usageMode === 'remaining' ? t('usage.remaining') : t('usage.used'))

const toggleModeLabel = computed(() => props.usageMode === 'remaining' ? t('usage.toggleToUsed') : t('usage.toggleToRemaining'))

const formatStatusCount = (count: number) => count > 99 ? '99' : String(count)

const usagePercent = (window: RateLimitWindow) => {
  return props.usageMode === 'remaining' ? window.remainingPercent : window.usedPercent
}

const usageTextClass = (window: RateLimitWindow) => {
  return usageToneClass(window.usedPercent).text
}

const formatRateLimitReset = (window: RateLimitWindow) => {
  return `${t('usage.reset')} ${formatResetDateTime(window.resetsAt, appLocale.value)}`
}
</script>
