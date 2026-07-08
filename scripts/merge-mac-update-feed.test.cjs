const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.join(__dirname, '..')
const scriptPath = path.join(__dirname, 'merge-mac-update-feed.mjs')

test('merges arm64 and x64 latest-mac feeds into one architecture-aware feed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-mac-feed-'))
  const arm64Path = path.join(tmpDir, 'latest-mac-mac-arm64.yml')
  const x64Path = path.join(tmpDir, 'latest-mac-mac-x64.yml')
  const outputPath = path.join(tmpDir, 'latest-mac.yml')

  fs.writeFileSync(arm64Path, [
    'version: 0.2.0',
    'files:',
    '  - url: Codex.Sidecar-mac-arm64.zip',
    '    sha512: arm64hash',
    '    size: 123',
    '  - url: Codex.Sidecar-mac-arm64.zip.blockmap',
    '    sha512: arm64blockmaphash',
    '    size: 12',
    'path: Codex.Sidecar-mac-arm64.zip',
    'sha512: arm64hash',
    'releaseDate: 2026-07-08T00:00:00.000Z',
    ''
  ].join('\n'))

  fs.writeFileSync(x64Path, [
    'version: 0.2.0',
    'files:',
    '  - url: Codex.Sidecar-mac-x64.zip',
    '    sha512: x64hash',
    '    size: 456',
    'path: Codex.Sidecar-mac-x64.zip',
    'sha512: x64hash',
    'releaseDate: 2026-07-08T00:00:00.000Z',
    ''
  ].join('\n'))

  execFileSync(process.execPath, [
    scriptPath,
    `--arm64=${arm64Path}`,
    `--x64=${x64Path}`,
    `--output=${outputPath}`
  ], {
    cwd: rootDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })

  const merged = fs.readFileSync(outputPath, 'utf8')

  assert.match(merged, /^version: 0\.2\.0$/m)
  assert.match(merged, /url: Codex\.Sidecar-mac-arm64\.zip/)
  assert.match(merged, /sha512: arm64hash/)
  assert.match(merged, /url: Codex\.Sidecar-mac-x64\.zip/)
  assert.match(merged, /sha512: x64hash/)
  assert.match(merged, /^path: Codex\.Sidecar-mac-arm64\.zip$/m)
  assert.doesNotMatch(merged, /zip\.blockmap/)
})
