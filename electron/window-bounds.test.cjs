const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('mini default window bounds use full display bounds instead of work area', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')

  assert.match(
    mainSource,
    /const area = mode === 'mini' \? display\.bounds : display\.workArea/
  )
})
