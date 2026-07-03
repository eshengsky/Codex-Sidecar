const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {
  resolveAppDataPaths
} = require('./app-data-paths.cjs')

test('uses separate userData and sessionData paths for development and packaged apps', () => {
  const appDataPath = path.join(path.sep, 'Users', 'tester', 'Library', 'Application Support')

  assert.deepEqual(resolveAppDataPaths({ appDataPath, isPackaged: false }), {
    userDataPath: path.join(appDataPath, 'Codex Sidecar Dev'),
    sessionDataPath: path.join(appDataPath, 'Codex Sidecar Dev', 'session-data')
  })

  assert.deepEqual(resolveAppDataPaths({ appDataPath, isPackaged: true }), {
    userDataPath: path.join(appDataPath, 'Codex Sidecar'),
    sessionDataPath: path.join(appDataPath, 'Codex Sidecar', 'session-data')
  })
})
