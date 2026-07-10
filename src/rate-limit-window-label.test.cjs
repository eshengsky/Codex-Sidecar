const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const readSource = relativePath => fs.readFileSync(path.join(__dirname, relativePath), 'utf8')

const loadTsModule = filePath => {
  const source = fs.readFileSync(filePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  })
  const mod = new Module(filePath, module)

  mod.filename = filePath
  mod.paths = Module._nodeModulePaths(path.dirname(filePath))
  mod._compile(outputText, filePath)
  return mod.exports
}

test('rate limit windows derive labels from service durations instead of fixed slots', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const miniBarSource = readSource('components/MiniBar.vue')
  const usageMeterSource = readSource('components/UsageMeter.vue')

  assert.doesNotMatch(mainSource, /normalizeRateLimitWindow\('5 小时'/)
  assert.doesNotMatch(mainSource, /normalizeRateLimitWindow\('1 周'/)
  assert.doesNotMatch(miniBarSource, />5h</)
  assert.doesNotMatch(miniBarSource, />7d</)
  assert.match(miniBarSource, /formatRateLimitWindowShortLabel/)
  assert.match(usageMeterSource, /formatRateLimitWindowLabel/)
  assert.match(usageMeterSource, /shouldShowRateLimitResetDate/)
})

test('rate limit window labels cover free monthly and paid rolling windows', () => {
  const {
    formatRateLimitWindowLabel,
    formatRateLimitWindowShortLabel,
    shouldShowRateLimitResetDate
  } = loadTsModule(path.join(__dirname, 'utils/rate-limit-window-label.ts'))

  assert.equal(formatRateLimitWindowLabel(300, 'zh'), '5 小时')
  assert.equal(formatRateLimitWindowLabel(300, 'en'), '5 hours')
  assert.equal(formatRateLimitWindowShortLabel(300), '5h')

  assert.equal(formatRateLimitWindowLabel(10080, 'zh'), '1 周')
  assert.equal(formatRateLimitWindowLabel(10080, 'en'), '1 week')
  assert.equal(formatRateLimitWindowShortLabel(10080), '7d')

  assert.equal(formatRateLimitWindowLabel(43200, 'zh'), '1 个月')
  assert.equal(formatRateLimitWindowLabel(43200, 'en'), '1 month')
  assert.equal(formatRateLimitWindowShortLabel(43200), '30d')

  assert.equal(shouldShowRateLimitResetDate(300), false)
  assert.equal(shouldShowRateLimitResetDate(10080), true)
  assert.equal(shouldShowRateLimitResetDate(43200), true)
})
