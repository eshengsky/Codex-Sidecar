const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.join(__dirname, '..')
const readOptional = filePath => {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return ''
    }

    throw error
  }
}

test('packaging config rebuilds native app dependencies and keeps local release on host arch', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  const npmrc = readOptional(path.join(rootDir, '.npmrc'))
  const pnpmWorkspace = fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8')
  const builderConfig = readOptional(path.join(rootDir, 'electron-builder.yml'))
  const releaseLocalScript = readOptional(path.join(rootDir, 'scripts', 'release-local.mjs'))

  assert.equal(packageJson.scripts.postinstall, 'electron-builder install-app-deps')
  assert.equal(packageJson.scripts['release:local'], 'node scripts/release-local.mjs')
  assert.equal(packageJson.scripts['pack:mac'], undefined)
  assert.equal(packageJson.scripts['pack:mac:x64'], undefined)
  assert.equal(packageJson.scripts['pack:mac:arm64'], undefined)
  assert.equal(packageJson.scripts['pack:mac:dir'], undefined)
  assert.match(packageJson.dependencies['electron-updater'], /^\^/)
  assert.match(packageJson.devDependencies['electron-builder'], /^\^/)

  assert.match(npmrc, /^node-linker=hoisted$/m)
  assert.match(pnpmWorkspace, /^  electron-winstaller: true$/m)

  assert.match(builderConfig, /^appId: com\.skysun\.codex-sidecar$/m)
  assert.match(builderConfig, /^productName: Codex Sidecar$/m)
  assert.match(builderConfig, /^\s+output: release$/m)
  assert.match(builderConfig, /^asar: true$/m)
  assert.match(builderConfig, /^\s+- '\*\*\/\*\.node'$/m)
  assert.match(builderConfig, /^npmRebuild: true$/m)
  assert.match(builderConfig, /^nativeRebuilder: sequential$/m)
  assert.match(builderConfig, /^nodeGypRebuild: false$/m)
  assert.match(builderConfig, /^  icon: build\/icon\.icns$/m)
  assert.match(builderConfig, /^publish:\n  provider: github\n  owner: eshengsky\n  repo: Codex-Sidecar$/m)
  assert.match(builderConfig, /^  artifactName: Codex-Sidecar-mac-\$\{arch\}\.\$\{ext\}$/m)
  assert.doesNotMatch(builderConfig, /\$\{productName\}-mac/)
  assert.doesNotMatch(builderConfig, /\$\{version\}-mac/)
  assert.doesNotMatch(builderConfig, /^  identity: null$/m)
  assert.match(builderConfig, /^\s+- dmg$/m)
  assert.match(builderConfig, /^\s+- zip$/m)
  assert.doesNotMatch(builderConfig, /^\s+arch:$/m)
  assert.doesNotMatch(builderConfig, /^\s+- x64$/m)
  assert.doesNotMatch(builderConfig, /^\s+- arm64$/m)

  assert.equal(fs.existsSync(path.join(rootDir, 'electron', 'auto-update.cjs')), true)
  assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'rebuild-native.mjs')), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'release-local.mjs')), true)
  assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'merge-mac-update-feed.mjs')), true)
  assert.match(releaseLocalScript, /const arch = process\.arch/)
  assert.match(releaseLocalScript, /arm64: '--arm64'/)
  assert.match(releaseLocalScript, /x64: '--x64'/)
  assert.match(releaseLocalScript, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/)
  assert.match(releaseLocalScript, /rm\(path\.join\(rootDir, 'release'\), \{ recursive: true, force: true \}\)/)
  assert.doesNotMatch(releaseLocalScript, /--x64['"],\s*['"]--arm64/)
})

