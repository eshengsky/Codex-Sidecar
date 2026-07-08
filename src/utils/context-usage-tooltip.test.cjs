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

test('context usage tooltip params include rounded percent and compact token counts', () => {
  const { getContextUsageTooltipParams } = loadTsModule(path.join(__dirname, 'context-usage-tooltip.ts'))

  assert.deepEqual(getContextUsageTooltipParams(null, 'zh'), null)
  assert.deepEqual(
    getContextUsageTooltipParams({
      percent: 20.4,
      totalTokens: 12472,
      modelContextWindow: 258400,
      updatedAt: 1700000000000
    }, 'zh'),
    {
      percent: 20,
      totalTokens: '12.5k',
      modelContextWindow: '258.4k'
    }
  )
  assert.deepEqual(
    getContextUsageTooltipParams({
      percent: 8.6,
      totalTokens: 9842,
      modelContextWindow: 10000
    }, 'en'),
    {
      percent: 9,
      totalTokens: '9,842',
      modelContextWindow: '10k'
    }
  )
})

test('context usage tooltip messages stay compact and include token counts', () => {
  const { messages } = loadTsModule(path.join(__dirname, '../i18n/messages.ts'))

  assert.equal(messages.zh.threads.contextUsageTooltip, '已用 {percent}% · {totalTokens} / {modelContextWindow} tokens')
  assert.equal(messages.zh.threads.contextUsageContinuationTooltip, undefined)
  assert.equal(messages.zh.threads.contextUsageContinuationUrgentTooltip, undefined)

  assert.equal(messages.en.threads.contextUsageTooltip, 'Used {percent}% · {totalTokens} / {modelContextWindow} tokens')
  assert.equal(messages.en.threads.contextUsageContinuationTooltip, undefined)
  assert.equal(messages.en.threads.contextUsageContinuationUrgentTooltip, undefined)
})
