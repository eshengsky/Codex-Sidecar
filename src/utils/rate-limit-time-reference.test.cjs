const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

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

test('rate limit time reference tracks elapsed window time', () => {
  const { getRateLimitTimeReferencePercent } = loadTsModule(path.join(__dirname, 'rate-limit-time-reference.ts'))
  const nowMs = new Date(2026, 6, 9, 12).getTime()

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: 300,
    resetsAt: nowMs + 150 * 60 * 1000,
    mode: 'used',
    nowMs
  }), 50)

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: 300,
    resetsAt: nowMs + 150 * 60 * 1000,
    mode: 'remaining',
    nowMs
  }), 50)
})

test('rate limit time reference mirrors remaining mode and clamps invalid windows', () => {
  const { getRateLimitTimeReferencePercent } = loadTsModule(path.join(__dirname, 'rate-limit-time-reference.ts'))
  const nowMs = new Date(2026, 6, 9, 12).getTime()

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: 10080,
    resetsAt: nowMs + 0.25 * 10080 * 60 * 1000,
    mode: 'used',
    nowMs
  }), 75)

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: 10080,
    resetsAt: nowMs + 0.25 * 10080 * 60 * 1000,
    mode: 'remaining',
    nowMs
  }), 25)

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: 300,
    resetsAt: nowMs + 400 * 60 * 1000,
    mode: 'used',
    nowMs
  }), 0)

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: 300,
    resetsAt: nowMs - 10 * 60 * 1000,
    mode: 'used',
    nowMs
  }), 100)

  assert.equal(getRateLimitTimeReferencePercent({
    windowDurationMins: null,
    resetsAt: nowMs + 60 * 1000,
    mode: 'used',
    nowMs
  }), null)
})

test('rate limit pace indicator only warns when token use is ahead of elapsed time', () => {
  const { isRateLimitUsageAheadOfTime } = loadTsModule(path.join(__dirname, 'rate-limit-time-reference.ts'))
  const nowMs = new Date(2026, 6, 9, 12).getTime()

  assert.equal(isRateLimitUsageAheadOfTime({
    usedPercent: 50.1,
    windowDurationMins: 300,
    resetsAt: nowMs + 150 * 60 * 1000,
    nowMs
  }), true)

  assert.equal(isRateLimitUsageAheadOfTime({
    usedPercent: 50,
    windowDurationMins: 300,
    resetsAt: nowMs + 150 * 60 * 1000,
    nowMs
  }), false)

  assert.equal(isRateLimitUsageAheadOfTime({
    usedPercent: 60,
    windowDurationMins: 10080,
    resetsAt: nowMs + 0.5 * 10080 * 60 * 1000,
    nowMs
  }), true)

  assert.equal(isRateLimitUsageAheadOfTime({
    usedPercent: null,
    windowDurationMins: 300,
    resetsAt: nowMs + 150 * 60 * 1000,
    nowMs
  }), false)
})
