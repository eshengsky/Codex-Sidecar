const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createDiagnostics } = require('./diagnostics.cjs')

test('records bounded structured diagnostic events and rotates the active log', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sidecar-diagnostics-'))

  try {
    const diagnostics = createDiagnostics({
      directory,
      maxBytes: 300,
      clock: () => 123
    })

    diagnostics.record('startup', {
      detail: 'x'.repeat(1000),
      nested: {
        value: 'kept'
      }
    })
    diagnostics.record('engine.health', {
      status: 'ready'
    })

    const activePath = path.join(directory, 'events.jsonl')
    const rotatedPath = path.join(directory, 'events.previous.jsonl')
    const activeLines = fs.readFileSync(activePath, 'utf8').trim().split('\n')

    assert.equal(fs.existsSync(rotatedPath), true)
    assert.equal(activeLines.length, 1)
    assert.deepEqual(JSON.parse(activeLines[0]), {
      timestamp: 123,
      type: 'engine.health',
      details: {
        status: 'ready'
      }
    })
  } finally {
    await fsp.rm(directory, {
      recursive: true,
      force: true
    })
  }
})

test('never throws when diagnostics storage is unavailable', () => {
  const diagnostics = createDiagnostics({
    directory: '/dev/null/not-a-directory'
  })

  assert.doesNotThrow(() => {
    diagnostics.record('failure', {
      message: 'still preserve the app failure path'
    })
  })
})
