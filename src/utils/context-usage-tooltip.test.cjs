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

test('context usage tooltip key follows warning thresholds', () => {
  const { getContextUsageTooltipKey } = loadTsModule(path.join(__dirname, 'context-usage-tooltip.ts'))

  assert.equal(getContextUsageTooltipKey(null), 'threads.contextUsageTooltip')
  assert.equal(getContextUsageTooltipKey(69), 'threads.contextUsageTooltip')
  assert.equal(getContextUsageTooltipKey(70), 'threads.contextUsageContinuationTooltip')
  assert.equal(getContextUsageTooltipKey(89), 'threads.contextUsageContinuationTooltip')
  assert.equal(getContextUsageTooltipKey(90), 'threads.contextUsageContinuationUrgentTooltip')
})

test('context usage tooltip messages include continuation guidance', () => {
  const { messages } = loadTsModule(path.join(__dirname, '../i18n/messages.ts'))

  assert.equal(messages.zh.threads.contextUsageTooltip, '已用上下文 {percent}%')
  assert.equal(messages.zh.threads.contextUsageContinuationTooltip, '已用上下文 {percent}%，可考虑使用对话接续')
  assert.equal(messages.zh.threads.contextUsageContinuationUrgentTooltip, '已用上下文 {percent}%，建议使用对话接续')

  assert.equal(messages.en.threads.contextUsageTooltip, 'Context used {percent}%')
  assert.equal(messages.en.threads.contextUsageContinuationTooltip, 'Context used {percent}%, consider using conversation continuation')
  assert.equal(messages.en.threads.contextUsageContinuationUrgentTooltip, 'Context used {percent}%, use conversation continuation')
})
