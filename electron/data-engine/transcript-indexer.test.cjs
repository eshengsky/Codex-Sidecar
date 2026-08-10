const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createTranscriptIndexer } = require('./transcript-indexer.cjs')

const timestamp = '2026-08-05T01:00:00.000Z'
const createdAtMs = Date.parse(timestamp)

const tokenEvent = total => JSON.stringify({
  timestamp,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        total_tokens: total
      },
      last_token_usage: {
        total_tokens: total
      },
      model_context_window: 1000
    }
  }
})

const lifecycleEvent = (type, turnId) => JSON.stringify({
  timestamp,
  type: 'event_msg',
  payload: {
    type,
    turn_id: turnId
  }
})

const withTranscript = async (content, run) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-transcript-indexer-'))
  const transcriptPath = path.join(directory, 'rollout.jsonl')

  try {
    await fsp.writeFile(transcriptPath, content)
    await run(transcriptPath)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
}

test('reads a transcript in bounded chunks and resumes at the persisted byte offset', async () => {
  const initialContent = [
    tokenEvent(100),
    lifecycleEvent('task_started', 'turn-1'),
    tokenEvent(150),
    ''
  ].join('\n')

  await withTranscript(initialContent, async transcriptPath => {
    const readCalls = []
    const indexer = createTranscriptIndexer({
      chunkSize: 64,
      readChunk: async (filePath, offset, length) => {
        readCalls.push({ offset, length })
        const file = await fsp.open(filePath, 'r')
        const buffer = Buffer.alloc(length)

        try {
          const { bytesRead } = await file.read(buffer, 0, length, offset)
          return buffer.subarray(0, bytesRead)
        } finally {
          await file.close()
        }
      }
    })
    const facts = []
    const first = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-1',
      threadCreatedAtMs: createdAtMs,
      checkpoint: null,
      onFact: fact => facts.push(fact)
    })

    assert.equal(first.checkpoint.offset, Buffer.byteLength(initialContent))
    assert.equal(readCalls.every(call => call.length === 64), true)
    assert.deepEqual(
      facts.filter(fact => fact.type === 'tokenDelta').map(fact => fact.tokens),
      [100, 50]
    )
    assert.deepEqual(
      facts.find(fact => fact.type === 'turnLifecycle'),
      {
        type: 'turnLifecycle',
        threadId: 'thread-1',
        turnId: 'turn-1',
        lifecycle: 'started',
        eventTimestamp: createdAtMs
      }
    )

    const previousSize = first.checkpoint.offset
    await fsp.appendFile(transcriptPath, `${tokenEvent(200)}\n`)
    readCalls.length = 0
    facts.length = 0

    const second = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-1',
      threadCreatedAtMs: createdAtMs,
      checkpoint: first.checkpoint,
      onFact: fact => facts.push(fact)
    })

    assert.equal(readCalls[0].offset, previousSize)
    assert.equal(second.checkpoint.previousTotalTokens, 200)
    assert.deepEqual(
      facts.filter(fact => fact.type === 'tokenDelta').map(fact => fact.tokens),
      [50]
    )
  })
})

test('does not open an unchanged transcript already checkpointed at EOF', async () => {
  await withTranscript(`${tokenEvent(100)}\n`, async transcriptPath => {
    let readCount = 0
    const readChunk = async (filePath, offset, length) => {
      readCount += 1
      const file = await fsp.open(filePath, 'r')
      const buffer = Buffer.alloc(length)

      try {
        const { bytesRead } = await file.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      } finally {
        await file.close()
      }
    }
    const indexer = createTranscriptIndexer({
      readChunk
    })
    const first = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-unchanged',
      threadCreatedAtMs: createdAtMs
    })

    readCount = 0
    const second = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-unchanged',
      threadCreatedAtMs: createdAtMs,
      checkpoint: first.checkpoint
    })

    assert.equal(second.unchanged, true)
    assert.equal(readCount, 0)
    assert.deepEqual(second.checkpoint, first.checkpoint)
  })
})

