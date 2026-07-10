const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const usageMeterSource = fs.readFileSync(path.join(__dirname, 'components/UsageMeter.vue'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')

test('time reference tooltip uses direction-aware copy for used and remaining modes', () => {
  assert.match(usageMeterSource, /const timeReferenceTooltip = computed/)
  assert.match(usageMeterSource, /props\.mode === 'remaining'\s*\?\s*t\('usage\.timeReferenceTooltipRemaining'\)\s*:\s*t\('usage\.timeReferenceTooltipUsed'\)/)
  assert.match(usageMeterSource, /:text="timeReferenceTooltip"/)

  assert.match(messagesSource, /timeReferenceTooltipUsed: 'Above reference = faster token use'/)
  assert.match(messagesSource, /timeReferenceTooltipRemaining: 'Below reference = faster token use'/)
  assert.match(messagesSource, /timeReferenceTooltipUsed: '超过参考点表示 Token 消耗快于时间进度'/)
  assert.match(messagesSource, /timeReferenceTooltipRemaining: '低于参考点表示 Token 消耗快于时间进度'/)
  assert.doesNotMatch(messagesSource, /时间参考点：超过它表示/)
  assert.doesNotMatch(messagesSource, /时间参考点：低于它表示/)
})
