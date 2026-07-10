<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden pr-2.5 -mr-2.5 pb-2">
    <template v-if="loading && !accountUsage">
      <div class="flex flex-wrap gap-2">
        <USkeleton v-for="index in 4" :key="index" class="h-[78px] min-w-[132px] flex-1 basis-[calc(50%-0.25rem)] rounded-[9px]" />
      </div>
      <USkeleton class="h-[260px] rounded-[9px]" />
    </template>

    <UEmpty
      v-else-if="!accountUsage"
      :title="t('usageStats.emptyTitle')"
      :description="t('usageStats.emptyDescription')"
      variant="naked"
      size="sm"
      class="min-h-[260px] self-center"
    />

    <template v-else>
      <div class="flex min-w-0 flex-wrap gap-2">
        <article
          v-for="card in cards"
          :key="card.key"
          class="flex h-[78px] min-w-[132px] flex-1 basis-[calc(50%-0.25rem)] flex-col justify-between rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100"
        >
          <div class="flex min-w-0 items-center justify-between gap-2">
            <h3 class="m-0 text-xs font-semibold text-gray-500 dark:text-gray-400">{{ card.label }}</h3>
            <span v-if="card.dateLabel" class="numeric-mono flex-none text-[11px] leading-none font-semibold text-gray-400 dark:text-gray-500">
              {{ card.dateLabel }}
            </span>
            <UIcon v-else :name="card.icon" class="size-3.5 flex-none text-gray-400 dark:text-gray-500" />
          </div>
          <div class="min-w-0">
            <p class="numeric-mono m-0 truncate text-lg leading-tight">{{ card.estimated ? '≈' : '' }}{{ formatTokenCount(card.tokens) }}</p>
          </div>
        </article>
      </div>

      <article class="flex min-h-[292px] min-w-0 flex-col gap-2 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <div class="min-w-0 flex-1 basis-0">
            <h3 class="m-0 text-[13px] font-semibold">{{ t('usageStats.trend') }}</h3>
            <p class="m-0 mt-1 truncate text-[11px] leading-none text-gray-500 dark:text-gray-400">
              {{ t('usageStats.updatedAt', { time: updatedAtLabel }) }}
            </p>
          </div>
          <div class="flex flex-none flex-col items-end gap-1.5">
            <div class="flex rounded-lg bg-neutral-200/70 p-0.5 dark:bg-neutral-800" role="tablist" :aria-label="t('usageStats.dimension')">
              <button
                v-for="option in dimensionOptions"
                :key="option.value"
                type="button"
                class="inline-flex h-6 min-w-8 items-center justify-center rounded-[7px] border-0 px-2 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                :class="chartDimension === option.value ? 'bg-default text-gray-950 shadow-sm dark:bg-accented dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
                role="tab"
                :aria-selected="chartDimension === option.value"
                @click="chartDimension = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1">
          <Line :data="chartData" :options="chartOptions" />
        </div>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccountUsage, AppLocale } from '@/types/sidecar'
import {
  ACCOUNT_USAGE_TREND_AVERAGE_WINDOWS,
  buildAccountUsageStats,
  type AccountUsageCardKey,
  type AccountUsageTrendPeriod
} from '@/utils/account-usage'
import { formatNavigationMessageTime } from '@/utils/format'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const props = defineProps<{
  accountUsage: AccountUsage | null
  appLocale: AppLocale
  loading: boolean
}>()

const { t } = useI18n()
const chartDimension = ref<AccountUsageTrendPeriod>('day')

const trendPointLimits: Record<AccountUsageTrendPeriod, number> = {
  day: 30,
  week: 12,
  month: 12
}

const stats = computed(() => buildAccountUsageStats(props.accountUsage, {
}))

const cardMeta = computed<Record<AccountUsageCardKey, { label: string, icon: string }>>(() => ({
  today: { label: t('usageStats.cards.today'), icon: 'i-lucide-sun' },
  yesterday: { label: t('usageStats.cards.yesterday'), icon: 'i-lucide-history' },
  week: { label: t('usageStats.cards.week'), icon: 'i-lucide-calendar-days' },
  month: { label: t('usageStats.cards.month'), icon: 'i-lucide-calendar-range' }
}))

