const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const threadsPanelSource = fs.readFileSync(path.join(__dirname, 'components/panels/ThreadsPanel.vue'), 'utf8')
const threadsPanelTemplate = threadsPanelSource.slice(0, threadsPanelSource.indexOf('</template>') + '</template>'.length)

test('thread panel renders filtered conversations through the virtual scroll area', () => {
  assert.match(threadsPanelTemplate, /<UScrollArea[\s\S]*?:items="filteredThreads"[\s\S]*?:virtualize="threadListVirtualize"/)
  assert.match(threadsPanelTemplate, /<template #default="\{ item: thread \}">[\s\S]*?<ThreadRow/)
  assert.doesNotMatch(threadsPanelTemplate, /<ThreadRow\s+v-for=/)
})

test('thread virtualizer keys rows by the current filtered thread id', () => {
  assert.match(
    threadsPanelSource,
    /getItemKey:\s*\(index: number\)\s*=>\s*filteredThreads\.value\[index\]\?\.id\s*\?\?\s*index/
  )
})

test('only user-controlled search and filter changes reset the virtual list to the top', () => {
  assert.match(threadsPanelSource, /watch\(\[searchTerm, activeFilter\]/)
  assert.match(threadsPanelSource, /threadListRef\.value\?\.virtualizer\?\.scrollToIndex\(0, \{ align: 'start' \}\)/)
  assert.doesNotMatch(threadsPanelSource, /watch\(filteredThreads/)
})
