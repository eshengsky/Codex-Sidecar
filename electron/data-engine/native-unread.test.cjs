const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { readNativeUnreadFromPath } = require('./service.cjs')

const identity = '8a3d88b13bf9c1bf43b3123ba74b011bee7a5dc05698de76d910fb86ddb8d550'
const localHost = 'local:092af2cb59bdd804c6f7f1cd1d85464b682974e43cd517397d25510024034d1c'
const auth = {
  authMethod: 'chatgpt',
  authToken: `header.${Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'account-a', user_id: 'user-a' }
  })).toString('base64url')}.signature`
}
const legacy = { 'electron-persisted-atom-state': { 'unread-thread-ids-by-host-v1': { local: ['old'] } } }
const modern = ids => ({
  ...legacy,
  'electron-thread-read-state-v1': {
    version: 1,
    unreadByIdentity: {
      [identity]: { [localHost]: ids, 'remote:other': ['remote'], 'local:other': ['other-local'] },
      otherAccount: { [localHost]: ['other-account'] }
    }
  }
})

const read = async (state, getAuthStatus = async () => auth) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-unread-'))
  try {
    const file = path.join(dir, 'state.json')
    fs.writeFileSync(file, typeof state === 'string' ? state : JSON.stringify(state))
    return await readNativeUnreadFromPath(file, getAuthStatus)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('new format selects only the authenticated account and local stdio host', async () => {
  const state = modern(['task-a', 'task-b'])
  delete state['electron-persisted-atom-state']
  const result = await read(state)
  assert.equal(result.available, true)
  assert.deepEqual(result.ids, ['task-a', 'task-b'])
  assert.equal(result.count, 2)
})

test('supports the alternate ChatGPT token principal claim names', async () => {
  const result = await read(modern(['task']), async () => ({
    authMethod: 'chatgptAuthTokens',
    authToken: `header.${Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { account_id: 'account-a', chatgpt_user_id: 'user-a' }
    })).toString('base64url')}.signature`
  }))
  assert.deepEqual(result.ids, ['task'])
})

test('an empty new-format list takes precedence over stale legacy unread IDs', async () => {
  assert.deepEqual((await read(modern([]))).ids, [])
})

test('missing current account or host is empty, never another account or host', async () => {
  for (const hosts of [undefined, { 'local:other': ['wrong'] }]) {
    const state = modern(['task'])
    state['electron-thread-read-state-v1'].unreadByIdentity[identity] = hosts
    const result = await read(state)
    assert.equal(result.available, true)
    assert.deepEqual(result.ids, [])
  }
})

test('legacy format works without requesting authentication', async () => {
  const result = await read(legacy, () => { throw new Error('must not request auth') })
  assert.equal(result.available, true)
  assert.deepEqual(result.ids, ['old'])
})

test('unavailable identity, invalid data and unsupported versions retain zero fallback', async () => {
  for (const [state, getAuth] of [
    [modern(['task']), async () => ({ authMethod: null })],
    [modern(['task']), async () => ({ authMethod: 'chatgpt', authToken: 'invalid' })],
    [modern(['task']), async () => { throw new Error('request failed') }],
    [{ ...legacy, 'electron-thread-read-state-v1': { version: 2 } }],
    [modern('invalid')],
    ['{'],
    [{}]
  ]) {
    const result = await read(state, getAuth)
    assert.equal(result.available, false)
    assert.equal(result.count, 0)
    assert.deepEqual(result.ids, [])
    assert.ok(result.error)
  }
})