const cards = computed(() => stats.value.cards.map(card => ({
  ...card,
  ...cardMeta.value[card.key],
  dateLabel: formatCardDateLabel(card.date)
})))

const visiblePoints = computed(() => {
  const points = stats.value.trendSeries[chartDimension.value]
  const limit = trendPointLimits[chartDimension.value]

  return points.slice(-limit)
})

const dimensionOptions = computed<Array<{ value: AccountUsageTrendPeriod, label: string }>>(() => [
  { value: 'day', label: t('usageStats.dimensions.day') },
  { value: 'week', label: t('usageStats.dimensions.week') },
  { value: 'month', label: t('usageStats.dimensions.month') }
])

const averageLabel = computed(() => t(`usageStats.averageLabels.${chartDimension.value}`, {
  count: ACCOUNT_USAGE_TREND_AVERAGE_WINDOWS[chartDimension.value]
}))

const formatTokenCount = (value: number) => {
  return new Intl.NumberFormat(props.appLocale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)
}

const formatCompactDateLabel = (value: string) => {
  const parts = value.split('-')

  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value
}

const formatMonthLabel = (value: string) => {
  const parts = value.split('-')

  return parts.length === 3 ? `${parts[0]}/${parts[1]}` : value
}

const formatTrendPointLabel = (date: string) => {
  if (chartDimension.value === 'month') {
    return formatMonthLabel(date)
  }

  return formatCompactDateLabel(date)
}

const formatTrendTooltipTitle = (index: number) => {
  const point = visiblePoints.value[index]

  if (!point) {
    return ''
  }

  if (chartDimension.value === 'month') {
    return formatMonthLabel(point.date)
  }

  if (chartDimension.value === 'week') {
    return `${formatCompactDateLabel(point.date)} - ${formatCompactDateLabel(point.endDate)}`
  }

  return formatCompactDateLabel(point.date)
}

const formatCardDateLabel = (value: string | null) => {
  if (!value) {
    return ''
  }

  const parts = value.split('-')

  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value
}

const updatedAtLabel = computed(() => {
  return props.accountUsage?.updatedAt ? formatNavigationMessageTime(props.accountUsage.updatedAt, props.appLocale) : '--'
})

const chartData = computed<ChartData<'line'>>(() => ({
  labels: visiblePoints.value.map(point => formatTrendPointLabel(point.date)),
  datasets: [
    {
      label: t('usageStats.tokens'),
      data: visiblePoints.value.map(point => point.tokens),
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37, 99, 235, 0.12)',
      borderWidth: 2,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.35
    },
    {
      label: averageLabel.value,
      data: visiblePoints.value.map(point => point.averageTokens),
      borderColor: '#64748b',
      borderDash: [4, 4],
      borderWidth: 1.5,
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.25
    }
  ]
}))

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index'
  },
  plugins: {
    legend: {
      display: true,
      align: 'start',
      labels: {
        boxHeight: 6,
        boxWidth: 18,
        color: '#64748b',
        font: {
          size: 11,
          family: 'Geist Variable'
        }
      }
    },
    tooltip: {
      callbacks: {
        title: items => formatTrendTooltipTitle(items[0]?.dataIndex ?? -1),
        label: item => {
          const label = item.dataset.label || ''
          const point = visiblePoints.value[item.dataIndex]
          const prefix = item.datasetIndex === 0 && point?.estimated ? '≈' : ''
          return `${label}: ${prefix}${formatTokenCount(Number(item.parsed.y || 0))}`
        }
      }
    }
  },
  scales: {
    x: {
      grid: {
        display: false
      },
      ticks: {
        color: '#94a3b8',
        maxRotation: 0,
        autoSkip: true,
        font: {
          size: 10,
          family: 'Geist Variable'
        }
      }
    },
    y: {
      beginAtZero: true,
      border: {
        display: false
      },
      grid: {
        color: 'rgba(148, 163, 184, 0.18)'
      },
      ticks: {
        color: '#94a3b8',
        callback: value => formatTokenCount(Number(value)),
        font: {
          size: 10,
          family: 'Geist Variable'
        }
      }
    }
  }
}))
</script>
