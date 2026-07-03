const SIDECAR_HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
]

const TRUSTED_HOOK_STATUSES = new Set(['trusted', 'managed'])

const normalizeHookEntries = response => {
  const entries = Array.isArray(response?.data) ? response.data : []

  return entries.flatMap(entry => Array.isArray(entry?.hooks) ? entry.hooks : [])
}

const normalizeHookEventName = value => String(value || '').toLowerCase()

const createHookStatus = ({ missingEvents, untrustedEvents, disabledEvents, checkedAt = Date.now() }) => {
  let issue = null

  if (missingEvents.length > 0) {
    issue = 'missing'
  } else if (untrustedEvents.length > 0) {
    issue = 'untrusted'
  } else if (disabledEvents.length > 0) {
    issue = 'disabled'
  }

  return {
    ready: issue === null,
    issue,
    missingEvents,
    untrustedEvents,
    disabledEvents,
    checkedAt
  }
}

const evaluateSidecarHookStatus = (response, expectedHooks, options = {}) => {
  const hooks = normalizeHookEntries(response)
  const missingEvents = []
  const untrustedEvents = []
  const disabledEvents = []

  for (const expectedHook of expectedHooks) {
    const eventName = expectedHook?.eventName
    const command = expectedHook?.command

    if (!eventName || !command) {
      continue
    }

    const expectedEventName = normalizeHookEventName(eventName)
    const matches = hooks.filter(hook =>
      normalizeHookEventName(hook?.eventName) === expectedEventName && hook.command === command
    )

    if (matches.length === 0) {
      missingEvents.push(eventName)
      continue
    }

    if (!matches.some(hook => TRUSTED_HOOK_STATUSES.has(hook.trustStatus))) {
      untrustedEvents.push(eventName)
    }

    if (!matches.some(hook => hook.enabled === true)) {
      disabledEvents.push(eventName)
    }
  }

  return createHookStatus({
    missingEvents,
    untrustedEvents,
    disabledEvents,
    checkedAt: options.checkedAt
  })
}

module.exports = {
  SIDECAR_HOOK_EVENTS,
  evaluateSidecarHookStatus
}
