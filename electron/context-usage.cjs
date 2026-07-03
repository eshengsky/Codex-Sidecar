const fsp = require('node:fs/promises')

const toFiniteNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const normalizeUpdatedAt = value => {
  const updatedAt = toFiniteNumber(value)
  return updatedAt && updatedAt > 0 ? updatedAt : Date.now()
}

const normalizeContextUsageSnapshot = (threadId, totalTokensValue, modelContextWindowValue, updatedAtValue) => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : ''
  const totalTokens = toFiniteNumber(totalTokensValue)
  const modelContextWindow = toFiniteNumber(modelContextWindowValue)

  if (!normalizedThreadId || totalTokens == null || totalTokens < 0 || modelContextWindow == null || modelContextWindow <= 0) {
    return null
  }

  return {
    threadId: normalizedThreadId,
    percent: Math.min(100, Math.max(0, Math.round((totalTokens / modelContextWindow) * 100))),
    totalTokens,
    modelContextWindow,
    updatedAt: normalizeUpdatedAt(updatedAtValue)
  }
}

const contextUsageFromAppServerTokenUsage = (threadId, tokenUsage, updatedAt = Date.now()) => {
  if (!tokenUsage || typeof tokenUsage !== 'object') {
    return null
  }

  return normalizeContextUsageSnapshot(
    threadId,
    tokenUsage.last?.totalTokens,
    tokenUsage.modelContextWindow,
    updatedAt
  )
}

const contextUsageFromTranscriptTokenCount = (threadId, event) => {
  if (!event || event.type !== 'event_msg' || event.payload?.type !== 'token_count') {
    return null
  }

  const timestamp = Date.parse(event.timestamp)
  const info = event.payload.info || {}

  return normalizeContextUsageSnapshot(
    threadId,
    info.last_token_usage?.total_tokens,
    info.model_context_window,
    Number.isFinite(timestamp) ? timestamp : Date.now()
  )
}

const readLatestTranscriptContextUsage = async (transcriptPath, threadId) => {
  if (!transcriptPath || !threadId) {
    return null
  }

  try {
    const contents = await fsp.readFile(transcriptPath, 'utf8')
    let latestUsage = null

    for (const line of contents.split('\n')) {
      if (!line.trim()) {
        continue
      }

      try {
        const usage = contextUsageFromTranscriptTokenCount(threadId, JSON.parse(line))

        if (usage) {
          latestUsage = usage
        }
      } catch {
        // A malformed transcript line should not block context usage reconciliation.
      }
    }

    return latestUsage
  } catch {
    return null
  }
}

module.exports = {
  contextUsageFromAppServerTokenUsage,
  contextUsageFromTranscriptTokenCount,
  readLatestTranscriptContextUsage
}
