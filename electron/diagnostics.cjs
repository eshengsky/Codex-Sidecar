const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 20
const MAX_OBJECT_KEYS = 40
const MAX_DEPTH = 5

const sanitizeValue = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_STRING_LENGTH)
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: String(value.message || '').slice(0, MAX_STRING_LENGTH),
      stack: String(value.stack || '').slice(0, MAX_STRING_LENGTH)
    }
  }

  if (typeof value !== 'object' || depth >= MAX_DEPTH || seen.has(value)) {
    return String(value).slice(0, MAX_STRING_LENGTH)
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map(item => sanitizeValue(item, depth + 1, seen))
  }

  const result = {}

  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    result[String(key).slice(0, 120)] = sanitizeValue(item, depth + 1, seen)
  }

  return result
}

const createDiagnostics = ({
  directory,
  maxBytes = DEFAULT_MAX_BYTES,
  clock = Date.now
}) => {
  if (typeof directory !== 'string' || !directory) {
    throw new Error('Diagnostics directory is required.')
  }

  const activePath = path.join(directory, 'events.jsonl')
  const previousPath = path.join(directory, 'events.previous.jsonl')

  const record = (type, details = {}) => {
    try {
      fs.mkdirSync(directory, {
        recursive: true
      })

      if (fs.existsSync(activePath) && fs.statSync(activePath).size >= maxBytes) {
        fs.rmSync(previousPath, {
          force: true
        })
        fs.renameSync(activePath, previousPath)
      }

      const event = {
        timestamp: clock(),
        type: String(type || 'unknown').slice(0, 120),
        details: sanitizeValue(details)
      }

      fs.appendFileSync(activePath, `${JSON.stringify(event)}\n`, 'utf8')
    } catch {
      // Diagnostics must never replace or mask the failure being recorded.
    }
  }

  return {
    activePath,
    previousPath,
    record
  }
}

module.exports = {
  createDiagnostics
}
