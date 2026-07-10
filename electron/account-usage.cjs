const DATE_KEY_PATTERN = /^(\d{4}-\d{2}-\d{2})/

const toNonNegativeNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

const normalizeDateKey = value => {
  if (typeof value !== 'string') {
    return ''
  }

  const match = DATE_KEY_PATTERN.exec(value)
  return match ? match[1] : ''
}

const normalizeAccountUsageSummary = summary => {
  if (!summary || typeof summary !== 'object') {
    return null
  }

  return {
    lifetimeTokens: toNonNegativeNumber(summary.lifetimeTokens),
    peakDailyTokens: toNonNegativeNumber(summary.peakDailyTokens),
    longestRunningTurnSec: toNonNegativeNumber(summary.longestRunningTurnSec),
    currentStreakDays: toNonNegativeNumber(summary.currentStreakDays),
    longestStreakDays: toNonNegativeNumber(summary.longestStreakDays)
  }
}

const normalizeAccountUsageBuckets = buckets => {
  if (!Array.isArray(buckets)) {
    return []
  }

  return buckets
    .map(bucket => ({
      startDate: normalizeDateKey(bucket?.startDate),
      tokens: toNonNegativeNumber(bucket?.tokens)
    }))
    .filter(bucket => bucket.startDate)
}

const normalizeAccountUsageResponse = (response, updatedAt = Date.now()) => {
  const summary = normalizeAccountUsageSummary(response?.summary)

  if (!summary) {
    return null
  }

  return {
    summary,
    dailyUsageBuckets: normalizeAccountUsageBuckets(response?.dailyUsageBuckets),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  }
}

module.exports = {
  normalizeAccountUsageResponse
}
