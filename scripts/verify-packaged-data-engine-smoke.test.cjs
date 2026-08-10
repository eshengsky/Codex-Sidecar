const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const helperPath = path.join(__dirname, 'verify-packaged-data-engine-smoke.sh')

const createFixture = source => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-smoke-helper-'))
  const executablePath = path.join(fixtureRoot, 'Codex Sidecar')
  const appDataPath = path.join(fixtureRoot, 'app-data')

  fs.writeFileSync(executablePath, source, { mode: 0o755 })
  return { appDataPath, executablePath, fixtureRoot }
}

test('prints persisted diagnostics and preserves the packaged process exit code', t => {
  const fixture = createFixture(`#!/bin/bash
mkdir -p "$SIDECAR_SMOKE_APP_DATA_PATH/Codex Sidecar/diagnostics"
echo '{"event":"engine.failed","error":"watch failed"}' > "$SIDECAR_SMOKE_APP_DATA_PATH/Codex Sidecar/diagnostics/events.jsonl"
echo '{"status":"failed"}'
exit 7
`)
  t.after(() => fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }))

  const result = spawnSync('bash', [helperPath, fixture.executablePath, fixture.appDataPath], {
    encoding: 'utf8'
  })

  assert.equal(result.status, 7)
  assert.match(result.stdout, /"status":"failed"/)
  assert.match(result.stdout, /engine\.failed/)
  assert.match(result.stdout, /watch failed/)
})

test('accepts a ready engine only when its packaged database was created', t => {
  const fixture = createFixture(`#!/bin/bash
mkdir -p "$SIDECAR_SMOKE_APP_DATA_PATH/Codex Sidecar"
touch "$SIDECAR_SMOKE_APP_DATA_PATH/Codex Sidecar/sidecar-v2.sqlite"
echo '{"status":"ready"}'
`)
  t.after(() => fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }))

  const result = spawnSync('bash', [helperPath, fixture.executablePath, fixture.appDataPath], {
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"status":"ready"/)
})
