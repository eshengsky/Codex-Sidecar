const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appSource = fs.readFileSync(path.join(__dirname, 'App.vue'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')

test('copy last continuation button shows upward tooltip with generated time', () => {
  assert.match(appSource, /<UTooltip[\s\S]*:content="\{ side: 'top'/)
  assert.match(appSource, /:text="formatContinuationGeneratedAt\(pendingContinuationResult\.completedAt\)"/)
  assert.match(appSource, /formatContinuationGeneratedAt/)
  assert.match(messagesSource, /generatedAt:/)
  assert.match(messagesSource, /generatedAtUnknown:/)
})

test('copied continuation wrappers use the UI language while preserving automatic response-language detection', () => {
  assert.match(appSource, /createContinuationPromptText\(result\.summary, appLocale\.value\)/)
  assert.doesNotMatch(appSource, /await window\.sidecar\.copyText\(result\.prompt\)/)
  assert.match(appSource, /不要根据本段接续说明的语言决定回答语言/)
  assert.match(appSource, /Do not use the language of these continuation instructions/)
  assert.doesNotMatch(appSource, /Sidecar UI/)
  assert.match(appSource, /用户明确要求、原始问题、历史对话上下文和目标产物/)
  assert.match(appSource, /user's explicit request, the original request, conversation context, and target artifact/)
})
