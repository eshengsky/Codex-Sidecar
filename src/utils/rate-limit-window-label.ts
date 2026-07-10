import type { AppLocale } from '@/types/sidecar'

const HOUR_MINS = 60
const DAY_MINS = 24 * HOUR_MINS
const WEEK_MINS = 7 * DAY_MINS
const MONTH_MINS = 30 * DAY_MINS

const normalizeWindowDurationMins = (value: number | null | undefined) => {
  const minutes = Number(value)

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null
  }

  return Math.round(minutes)
}

const formatLongUnit = (
  value: number,
  locale: AppLocale,
  zhUnit: string,
  enSingular: string,
  enPlural: string
) => {
  if (locale === 'zh') {
    return `${value} ${zhUnit}`
  }

  return `${value} ${value === 1 ? enSingular : enPlural}`
}

export const formatRateLimitWindowLabel = (
  windowDurationMins: number | null | undefined,
  locale: AppLocale = 'zh',
  fallbackLabel: string | null | undefined = null
) => {
  const minutes = normalizeWindowDurationMins(windowDurationMins)

  if (minutes === null) {
    return fallbackLabel || (locale === 'zh' ? '额度窗口' : 'Usage window')
  }

  if (minutes % MONTH_MINS === 0) {
    return formatLongUnit(minutes / MONTH_MINS, locale, '个月', 'month', 'months')
  }

  if (minutes % WEEK_MINS === 0) {
    return formatLongUnit(minutes / WEEK_MINS, locale, '周', 'week', 'weeks')
  }

  if (minutes % DAY_MINS === 0) {
    return formatLongUnit(minutes / DAY_MINS, locale, '天', 'day', 'days')
  }

  if (minutes % HOUR_MINS === 0) {
    return formatLongUnit(minutes / HOUR_MINS, locale, '小时', 'hour', 'hours')
  }

  return formatLongUnit(minutes, locale, '分钟', 'minute', 'minutes')
}

export const formatRateLimitWindowShortLabel = (
  windowDurationMins: number | null | undefined,
  fallbackLabel: string | null | undefined = '--'
) => {
  const minutes = normalizeWindowDurationMins(windowDurationMins)

  if (minutes === null) {
    return fallbackLabel || '--'
  }

  if (minutes % DAY_MINS === 0) {
    return `${minutes / DAY_MINS}d`
  }

  if (minutes % HOUR_MINS === 0) {
    return `${minutes / HOUR_MINS}h`
  }

  return `${minutes}m`
}

export const shouldShowRateLimitResetDate = (windowDurationMins: number | null | undefined) => {
  const minutes = normalizeWindowDurationMins(windowDurationMins)
  return minutes !== null && minutes >= DAY_MINS
}