test('holds an incomplete JSONL line until later bytes complete it', async () => {
  const complete = `${tokenEvent(100)}\n`
  const next = `${tokenEvent(150)}\n`
  const splitAt = Math.floor(next.length / 2)

  await withTranscript(`${complete}${next.slice(0, splitAt)}`, async transcriptPath => {
    const indexer = createTranscriptIndexer({ chunkSize: 37 })
    const firstFacts = []
    const first = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-1',
      threadCreatedAtMs: createdAtMs,
      checkpoint: null,
      onFact: fact => firstFacts.push(fact)
    })

    assert.equal(firstFacts.filter(fact => fact.type === 'tokenDelta').length, 1)
    assert.notEqual(first.checkpoint.trailing, '')

    await fsp.appendFile(transcriptPath, next.slice(splitAt))

    const secondFacts = []
    const second = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-1',
      threadCreatedAtMs: createdAtMs,
      checkpoint: first.checkpoint,
      onFact: fact => secondFacts.push(fact)
    })

    assert.equal(second.checkpoint.trailing, '')
    assert.deepEqual(
      secondFacts.filter(fact => fact.type === 'tokenDelta').map(fact => fact.tokens),
      [50]
    )
  })
})

test('skips malformed lines without blocking later facts', async () => {
  await withTranscript([
    '{broken',
    lifecycleEvent('turn_aborted', 'turn-2'),
    ''
  ].join('\n'), async transcriptPath => {
    const facts = []
    const result = await createTranscriptIndexer({ chunkSize: 31 }).indexTranscript({
      path: transcriptPath,
      threadId: 'thread-2',
      threadCreatedAtMs: createdAtMs,
      checkpoint: null,
      onFact: fact => facts.push(fact)
    })

    assert.equal(result.malformedLines, 1)
    assert.deepEqual(facts, [{
      type: 'turnLifecycle',
      threadId: 'thread-2',
      turnId: 'turn-2',
      lifecycle: 'interrupted',
      eventTimestamp: createdAtMs
    }])
  })
})

test('resets the checkpoint when a transcript is truncated or replaced', async () => {
  await withTranscript(`${tokenEvent(100)}\n${tokenEvent(150)}\n`, async transcriptPath => {
    const indexer = createTranscriptIndexer({ chunkSize: 64 })
    const first = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-3',
      threadCreatedAtMs: createdAtMs,
      checkpoint: null,
      onFact: () => {}
    })

    await fsp.writeFile(transcriptPath, `${tokenEvent(25)}\n`)

    const facts = []
    const second = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-3',
      threadCreatedAtMs: createdAtMs,
      checkpoint: first.checkpoint,
      onFact: fact => facts.push(fact)
    })

    assert.equal(second.reset, true)
    assert.equal(second.checkpoint.previousTotalTokens, 25)
    assert.deepEqual(
      facts.filter(fact => fact.type === 'tokenDelta').map(fact => fact.tokens),
      [25]
    )
  })
})

test('marks a task_complete without a final agent message as failed', async () => {
  await withTranscript(`${JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'turn-empty',
      last_agent_message: null
    }
  })}\n`, async transcriptPath => {
    const facts = []

    await createTranscriptIndexer().indexTranscript({
      path: transcriptPath,
      threadId: 'thread-empty',
      checkpoint: null,
      onFact: fact => facts.push(fact)
    })

    assert.deepEqual(facts, [{
      type: 'turnLifecycle',
      threadId: 'thread-empty',
      turnId: 'turn-empty',
      lifecycle: 'failed',
      eventTimestamp: createdAtMs
    }])
  })
})

test('discards an oversized JSONL record without retaining it in memory or blocking later facts', async () => {
  const oversized = JSON.stringify({
    timestamp: '2026-08-05T03:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: 'x'.repeat(1000)
      }]
    }
  })
  const oversizedLifecycle = JSON.stringify({
    timestamp: '2026-08-05T03:00:01.000Z',
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'turn-oversized',
      last_agent_message: 'x'.repeat(1000)
    }
  })

  await withTranscript(`${oversized}\n${oversizedLifecycle}\n${tokenEvent(25)}\n`, async transcriptPath => {
    const facts = []
    const indexer = createTranscriptIndexer({
      chunkSize: 64,
      maxLineBytes: 512
    })
    const result = await indexer.indexTranscript({
      path: transcriptPath,
      threadId: 'thread-1',
      threadCreatedAtMs: Date.parse('2026-08-05T00:00:00.000Z'),
      onFact: fact => {
        facts.push(fact)
      }
    })

    assert.equal(result.oversizedLines, 2)
    assert.equal(result.checkpoint.trailing, '')
    assert.equal(facts.some(fact => fact.type === 'tokenDelta'), true)
    assert.equal(facts.some(fact =>
      fact.type === 'turnLifecycle' &&
      fact.turnId === 'turn-oversized' &&
      fact.lifecycle === 'completed'
    ), true)
  })
})
