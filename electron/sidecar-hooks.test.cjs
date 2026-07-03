const assert = require('node:assert/strict')
const test = require('node:test')

const {
  SIDECAR_HOOK_EVENTS,
  evaluateSidecarHookStatus
} = require('./sidecar-hooks.cjs')

const expectedHooks = SIDECAR_HOOK_EVENTS.map(eventName => ({
  eventName,
  command: `/tmp/sidecar-hook-capture.sh ${eventName}`
}))

const createHook = (eventName, patch = {}) => ({
  eventName,
  command: `/tmp/sidecar-hook-capture.sh ${eventName}`,
  enabled: true,
  trustStatus: 'trusted',
  ...patch
})

test('marks hooks ready when every sidecar hook is enabled and trusted or managed', () => {
  const status = evaluateSidecarHookStatus({
    data: [{
      cwd: '/tmp/project',
      hooks: SIDECAR_HOOK_EVENTS.map((eventName, index) => createHook(eventName, {
        trustStatus: index === 0 ? 'managed' : 'trusted'
      }))
    }]
  }, expectedHooks)

  assert.equal(status.ready, true)
  assert.equal(status.issue, null)
  assert.deepEqual(status.missingEvents, [])
  assert.deepEqual(status.untrustedEvents, [])
  assert.deepEqual(status.disabledEvents, [])
})

test('reports missing sidecar hook commands', () => {
  const missingEvent = SIDECAR_HOOK_EVENTS[0]
  const status = evaluateSidecarHookStatus({
    data: [{
      cwd: '/tmp/project',
      hooks: SIDECAR_HOOK_EVENTS.slice(1).map(eventName => createHook(eventName))
    }]
  }, expectedHooks)

  assert.equal(status.ready, false)
  assert.equal(status.issue, 'missing')
  assert.deepEqual(status.missingEvents, [missingEvent])
})

test('matches app-server lower-camel event names against configured hook event names', () => {
  const appServerEventNames = {
    UserPromptSubmit: 'userPromptSubmit',
    PreToolUse: 'preToolUse',
    PermissionRequest: 'permissionRequest',
    PostToolUse: 'postToolUse',
    Stop: 'stop'
  }
  const status = evaluateSidecarHookStatus({
    data: [{
      cwd: '/tmp/project',
      hooks: SIDECAR_HOOK_EVENTS.map(eventName => createHook(eventName, {
        eventName: appServerEventNames[eventName]
      }))
    }]
  }, expectedHooks)

  assert.equal(status.ready, true)
  assert.equal(status.issue, null)
  assert.deepEqual(status.missingEvents, [])
})

test('reports untrusted hooks before disabled hooks', () => {
  const untrustedEvent = SIDECAR_HOOK_EVENTS[1]
  const disabledEvent = SIDECAR_HOOK_EVENTS[2]
  const status = evaluateSidecarHookStatus({
    data: [{
      cwd: '/tmp/project',
      hooks: SIDECAR_HOOK_EVENTS.map(eventName => {
        if (eventName === untrustedEvent) {
          return createHook(eventName, { trustStatus: 'modified' })
        }

        if (eventName === disabledEvent) {
          return createHook(eventName, { enabled: false })
        }

        return createHook(eventName)
      })
    }]
  }, expectedHooks)

  assert.equal(status.ready, false)
  assert.equal(status.issue, 'untrusted')
  assert.deepEqual(status.untrustedEvents, [untrustedEvent])
  assert.deepEqual(status.disabledEvents, [disabledEvent])
})

test('reports disabled hooks when every command is trusted but not enabled', () => {
  const disabledEvent = SIDECAR_HOOK_EVENTS[3]
  const status = evaluateSidecarHookStatus({
    data: [{
      cwd: '/tmp/project',
      hooks: SIDECAR_HOOK_EVENTS.map(eventName => createHook(eventName, {
        enabled: eventName !== disabledEvent
      }))
    }]
  }, expectedHooks)

  assert.equal(status.ready, false)
  assert.equal(status.issue, 'disabled')
  assert.deepEqual(status.disabledEvents, [disabledEvent])
})
