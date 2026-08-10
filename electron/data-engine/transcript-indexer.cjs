const fsp = require('node:fs/promises')

const { contextUsageFromTranscriptTokenCount } = require('../context-usage.cjs')

const DEFAULT_CHUNK_SIZE = 256 * 1024
const DEFAULT_MAX_LINE_BYTES = 2 * 1024 * 1024
const USER_PREVIEW_MAX_LENGTH = 120

const toLocalDateKey = date => {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const timestampDetails = value => {
  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return {
      dateKey: '',
      timestamp: null
    }
  }

  return {
    dateKey: toLocalDateKey(new Date(timestamp)),
    timestamp
  }
}

const normalizePreview = value => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > USER_PREVIEW_MAX_LENGTH ? text.slice(0, USER_PREVIEW_MAX_LENGTH) : text
}

const extractUserPreview = event => {
  if (event?.type !== 'response_item') {
    return ''
  }

  const item = event.payload

  if (item?.type !== 'message' || item.role !== 'user' || !Array.isArray(item.content)) {
    return ''
  }

  return normalizePreview(item.content
    .filter(content => content?.type === 'input_text' && typeof content.text === 'string')
    .map(content => content.text)
    .join(' '))
}

const lifecycleFromEvent = event => {
  if (event?.type !== 'event_msg') {
    return null
  }

  const lifecycleByType = {
    task_started: 'started',
    task_complete: 'completed',
    turn_aborted: 'interrupted'
  }
  const lifecycle = (
    event.payload?.type === 'task_complete' &&
    Object.prototype.hasOwnProperty.call(event.payload, 'last_agent_message') &&
    event.payload.last_agent_message == null
  )
    ? 'failed'
    : lifecycleByType[event.payload?.type]
  const turnId = typeof event.payload?.turn_id === 'string' ? event.payload.turn_id : ''

  return lifecycle && turnId
    ? {
        lifecycle,
        turnId
      }
    : null
}

const totalTokensFromEvent = event => {
  if (event?.type !== 'event_msg' || event.payload?.type !== 'token_count') {
    return null
  }

  const totalTokens = Number(event.payload?.info?.total_token_usage?.total_tokens)
  return Number.isFinite(totalTokens) && totalTokens >= 0 ? totalTokens : null
}

const createDefaultCheckpoint = () => ({
  device: null,
  inode: null,
  size: null,
  mtimeMs: null,
  offset: 0,
  trailing: '',
  discardingOversizedLine: false,
  previousTotalTokens: null,
  lastDateKey: ''
})

const normalizeCheckpoint = checkpoint => {
  if (!checkpoint || typeof checkpoint !== 'object') {
    return createDefaultCheckpoint()
  }

  return {
    device: Number.isFinite(checkpoint.device) ? checkpoint.device : null,
    inode: Number.isFinite(checkpoint.inode) ? checkpoint.inode : null,
    size: Number.isSafeInteger(checkpoint.size) && checkpoint.size >= 0 ? checkpoint.size : null,
    mtimeMs: Number.isFinite(checkpoint.mtimeMs) ? checkpoint.mtimeMs : null,
    offset: Number.isSafeInteger(checkpoint.offset) && checkpoint.offset >= 0 ? checkpoint.offset : 0,
    trailing: typeof checkpoint.trailing === 'string' ? checkpoint.trailing : '',
    discardingOversizedLine: checkpoint.discardingOversizedLine === true,
    previousTotalTokens: Number.isFinite(checkpoint.previousTotalTokens) && checkpoint.previousTotalTokens >= 0
      ? checkpoint.previousTotalTokens
      : null,
    lastDateKey: typeof checkpoint.lastDateKey === 'string' ? checkpoint.lastDateKey : ''
  }
}

