const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const panelSource = fs.readFileSync(path.join(__dirname, 'components/panels/UsageStatsPanel.vue'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')

test('usage trend average label follows the selected dimension window', () => {
  assert.match(panelSource, /ACCOUNT_USAGE_TREND_AVERAGE_WINDOWS/)
  assert.match(panelSource, /averageLabel = computed/)
  assert.match(panelSource, /usageStats\.averageLabels/)
  assert.match(panelSource, /label: averageLabel\.value/)

  assert.match(messagesSource, /day: '\{count\}-day avg'/)
  assert.match(messagesSource, /week: '\{count\}-week avg'/)
  assert.match(messagesSource, /month: '\{count\}-month avg'/)
  assert.match(messagesSource, /day: '\{count\} 日均线'/)
  assert.match(messagesSource, /week: '\{count\} 周均线'/)
  assert.match(messagesSource, /month: '\{count\} 月均线'/)
})

test('usage stats panel does not render the today status card', () => {
  assert.doesNotMatch(panelSource, /usageStats\.todayStatus/)
  assert.doesNotMatch(panelSource, /todayStatusTitle/)
  assert.doesNotMatch(panelSource, /todayStatusDescription/)
  assert.doesNotMatch(panelSource, /todayStatusClass/)
  assert.doesNotMatch(panelSource, /TodayUsageLevel/)
})
