export type AccountUsageCardKey = 'today' | 'yesterday' | 'week' | 'month'
export type AccountUsageTrendPeriod = 'day' | 'week' | 'month'
export type TodayUsageLevel = 'insufficient' | 'low' | 'normal' | 'high' | 'veryHigh'

export interface AccountUsageDailyBucketInput {
  startDate: string
  tokens: number | bigint | string
}

export interface AccountUsageInput {
  dailyUsageBuckets?: AccountUsageDailyBucketInput[] | null
  localTodayEstimate?: AccountUsageLocalTodayEstimateInput | null
}

export interface AccountUsageLocalTodayEstimateInput {
  date: string
  tokens: number | bigint | string
  updatedAt: number | null
  threadCount: number
  eventCount: number
  source: 'localTranscript'
}

export interface AccountUsageStatsOptions {
  nowMs?: number
}

export interface AccountUsageCard {
  key: AccountUsageCardKey
  tokens: number
  estimated: boolean
  date: string | null
}

export interface AccountUsageChartPoint {
  date: string
  tokens: number
  averageTokens: number | null
  estimated: boolean
}

export interface AccountUsageTrendPoint extends AccountUsageChartPoint {
  endDate: string
  partial: boolean
}

export interface TodayUsageStatus {
  level: TodayUsageLevel
  ratio: number | null
  averageTokens: number | null
  yesterdayDeltaPercent: number | null
}

export interface AccountUsageStats {
  cards: AccountUsageCard[]
  chartPoints: AccountUsageChartPoint[]
  trendSeries: Record<AccountUsageTrendPeriod, AccountUsageTrendPoint[]>
  todayStatus: TodayUsageStatus
}

export const ACCOUNT_USAGE_TREND_AVERAGE_WINDOWS: Record<AccountUsageTrendPeriod, number> = {
  day: 14,
  week: 8,
  month: 6
}

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})/

const toFiniteNumber = (value: number | bigint | string | null | undefined) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const clampNonNegative = (value: number | bigint | string | null | undefined) => {
  const number = toFiniteNumber(value)
  return number == null ? 0 : Math.max(0, Math.round(number))
}

const toDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseDateKey = (value: string) => {
  const match = DATE_KEY_RE.exec(value)

  if (!match) {
    return null
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}

const dateFromKey = (key: string) => {
  const match = DATE_KEY_RE.exec(key)

  if (!match) {
    return null
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

const addDays = (key: string, days: number) => {
  const date = dateFromKey(key)

  if (!date) {
    return key
  }

  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

const getMondayKey = (date: Date) => {
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + offset)
  return toDateKey(monday)
}

const getMonthStartKey = (date: Date) => {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1))
}

const getMonthEndKey = (date: Date) => {
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

interface NormalizedBucket {
  tokens: number
  estimated: boolean
}

const normalizeBuckets = (buckets: AccountUsageDailyBucketInput[] | null | undefined) => {
  const byDate = new Map<string, NormalizedBucket>()

  for (const bucket of buckets || []) {
    const key = parseDateKey(bucket.startDate)

    if (!key) {
      continue
    }

    byDate.set(key, {
      tokens: (byDate.get(key)?.tokens || 0) + clampNonNegative(bucket.tokens),
      estimated: false
    })
  }

  return byDate
}

const withLocalTodayEstimate = (
  byDate: Map<string, NormalizedBucket>,
  estimate: AccountUsageLocalTodayEstimateInput | null | undefined,
  todayKey: string
) => {
  const effective = new Map(byDate)
  const estimateDateKey = parseDateKey(estimate?.date || '')

  if (!effective.has(todayKey) && estimateDateKey === todayKey) {
    effective.set(todayKey, {
      tokens: clampNonNegative(estimate?.tokens),
      estimated: true
    })
  }

  return effective
}

const getTokens = (byDate: Map<string, NormalizedBucket>, key: string) => {
  return byDate.get(key)?.tokens || 0
}

const isEstimated = (byDate: Map<string, NormalizedBucket>, key: string) => {
  return byDate.get(key)?.estimated === true
}

const sumRange = (byDate: Map<string, NormalizedBucket>, fromKey: string, toKey: string) => {
  let total = 0
  let estimated = false
  let key = fromKey

  while (key <= toKey) {
    const bucket = byDate.get(key)

    if (bucket) {
      total += bucket.tokens
      estimated = estimated || bucket.estimated
    }

    key = addDays(key, 1)
  }

  return {
    total,
    estimated
  }
}

const roundRatio = (value: number) => {
  return Math.round(value * 10) / 10
}

const previousDays = (todayKey: string, count: number) => {
  return Array.from({ length: count }, (_, index) => addDays(todayKey, index - count))
}

const getTodayStatus = (byDate: Map<string, NormalizedBucket>, todayKey: string): TodayUsageStatus => {
  const todayTokens = getTokens(byDate, todayKey)
  const yesterdayTokens = getTokens(byDate, addDays(todayKey, -1))
  const historyKeys = previousDays(todayKey, 7)
  const knownHistoryKeys = historyKeys.filter(key => byDate.has(key))

  if (knownHistoryKeys.length < 3) {
    return {
      level: 'insufficient',
      ratio: null,
      averageTokens: null,
      yesterdayDeltaPercent: yesterdayTokens > 0 ? Math.round(((todayTokens - yesterdayTokens) / yesterdayTokens) * 100) : null
    }
  }

  const averageTokens = Math.round(historyKeys.reduce((total, key) => total + getTokens(byDate, key), 0) / historyKeys.length)

  if (averageTokens <= 0) {
    return {
      level: 'insufficient',
      ratio: null,
      averageTokens: null,
      yesterdayDeltaPercent: yesterdayTokens > 0 ? Math.round(((todayTokens - yesterdayTokens) / yesterdayTokens) * 100) : null
    }
  }

  const ratio = roundRatio(todayTokens / averageTokens)
  const level: TodayUsageLevel = ratio < 0.7
    ? 'low'
    : ratio <= 1.5
      ? 'normal'
      : ratio <= 3
        ? 'high'
        : 'veryHigh'

  return {
    level,
    ratio,
    averageTokens,
    yesterdayDeltaPercent: yesterdayTokens > 0 ? Math.round(((todayTokens - yesterdayTokens) / yesterdayTokens) * 100) : null
  }
}

const getMovingAverage = (points: Array<{ date: string, tokens: number }>, index: number, windowSize: number) => {
  if (index < 2) {
    return null
  }

  const window = points.slice(Math.max(0, index - windowSize + 1), index + 1)
  return Math.round(window.reduce((total, point) => total + point.tokens, 0) / window.length)
}

const getTrendPeriodBounds = (dateKey: string, period: AccountUsageTrendPeriod) => {
  const date = dateFromKey(dateKey)

  if (!date) {
    return {
      date: dateKey,
      endDate: dateKey
    }
  }

  if (period === 'week') {
    const startDate = getMondayKey(date)

    return {
      date: startDate,
      endDate: addDays(startDate, 6)
    }
  }

  if (period === 'month') {
    return {
      date: getMonthStartKey(date),
      endDate: getMonthEndKey(date)
    }
  }

  return {
    date: dateKey,
    endDate: dateKey
  }
}

const buildTrendSeries = (
  points: Array<{ date: string, tokens: number, estimated: boolean }>,
  period: AccountUsageTrendPeriod,
  todayKey: string
) => {
  const byPeriod = new Map<string, Omit<AccountUsageTrendPoint, 'averageTokens'>>()

  for (const point of points) {
    const bounds = getTrendPeriodBounds(point.date, period)
    const current = byPeriod.get(bounds.date)

    byPeriod.set(bounds.date, {
      date: bounds.date,
      endDate: bounds.endDate,
      tokens: (current?.tokens || 0) + point.tokens,
      estimated: Boolean(current?.estimated || point.estimated),
      partial: bounds.date <= todayKey && todayKey <= bounds.endDate
    })
  }

  const sorted = Array.from(byPeriod.values())
    .sort((left, right) => left.date.localeCompare(right.date))

  return sorted.map((point, index) => ({
    ...point,
    averageTokens: getMovingAverage(sorted, index, ACCOUNT_USAGE_TREND_AVERAGE_WINDOWS[period])
  }))
}

export const buildAccountUsageStats = (
  usage: AccountUsageInput | null | undefined,
  options: AccountUsageStatsOptions
): AccountUsageStats => {
  const now = new Date(options.nowMs || Date.now())
  const todayKey = toDateKey(now)
  const yesterdayKey = addDays(todayKey, -1)
  const weekStartKey = getMondayKey(now)
  const monthStartKey = getMonthStartKey(now)
  const officialByDate = normalizeBuckets(usage?.dailyUsageBuckets)
  const byDate = withLocalTodayEstimate(officialByDate, usage?.localTodayEstimate, todayKey)
  const sortedPoints = Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bucket]) => ({ date, tokens: bucket.tokens, estimated: bucket.estimated }))
  const trendSeries = {
    day: buildTrendSeries(sortedPoints, 'day', todayKey),
    week: buildTrendSeries(sortedPoints, 'week', todayKey),
    month: buildTrendSeries(sortedPoints, 'month', todayKey)
  }
  const todayTokens = getTokens(byDate, todayKey)
  const yesterdayTokens = getTokens(byDate, yesterdayKey)
  const weekUsage = sumRange(byDate, weekStartKey, todayKey)
  const monthUsage = sumRange(byDate, monthStartKey, todayKey)

  return {
    cards: [
      { key: 'today', tokens: todayTokens, estimated: isEstimated(byDate, todayKey), date: todayKey },
      { key: 'yesterday', tokens: yesterdayTokens, estimated: isEstimated(byDate, yesterdayKey), date: yesterdayKey },
      { key: 'week', tokens: weekUsage.total, estimated: weekUsage.estimated, date: null },
      { key: 'month', tokens: monthUsage.total, estimated: monthUsage.estimated, date: null }
    ],
    chartPoints: sortedPoints.map((point, index) => ({
      ...point,
      averageTokens: getMovingAverage(sortedPoints, index, ACCOUNT_USAGE_TREND_AVERAGE_WINDOWS.day)
    })),
    trendSeries,
    todayStatus: getTodayStatus(byDate, todayKey)
  }
}
