const threadUpdatedAt = thread => Number.isFinite(thread?.updatedAt) ? thread.updatedAt : Number.NEGATIVE_INFINITY

const deduplicateThreadsById = threads => {
  const uniqueThreads = []
  const indexById = new Map()

  for (const thread of Array.isArray(threads) ? threads : []) {
    const threadId = typeof thread?.id === 'string' ? thread.id.trim() : ''

    if (!threadId) {
      continue
    }

    const existingIndex = indexById.get(threadId)

    if (existingIndex == null) {
      indexById.set(threadId, uniqueThreads.length)
      uniqueThreads.push(thread)
      continue
    }

    // Pagination can overlap while Codex threads are changing. Preserve the
    // original sorted position, but keep the freshest representation for the
    // durable one-row-per-thread projection contract.
    if (threadUpdatedAt(thread) > threadUpdatedAt(uniqueThreads[existingIndex])) {
      uniqueThreads[existingIndex] = thread
    }
  }

  return uniqueThreads
}

module.exports = {
  deduplicateThreadsById
}
