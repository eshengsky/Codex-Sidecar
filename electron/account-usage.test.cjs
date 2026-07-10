const assert = require('node:assert/strict')
const test = require('node:test')

const { normalizeAccountUsageResponse } = require('./account-usage.cjs')

test('normalizes account token usage response for renderer consumption', () => {
  const usage = normalizeAccountUsageResponse({
    summary: {
      lifetimeTokens: '123456789',
      peakDailyTokens: 9000n,
      longestRunningTurnSec: 360,
      currentStreakDays: 4,
      longestStreakDays: 9
    },
    dailyUsageBuckets: [
      { startDate: '2026-07-09T00:00:00Z', tokens: 1000n },
      { startDate: '2026-07-08', tokens: '800' },
      { startDate: '', tokens: 99 },
      { startDate: '2026-07-07', tokens: -50 }
    ]
  }, 1700000000000)

  assert.deepEqual(usage, {
    summary: {
      lifetimeTokens: 123456789,
      peakDailyTokens: 9000,
      longestRunningTurnSec: 360,
      currentStreakDays: 4,
      longestStreakDays: 9
    },
    dailyUsageBuckets: [
      { startDate: '2026-07-09', tokens: 1000 },
      { startDate: '2026-07-08', tokens: 800 },
      { startDate: '2026-07-07', tokens: 0 }
    ],
    updatedAt: 1700000000000
  })
})

test('returns null for missing account usage payload', () => {
  assert.equal(normalizeAccountUsageResponse(null), null)
  assert.equal(normalizeAccountUsageResponse({ dailyUsageBuckets: [] }), null)
})
