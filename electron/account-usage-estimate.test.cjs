const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  estimateTodayTokensFromTranscriptContent,
  readLocalTodayTokenEstimateForThread
} = require('./account-usage-estimate.cjs')

const tokenCountLine = (timestamp, totalTokens) => JSON.stringify({
  timestamp,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        total_tokens: totalTokens
      },
      last_token_usage: {
        total_tokens: Math.min(totalTokens, 1000)
      }
    }
  }
})

test('estimates today tokens from cumulative transcript deltas', () => {
  const result = estimateTodayTokensFromTranscriptContent(
    [
      tokenCountLine('2026-07-08T23:55:00.000+08:00', 1000),
      tokenCountLine('2026-07-09T09:00:00.000+08:00', 1300),
      tokenCountLine('2026-07-09T10:00:00.000+08:00', 1800),
      tokenCountLine('2026-07-09T11:00:00.000+08:00', 1700),
      tokenCountLine('2026-07-09T12:00:00.000+08:00', 2100)
    ].join('\n'),
    {
      todayKey: '2026-07-09',
      threadCreatedAtMs: Date.parse('2026-07-08T20:00:00.000+08:00')
    }
  )

  assert.deepEqual(result, {
    tokens: 1100,
    eventCount: 4,
    updatedAt: Date.parse('2026-07-09T12:00:00.000+08:00')
  })
})

test('counts first today total for conversations created today', () => {
  const result = estimateTodayTokensFromTranscriptContent(
    [
      tokenCountLine('2026-07-09T09:00:00.000+08:00', 500),
      tokenCountLine('2026-07-09T10:00:00.000+08:00', 800)
    ].join('\n'),
    {
      todayKey: '2026-07-09',
      threadCreatedAtMs: Date.parse('2026-07-09T08:30:00.000+08:00')
    }
  )

  assert.equal(result.tokens, 800)
  assert.equal(result.eventCount, 2)
})

test('reads local today estimate from a transcript file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-account-usage-estimate-'))
  const transcriptPath = path.join(dir, 'rollout.jsonl')

  fs.writeFileSync(
    transcriptPath,
    [
      tokenCountLine('2026-07-09T09:00:00.000+08:00', 500),
      tokenCountLine('2026-07-09T10:00:00.000+08:00', 650)
    ].join('\n')
  )

  const result = await readLocalTodayTokenEstimateForThread({
    id: 'thread-1',
    path: transcriptPath,
    createdAt: Date.parse('2026-07-09T08:30:00.000+08:00') / 1000
  }, '2026-07-09')

  assert.deepEqual(result, {
    threadId: 'thread-1',
    tokens: 650,
    eventCount: 2,
    updatedAt: Date.parse('2026-07-09T10:00:00.000+08:00')
  })
})
