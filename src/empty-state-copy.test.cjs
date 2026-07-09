const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const promptsPanelSource = fs.readFileSync(path.join(__dirname, 'components/panels/PromptsPanel.vue'), 'utf8')
const explorationsPanelSource = fs.readFileSync(path.join(__dirname, 'components/panels/ExplorationsPanel.vue'), 'utf8')
const messagesSource = fs.readFileSync(path.join(__dirname, 'i18n/messages.ts'), 'utf8')

test('prompt and exploration empty states separate first-use guidance from search no-results copy', () => {
  assert.match(promptsPanelSource, /:title="promptEmptyTitle"/)
  assert.match(promptsPanelSource, /:description="promptEmptyDescription"/)
  assert.match(promptsPanelSource, /const hasPromptSearch = computed\(\(\) => searchTerm\.value\.trim\(\)\.length > 0\)/)
  assert.match(promptsPanelSource, /hasPromptSearch\.value \? t\('prompts\.emptySearchTitle'\) : t\('prompts\.emptyTitle'\)/)
  assert.match(promptsPanelSource, /hasPromptSearch\.value \? t\('prompts\.emptySearchDescription'\) : t\('prompts\.emptyDescription'\)/)

  assert.match(explorationsPanelSource, /:title="explorationEmptyTitle"/)
  assert.match(explorationsPanelSource, /:description="explorationEmptyDescription"/)
  assert.match(promptsPanelSource, /class="min-h-\[220px\] self-center"/)
  assert.match(explorationsPanelSource, /class="min-h-\[220px\] self-center"/)
  assert.match(explorationsPanelSource, /const hasExplorationSearch = computed\(\(\) => searchTerm\.value\.trim\(\)\.length > 0\)/)
  assert.match(explorationsPanelSource, /hasExplorationSearch\.value \? t\('explorations\.emptySearchTitle'\) : t\('explorations\.emptyTitle'\)/)
  assert.match(explorationsPanelSource, /hasExplorationSearch\.value \? t\('explorations\.emptySearchDescription'\) : t\('explorations\.emptyDescription'\)/)

  assert.match(messagesSource, /emptyTitle: '还没有指令'/)
  assert.match(messagesSource, /emptyDescription: '指令用于保存临时或常用提示，一键复制到 Codex 使用。'/)
  assert.match(messagesSource, /emptySearchTitle: '没有匹配的指令'/)
  assert.match(messagesSource, /emptySearchDescription: '换个关键词试试，或新增一条指令。'/)

  assert.match(messagesSource, /emptyTitle: '还没有优选'/)
  assert.match(messagesSource, /emptyDescription: '优选用于并行生成多个只读候选，再汇总成结果。适合方案判断和复杂问题。'/)
  assert.match(messagesSource, /emptySearchTitle: '没有匹配的优选'/)
  assert.match(messagesSource, /emptySearchDescription: '换个关键词试试，或新建一次优选。'/)
})

test('prompt modal labels use the same emphasis as exploration modal labels', () => {
  const promptModalBody = promptsPanelSource.slice(
    promptsPanelSource.indexOf('<template #body>'),
    promptsPanelSource.indexOf('<template #footer>')
  )

  assert.match(explorationsPanelSource, /<label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t\('explorations\.context'\) }}<\/label>/)
  assert.match(promptModalBody, /<label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t\('prompts\.titleLabel'\) }}<\/label>/)
  assert.match(promptModalBody, /<label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t\('prompts\.bodyLabel'\) }}<\/label>/)
  assert.doesNotMatch(promptModalBody, /font-normal text-gray-500 dark:text-gray-400/)
})
