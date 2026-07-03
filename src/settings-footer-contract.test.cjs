const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.join(__dirname, '..')
const settingsPanelSource = fs.readFileSync(path.join(__dirname, 'components/panels/SettingsPanel.vue'), 'utf8')
const envSource = fs.readFileSync(path.join(__dirname, 'env.d.ts'), 'utf8')
const mainSource = fs.readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(rootDir, 'electron/preload.cjs'), 'utf8')

test('settings footer shows the package version and opens GitHub through the main process', () => {
  assert.match(settingsPanelSource, /import packageJson from '..\/..\/..\/package\.json'/)
  assert.match(settingsPanelSource, /const appVersion = packageJson\.version/)
  assert.match(settingsPanelSource, /Codex Sidecar/)
  assert.match(settingsPanelSource, /v\{\{ appVersion \}\}/)
  assert.match(settingsPanelSource, /window\.sidecar\.openGitHub\(\)/)

  assert.match(mainSource, /const \{ version: APP_VERSION \} = require\('\.\.\/package\.json'\)/)
  assert.doesNotMatch(mainSource, /const APP_VERSION = ['"]/)
  assert.match(mainSource, /const APP_REPOSITORY_URL = 'https:\/\/github\.com\/eshengsky\/Codex-Sidecar'/)
  assert.match(mainSource, /ipcMain\.handle\('sidecar:openGitHub'[\s\S]*shell\.openExternal\(APP_REPOSITORY_URL\)/)

  assert.match(preloadSource, /openGitHub: \(\) => ipcRenderer\.invoke\('sidecar:openGitHub'\)/)
  assert.match(envSource, /openGitHub: \(\) => Promise<boolean>/)
})
