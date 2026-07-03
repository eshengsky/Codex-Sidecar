const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appSource = fs.readFileSync(path.join(__dirname, 'App.vue'), 'utf8')
const envSource = fs.readFileSync(path.join(__dirname, 'env.d.ts'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')

test('message navigation opens only the Codex thread without simulated in-thread search', () => {
  assert.doesNotMatch(appSource, /openThreadAndSearch/)
  assert.doesNotMatch(appSource, /checkAccessibilityPermission/)
  assert.doesNotMatch(appSource, /navigationAccessibility/)
  assert.doesNotMatch(preloadSource, /openThreadAndSearch|checkAccessibilityPermission/)
  assert.doesNotMatch(envSource, /openThreadAndSearch|checkAccessibilityPermission/)
  assert.doesNotMatch(mainSource, /openThreadAndSearch|checkAccessibilityPermission|searchCodexCurrentThread|ACCESSIBILITY_KEYSTROKE_CHECK_SCRIPT|runAppleScript|osascript/)
  assert.doesNotMatch(messagesSource, /accessibilityTitle|accessibilityDescription|辅助功能|Accessibility permission/)

  assert.match(appSource, /await window\.sidecar\.openThread\(bookmark\.threadId\)/)
  assert.match(appSource, /await window\.sidecar\.openThread\(threadId\)/)
})
