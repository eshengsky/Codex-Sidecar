const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const miniBarSource = fs.readFileSync(path.join(__dirname, 'components/MiniBar.vue'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')

test('mini bar shows independent pace indicators with duration-based window labels', () => {
  assert.match(miniBarSource, /isRateLimitUsageAheadOfTime/)
  assert.match(miniBarSource, /v-if="isUsageAheadOfTime\(rateLimits\.primary\)"/)
  assert.match(miniBarSource, /v-if="isUsageAheadOfTime\(rateLimits\.secondary\)"/)
  assert.match(miniBarSource, /formatRateLimitWindowShortLabel/)
  assert.match(miniBarSource, /usage\.timePaceAhead/)
  assert.doesNotMatch(miniBarSource, /usage\.timePaceAheadWindow/)

  assert.match(messagesSource, /timePaceAhead: 'Token use outpaces time'/)
  assert.match(messagesSource, /timePaceAhead: 'Token 消耗快于时间进度'/)
  assert.doesNotMatch(messagesSource, /timePaceAheadWindow/)
})

test('mini bar uses four Nuxt tooltips positioned on the left', () => {
  assert.equal((miniBarSource.match(/<UTooltip\b/g) || []).length, 4)
  assert.equal((miniBarSource.match(/:content="miniTooltipContent"/g) || []).length, 4)
  assert.equal((miniBarSource.match(/:text="formatRateLimitReset\(rateLimits\.(?:primary|secondary)\)"/g) || []).length, 2)
  assert.equal((miniBarSource.match(/:text="formatUsagePaceTooltip\(\)"/g) || []).length, 2)
  assert.equal((miniBarSource.match(/:aria-label="formatRateLimitReset\(rateLimits\.(?:primary|secondary)\)"/g) || []).length, 2)
  assert.equal((miniBarSource.match(/:aria-label="formatUsagePaceTooltip\(\)"/g) || []).length, 2)
  assert.match(miniBarSource, /const miniTooltipContent = \{[\s\S]*?side: 'left',[\s\S]*?sideOffset: 4,[\s\S]*?collisionPadding: 4[\s\S]*?\} as const/)
  assert.doesNotMatch(miniBarSource, /:title=/)
  assert.doesNotMatch(miniBarSource, /v-mini-tooltip=/)
})
