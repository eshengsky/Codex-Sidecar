const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appSource = fs.readFileSync(path.join(__dirname, 'App.vue'), 'utf8')
const iconifyLocalSource = fs.readFileSync(path.join(__dirname, 'plugins/iconify-local.ts'), 'utf8')

test('usage tab chart icon is registered in the local lucide collection', () => {
  assert.match(appSource, /icon: 'i-lucide-chart-spline'/)
  assert.match(iconifyLocalSource, /'chart-spline'/)
})
