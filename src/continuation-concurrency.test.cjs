const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appSource = fs.readFileSync(path.join(__dirname, 'App.vue'), 'utf8')
const threadsPanelSource = fs.readFileSync(path.join(__dirname, 'components/panels/ThreadsPanel.vue'), 'utf8')
const bookmarksPanelSource = fs.readFileSync(path.join(__dirname, 'components/panels/BookmarksPanel.vue'), 'utf8')

test('continuation running state is tracked per thread so other threads stay enabled', () => {
  assert.match(appSource, /const continuationThreadIds = ref<string\[\]>\(\[\]\)/)
  assert.match(appSource, /:continuation-thread-ids="continuationThreadIds"/)

  for (const source of [threadsPanelSource, bookmarksPanelSource]) {
    assert.match(source, /continuationThreadIds: string\[\]/)
    assert.match(source, /continuationThreadIdSet\.has\(thread\.id\)/)
    assert.doesNotMatch(source, /Boolean\(continuationThreadId\) && continuationThreadId !== thread\.id/)
  }
})
