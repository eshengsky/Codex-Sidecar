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
  assert.equal(packageJson.dependencies['electron-updater'], undefined)
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
  assert.doesNotMatch(builderConfig, /^publish:$/m)
  assert.match(builderConfig, /^  artifactName: \$\{productName\}-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}$/m)
  assert.doesNotMatch(builderConfig, /^  identity: null$/m)
  assert.match(builderConfig, /^\s+- dmg$/m)
  assert.doesNotMatch(builderConfig, /^\s+- zip$/m)
  assert.doesNotMatch(builderConfig, /^\s+arch:$/m)
  assert.doesNotMatch(builderConfig, /^\s+- x64$/m)
  assert.doesNotMatch(builderConfig, /^\s+- arm64$/m)

  assert.equal(fs.existsSync(path.join(rootDir, 'electron', 'auto-update.cjs')), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'rebuild-native.mjs')), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'release-local.mjs')), true)
  assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'merge-mac-update-feed.mjs')), false)
  assert.match(releaseLocalScript, /const arch = process\.arch/)
  assert.match(releaseLocalScript, /arm64: '--arm64'/)
  assert.match(releaseLocalScript, /x64: '--x64'/)
  assert.match(releaseLocalScript, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/)
  assert.match(releaseLocalScript, /rm\(path\.join\(rootDir, 'release'\), \{ recursive: true, force: true \}\)/)
  assert.doesNotMatch(releaseLocalScript, /--x64['"],\s*['"]--arm64/)
})

test('release workflow builds signed mac dmg artifacts per architecture without update feed assets', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  const releaseWorkflow = readOptional(path.join(rootDir, '.github', 'workflows', 'release.yml'))
  const mainProcessSource = fs.readFileSync(path.join(rootDir, 'electron', 'main.cjs'), 'utf8')

  assert.equal(packageJson.scripts.release, undefined)
  assert.doesNotMatch(mainProcessSource, /auto-update\.cjs/)
  assert.doesNotMatch(mainProcessSource, /configureAutoUpdates/)

  assert.match(releaseWorkflow, /^name: Release$/m)
  assert.match(releaseWorkflow, /^  workflow_dispatch:$/m)
  assert.match(releaseWorkflow, /^  push:$/m)
  assert.match(releaseWorkflow, /^      - 'v\*'$/m)
  assert.match(releaseWorkflow, /^permissions:$/m)
  assert.match(releaseWorkflow, /^  contents: write$/m)

  assert.match(releaseWorkflow, /^          - id: mac-arm64$/m)
  assert.match(releaseWorkflow, /^            runner: macos-15$/m)
  assert.match(releaseWorkflow, /^            electron_builder_args: --mac dmg --arm64$/m)
  assert.match(releaseWorkflow, /^          - id: mac-x64$/m)
  assert.match(releaseWorkflow, /^            runner: macos-15-intel$/m)
  assert.match(releaseWorkflow, /^            electron_builder_args: --mac dmg --x64$/m)

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
  assert.match(releaseWorkflow, /gh release upload "\$GITHUB_REF_NAME" "\$\{artifacts\[@\]\}" --clobber/)
  assert.match(releaseWorkflow, /find release -maxdepth 1 -type f -name '\*\.dmg'/)
  assert.doesNotMatch(releaseWorkflow, /latest-mac/)
  assert.doesNotMatch(releaseWorkflow, /\.blockmap/)
  assert.doesNotMatch(releaseWorkflow, /\.zip/)
  assert.doesNotMatch(releaseWorkflow, /merge-mac-update-feed/)
})
