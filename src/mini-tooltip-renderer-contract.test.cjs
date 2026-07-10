const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.join(__dirname, '..')
const tooltipWindowFiles = [
  'electron/mini-tooltip.cjs',
  'electron/mini-tooltip.test.cjs',
  'src/components/MiniTooltip.vue',
  'src/directives/mini-tooltip.ts'
]
const tooltipWindowSources = [
  'electron/main.cjs',
  'electron/preload.cjs',
  'src/App.vue',
  'src/env.d.ts',
  'src/types/sidecar.ts'
]

test('mini tooltips stay in the renderer without an Electron window bridge', () => {
  for (const relativePath of tooltipWindowFiles) {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), false, `${relativePath} should not exist`)
  }

  for (const relativePath of tooltipWindowSources) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
    assert.doesNotMatch(source, /mini-tooltip|MiniTooltip|miniTooltip|showMiniTooltip|hideMiniTooltip|reportMiniTooltipSize|onMiniTooltipData/)
  }
})