const defaultReadChunk = async (filePath, offset, length) => {
  const file = await fsp.open(filePath, 'r')
  const buffer = Buffer.alloc(length)

  try {
    const { bytesRead } = await file.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

const createTranscriptIndexer = ({
  chunkSize = DEFAULT_CHUNK_SIZE,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  readChunk = defaultReadChunk,
  statFile = filePath => fsp.stat(filePath)
} = {}) => {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Transcript chunk size must be a positive integer.')
  }

  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
    throw new Error('Transcript maximum line size must be a positive integer.')
  }

  const indexTranscript = async ({
    path,
    threadId,
    threadCreatedAtMs = null,
    checkpoint,
    onFact = () => {}
  }) => {
    if (typeof path !== 'string' || !path || typeof threadId !== 'string' || !threadId) {
      throw new Error('Transcript path and thread id are required.')
    }

    const stat = await statFile(path)
    const previousCheckpoint = normalizeCheckpoint(checkpoint)
    const identityChanged = (
      (previousCheckpoint.device != null && previousCheckpoint.device !== stat.dev) ||
      (previousCheckpoint.inode != null && previousCheckpoint.inode !== stat.ino)
    )
    const truncated = stat.size < previousCheckpoint.offset
    const reset = identityChanged || truncated

    // Codex transcripts are append-only. A complete EOF checkpoint with the
    // same file identity and metadata has no possible new facts, so opening 400+
    // files on every safety reconciliation would only add disk and SQLite work.
    const unchanged = (
      !reset &&
      previousCheckpoint.device === stat.dev &&
      previousCheckpoint.inode === stat.ino &&
      previousCheckpoint.size === stat.size &&
      previousCheckpoint.mtimeMs === stat.mtimeMs &&
      previousCheckpoint.offset === stat.size &&
      !previousCheckpoint.trailing &&
      !previousCheckpoint.discardingOversizedLine
    )

    if (unchanged) {
      return {
        checkpoint: previousCheckpoint,
        factsProcessed: 0,
        malformedLines: 0,
        oversizedLines: 0,
        reset: false,
        unchanged: true
      }
    }

    const nextCheckpoint = reset ? createDefaultCheckpoint() : previousCheckpoint

    nextCheckpoint.device = stat.dev
    nextCheckpoint.inode = stat.ino

    let trailing = nextCheckpoint.trailing
      ? Buffer.from(nextCheckpoint.trailing, 'base64')
      : Buffer.alloc(0)
    let factsProcessed = 0
    let malformedLines = 0
    let oversizedLines = 0
    let discardingOversizedLine = nextCheckpoint.discardingOversizedLine
    let offset = nextCheckpoint.offset

    const emitFact = async fact => {
      factsProcessed += 1
      await onFact(fact)
    }

    const processOversizedPrefix = async linePrefix => {
      const rawPrefix = linePrefix.subarray(0, maxLineBytes).toString('utf8')

      if (!/"type"\s*:\s*"event_msg"/.test(rawPrefix)) {
        return
      }

      const payloadStart = rawPrefix.search(/"payload"\s*:\s*\{/)
      const payloadPrefix = payloadStart >= 0 ? rawPrefix.slice(payloadStart) : ''
      const eventType = payloadPrefix.match(/"type"\s*:\s*"([^"]+)"/)?.[1] || ''
      const turnId = payloadPrefix.match(/"turn_id"\s*:\s*"([^"]+)"/)?.[1] || ''
      const lifecycleByType = {
        task_started: 'started',
        task_complete: 'completed',
        turn_aborted: 'interrupted'
      }
      let lifecycle = lifecycleByType[eventType] || ''

      if (
        eventType === 'task_complete' &&
        /"last_agent_message"\s*:\s*null/.test(payloadPrefix)
      ) {
        lifecycle = 'failed'
      }

      if (!turnId || !lifecycle) {
        return
      }

      const timestampValue = rawPrefix.match(/"timestamp"\s*:\s*"([^"]+)"/)?.[1] || ''

      await emitFact({
        type: 'turnLifecycle',
        threadId,
        turnId,
        lifecycle,
        eventTimestamp: timestampDetails(timestampValue).timestamp
      })
    }

    const processLine = async lineBuffer => {
      const rawLine = lineBuffer.toString('utf8').replace(/\r$/, '')

      if (!rawLine.trim()) {
        return
      }

      let event

      try {
        event = JSON.parse(rawLine)
      } catch {
        malformedLines += 1
        return
      }

      const { dateKey, timestamp } = timestampDetails(event.timestamp)
      const lifecycle = lifecycleFromEvent(event)

      if (lifecycle) {
        await emitFact({
          type: 'turnLifecycle',
          threadId,
          turnId: lifecycle.turnId,
          lifecycle: lifecycle.lifecycle,
          eventTimestamp: timestamp
        })
      }

      const userPreview = extractUserPreview(event)

      if (userPreview) {
        await emitFact({
          type: 'lastUserPreview',
          threadId,
          preview: userPreview,
          eventTimestamp: timestamp
        })
      }

      const totalTokens = totalTokensFromEvent(event)

      if (totalTokens == null) {
        return
      }

      const contextUsage = contextUsageFromTranscriptTokenCount(threadId, event)

      if (contextUsage) {
        await emitFact({
          type: 'contextUsage',
          ...contextUsage
        })
      }

      let delta = 0

      if (nextCheckpoint.previousTotalTokens == null) {
        const createdDateKey = Number.isFinite(threadCreatedAtMs)
          ? toLocalDateKey(new Date(threadCreatedAtMs))
          : ''

        if (createdDateKey && createdDateKey === dateKey) {
          delta = totalTokens
        }
      } else {
        delta = Math.max(0, totalTokens - nextCheckpoint.previousTotalTokens)
      }

      if (dateKey) {
        await emitFact({
          type: 'tokenDelta',
          threadId,
          dateKey,
          tokens: delta,
          eventTimestamp: timestamp
        })
      }

      nextCheckpoint.previousTotalTokens = nextCheckpoint.previousTotalTokens == null
        ? totalTokens
        : Math.max(nextCheckpoint.previousTotalTokens, totalTokens)
      nextCheckpoint.lastDateKey = dateKey || nextCheckpoint.lastDateKey
    }

    while (true) {
      const chunk = await readChunk(path, offset, chunkSize)

      if (!Buffer.isBuffer(chunk)) {
        throw new Error('Transcript reader must return a Buffer.')
      }

      if (chunk.length === 0) {
        break
      }

      offset += chunk.length
      let currentChunk = chunk

      if (discardingOversizedLine) {
        const discardedLineEnd = currentChunk.indexOf(0x0a)

        if (discardedLineEnd === -1) {
          if (chunk.length < chunkSize) {
            break
          }
          continue
        }

        discardingOversizedLine = false
        currentChunk = currentChunk.subarray(discardedLineEnd + 1)
      }

      const combined = trailing.length > 0 ? Buffer.concat([trailing, currentChunk]) : currentChunk
      let lineStart = 0

      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) {
          continue
        }

        const line = combined.subarray(lineStart, index)

        if (line.length > maxLineBytes) {
          oversizedLines += 1
          await processOversizedPrefix(line)
        } else {
          await processLine(line)
        }
        lineStart = index + 1
      }

      trailing = combined.subarray(lineStart)

      if (trailing.length > maxLineBytes) {
        oversizedLines += 1
        await processOversizedPrefix(trailing)
        trailing = Buffer.alloc(0)
        discardingOversizedLine = true
      }

      if (chunk.length < chunkSize) {
        break
      }
    }

    nextCheckpoint.offset = offset
    nextCheckpoint.size = stat.size
    nextCheckpoint.mtimeMs = stat.mtimeMs
    nextCheckpoint.trailing = trailing.length > 0 ? trailing.toString('base64') : ''
    nextCheckpoint.discardingOversizedLine = discardingOversizedLine

    return {
      checkpoint: nextCheckpoint,
      factsProcessed,
      malformedLines,
      oversizedLines,
      reset,
      unchanged: false
    }
  }

  return {
    indexTranscript
  }
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_LINE_BYTES,
  createTranscriptIndexer
}
