import type { AppLocale } from '@/types/sidecar'

const intlLocale = (locale: AppLocale) => locale === 'zh' ? 'zh-CN' : 'en-US'

export const formatRelativeTime = (value: number | null, locale: AppLocale = 'zh') => {
  if (!value) {
    return locale === 'zh' ? '未知' : 'Unknown'
  }

  const diff = Date.now() - value
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) {
    return locale === 'zh' ? '刚刚' : 'Just now'
  }

  const formatter = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })

  if (diff < hour) {
    return formatter.format(-Math.floor(diff / minute), 'minute')
  }

  if (diff < day) {
    return formatter.format(-Math.floor(diff / hour), 'hour')
  }

  return formatter.format(-Math.floor(diff / day), 'day')
}

export const formatResetTime = (value: number | null | undefined, locale: AppLocale = 'zh') => {
  if (!value) {
    return '--:--'
  }

  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

export const formatResetDate = (value: number | null | undefined, locale: AppLocale = 'zh') => {
  if (!value) {
    return '--'
  }

  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    day: 'numeric'
  }).format(new Date(value))
}

export const formatResetDateTime = (value: number | null | undefined, locale: AppLocale = 'zh') => {
  if (!value) {
    return locale === 'zh' ? '重置时间未知' : 'Reset time unknown'
  }

  const date = new Date(value)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  let dateLabel = formatResetDate(value, locale)

  if (isSameLocalDate(date, today)) {
    dateLabel = locale === 'zh' ? '今天' : 'Today'
  } else if (isSameLocalDate(date, tomorrow)) {
    dateLabel = locale === 'zh' ? '明天' : 'Tomorrow'
  }

  return `${dateLabel} ${formatResetTime(value, locale)}`
}

const formatTwoDigits = (value: number) => {
  return String(value).padStart(2, '0')
}

const isSameLocalDate = (date: Date, reference: Date) => {
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate()
}

export const formatNavigationMessageTime = (value: number | null | undefined, locale: AppLocale = 'zh') => {
  if (!value) {
    return '--:--'
  }

  const date = new Date(value)
  const time = `${formatTwoDigits(date.getHours())}:${formatTwoDigits(date.getMinutes())}`

  if (isSameLocalDate(date, new Date())) {
    return time
  }

  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

export const formatNumber = (value: number | null | undefined, locale: AppLocale = 'zh') => {
  if (value == null || Number.isNaN(value)) {
    return '0'
  }

  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}
