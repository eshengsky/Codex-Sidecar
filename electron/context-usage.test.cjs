const assert = require('node:assert/strict')
const test = require('node:test')

const {
  contextUsageFromAppServerTokenUsage
} = require('./context-usage.cjs')

test('app-server token usage uses the current context window usage', () => {
  const usage = contextUsageFromAppServerTokenUsage(
    'thread-1',
    {
      total: {
        totalTokens: 1798324
      },
      last: {
        totalTokens: 124726
      },
      modelContextWindow: 258400
    },
    1700000000000
  )

  assert.deepEqual(usage, {
    threadId: 'thread-1',
    percent: 48,
    totalTokens: 124726,
    modelContextWindow: 258400,
    updatedAt: 1700000000000
  })
})
