const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appSource = fs.readFileSync(path.join(__dirname, 'App.vue'), 'utf8')
const envSource = fs.readFileSync(path.join(__dirname, 'env.d.ts'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')

test('message index opens only the Codex thread without simulated in-thread search', () => {
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

test('message index bookmark button sits next to the user message bubble', () => {
  const navigationTemplate = appSource.slice(
    appSource.indexOf('v-for="turnPreview in filteredNavigationTurnPreviews"'),
    appSource.indexOf('</UDrawer>')
  )

  assert.match(
    navigationTemplate,
    /<div class="flex max-w-full items-center justify-end gap-1\.5">\s*<UTooltip[\s\S]*?<\/UTooltip>\s*<button[\s\S]*?turnPreview\.userPreview/
  )
  assert.doesNotMatch(
    navigationTemplate,
    /<div class="flex min-w-0 max-w-\[86%\] flex-col items-end gap-1">\s*<button/
  )
})

test('message index assistant preview spans the full turn width without a bubble background', () => {
  const navigationTemplate = appSource.slice(
    appSource.indexOf('v-for="turnPreview in filteredNavigationTurnPreviews"'),
    appSource.indexOf('</UDrawer>')
  )
  const assistantPreviewMatch = navigationTemplate.match(/v-if="turnPreview\.assistantPreview"\s+class="([^"]+)"/)

  assert.match(
    navigationTemplate,
    /class="flex w-full max-w-full flex-col items-end gap-1 self-end"/
  )
  assert.ok(assistantPreviewMatch)
  assert.match(assistantPreviewMatch[1], /(?:^|\s)w-full(?:\s|$)/)
  assert.doesNotMatch(assistantPreviewMatch[1], /(?:^|\s)max-w-\[86%\](?:\s|$)/)
  assert.doesNotMatch(assistantPreviewMatch[1], /(?:^|\s)(?:dark:)?bg-[^\s]+/)
})
