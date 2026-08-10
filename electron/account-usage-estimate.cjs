const toFiniteNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const toLocalDateKey = date => {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const timestampToLocalDateKey = value => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? toLocalDateKey(date) : ''
}

const getThreadCreatedAtMs = thread => {
  const createdAt = toFiniteNumber(thread?.createdAt)

  if (createdAt == null || createdAt <= 0) {
    return null
  }

  return createdAt * 1000
}

const getTokenCountTotal = event => {
  return toFiniteNumber(event?.payload?.info?.total_token_usage?.total_tokens)
}

const isTokenCountEvent = event => {
  return event?.type === 'event_msg' && event?.payload?.type === 'token_count'
}

const estimateTodayTokensFromTranscriptContent = (content, { todayKey, threadCreatedAtMs }) => {
  if (!content || !todayKey) {
    return { tokens: 0, eventCount: 0, updatedAt: null }
  }

  const threadCreatedToday = threadCreatedAtMs ? toLocalDateKey(new Date(threadCreatedAtMs)) === todayKey : false
  let previousTotal = null
  let tokens = 0
  let eventCount = 0
  let updatedAt = null

  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue
    }

    let event

    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (!isTokenCountEvent(event)) {
      continue
    }

    const total = getTokenCountTotal(event)

    if (total == null || total < 0) {
      continue
    }

    const eventDateKey = timestampToLocalDateKey(event.timestamp)

    if (eventDateKey === todayKey) {
      eventCount += 1

      if (previousTotal == null) {
        if (threadCreatedToday) {
          tokens += total
        }
      } else {
        tokens += Math.max(0, total - previousTotal)
      }

      const eventTimestamp = Date.parse(event.timestamp)

      if (Number.isFinite(eventTimestamp)) {
        updatedAt = Math.max(updatedAt || 0, eventTimestamp)
      }
    }

    previousTotal = previousTotal == null ? total : Math.max(previousTotal, total)
  }

  return {
    tokens,
    eventCount,
    updatedAt
  }
}

module.exports = {
  estimateTodayTokensFromTranscriptContent,
  toLocalDateKey
}
