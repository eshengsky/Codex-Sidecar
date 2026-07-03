const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  contextUsageFromAppServerTokenUsage,
  readLatestTranscriptContextUsage
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

test('transcript reader returns the latest token_count current context usage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-usage-'))
  const transcriptPath = path.join(dir, 'rollout.jsonl')

  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        timestamp: '2026-07-01T01:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              total_tokens: 100000
            },
            last_token_usage: {
              total_tokens: 10000
            },
            model_context_window: 100000
          }
        }
      }),
      JSON.stringify({
        timestamp: '2026-07-01T02:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              total_tokens: 1798324
            },
            last_token_usage: {
              total_tokens: 124726
            },
            model_context_window: 258400
          }
        }
      })
    ].join('\n')
  )

  const usage = await readLatestTranscriptContextUsage(transcriptPath, 'thread-1')

  assert.deepEqual(usage, {
    threadId: 'thread-1',
    percent: 48,
    totalTokens: 124726,
    modelContextWindow: 258400,
    updatedAt: Date.parse('2026-07-01T02:00:00.000Z')
  })
})