test('release workflow builds signed mac dmg and update feed artifacts per architecture', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  const releaseWorkflow = readOptional(path.join(rootDir, '.github', 'workflows', 'release.yml'))
  const mainProcessSource = fs.readFileSync(path.join(rootDir, 'electron', 'main.cjs'), 'utf8')

  assert.equal(packageJson.scripts.release, undefined)
  assert.match(mainProcessSource, /auto-update\.cjs/)
  assert.match(mainProcessSource, /initializeAutoUpdate/)
  assert.match(mainProcessSource, /scheduleAutoUpdateCheck/)

  assert.match(releaseWorkflow, /^name: Release$/m)
  assert.match(releaseWorkflow, /^  workflow_dispatch:$/m)
  assert.match(releaseWorkflow, /^  push:$/m)
  assert.match(releaseWorkflow, /^      - 'v\*'$/m)
  assert.match(releaseWorkflow, /^permissions:$/m)
  assert.match(releaseWorkflow, /^  contents: write$/m)

  assert.match(releaseWorkflow, /^          - id: mac-arm64$/m)
  assert.match(releaseWorkflow, /^            runner: macos-15$/m)
  assert.match(releaseWorkflow, /^            electron_builder_args: --mac dmg zip --arm64$/m)
  assert.match(releaseWorkflow, /^          - id: mac-x64$/m)
  assert.match(releaseWorkflow, /^            runner: macos-15-intel$/m)
  assert.match(releaseWorkflow, /^            electron_builder_args: --mac dmg zip --x64$/m)

  assert.match(releaseWorkflow, /Validate tag matches package version/)
  assert.match(releaseWorkflow, /pnpm install --frozen-lockfile/)
  assert.match(releaseWorkflow, /pnpm exec electron-builder \$ELECTRON_BUILDER_ARGS --publish never/)
  assert.match(releaseWorkflow, /CSC_LINK: \$\{\{ secrets\.CSC_LINK \}\}/)
  assert.match(releaseWorkflow, /CSC_KEY_PASSWORD: \$\{\{ secrets\.CSC_KEY_PASSWORD \}\}/)
  assert.match(releaseWorkflow, /APPLE_ID: \$\{\{ secrets\.APPLE_ID \}\}/)
  assert.match(releaseWorkflow, /APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ secrets\.APPLE_APP_SPECIFIC_PASSWORD \}\}/)
  assert.match(releaseWorkflow, /APPLE_TEAM_ID: \$\{\{ secrets\.APPLE_TEAM_ID \}\}/)
  assert.match(releaseWorkflow, /Missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID/)
  assert.match(releaseWorkflow, /find release -maxdepth 3 -name 'Codex Sidecar\.app' -type d/)
  assert.match(releaseWorkflow, /codesign --verify --deep --strict --verbose=2/)
  assert.match(releaseWorkflow, /spctl --assess --type execute --verbose/)
  assert.match(releaseWorkflow, /ditto -x -k "\$ZIP_PATH" "\$ZIP_EXTRACT_DIR"/)
  assert.match(releaseWorkflow, /hdiutil attach -nobrowse -readonly/)
  assert.match(releaseWorkflow, /hdiutil detach/)
  assert.match(releaseWorkflow, /--sidecar-engine-smoke/)
  assert.match(releaseWorkflow, /SIDECAR_SMOKE_APP_DATA_PATH/)
  assert.match(releaseWorkflow, /sidecar-v2\.sqlite/)
  assert.match(mainProcessSource, /--sidecar-engine-smoke/)
  assert.match(mainProcessSource, /SIDECAR_ENGINE_SMOKE/)
  assert.match(
    mainProcessSource,
    /isDataEngineSmokeMode[\s\S]*dataEngine\.request\('projection\.refresh', null, \{[\s\S]*timeoutMs:\s*120_000/
  )
  assert.match(releaseWorkflow, /gh release upload "\$GITHUB_REF_NAME" "\$\{artifacts\[@\]\}" --clobber/)
  assert.match(releaseWorkflow, /find release -maxdepth 1 -type f -name '\*\.dmg'/)
  assert.match(releaseWorkflow, /find release -maxdepth 1 -type f -name '\*\.zip'/)
  assert.match(releaseWorkflow, /find release -maxdepth 1 -type f -name '\*\.zip\.blockmap'/)
  assert.match(releaseWorkflow, /latest-mac-\$\{\{ matrix\.id \}\}\.yml/)
  assert.match(releaseWorkflow, /merge-mac-update-feed\.mjs/)
  assert.match(releaseWorkflow, /Upload merged latest-mac\.yml/)
  assert.match(releaseWorkflow, /delete-asset "\$GITHUB_REF_NAME" latest-mac-mac-arm64\.yml/)
  assert.match(releaseWorkflow, /delete-asset "\$GITHUB_REF_NAME" latest-mac-mac-x64\.yml/)
})

test('readme download links point to stable latest release assets by architecture', () => {
  const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8')
  const readmeZh = fs.readFileSync(path.join(rootDir, 'README.zh-CN.md'), 'utf8')
  const arm64Url = 'https://github.com/eshengsky/Codex-Sidecar/releases/latest/download/Codex-Sidecar-mac-arm64.dmg'
  const x64Url = 'https://github.com/eshengsky/Codex-Sidecar/releases/latest/download/Codex-Sidecar-mac-x64.dmg'

  for (const source of [readme, readmeZh]) {
    assert.match(source, new RegExp(arm64Url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(source, new RegExp(x64Url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(source, /Codex Sidecar-<version>-mac-/)
    assert.doesNotMatch(source, /Codex\.Sidecar-<version>-mac-/)
    assert.doesNotMatch(source, /Codex\.Sidecar-mac-(arm64|x64)\.dmg/)
  }
})
