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

test('account usage stats aggregate today, yesterday, week, and month', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const stats = buildAccountUsageStats({
    dailyUsageBuckets: [
      { startDate: '2026-07-01', tokens: 100 },
      { startDate: '2026-07-05', tokens: 500 },
      { startDate: '2026-07-06', tokens: 600 },
      { startDate: '2026-07-07', tokens: 700 },
      { startDate: '2026-07-08', tokens: 800 },
      { startDate: '2026-07-09', tokens: 900 }
    ]
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.deepEqual(stats.cards.map(card => [card.key, card.tokens, card.estimated]), [
    ['today', 900, false],
    ['yesterday', 800, false],
    ['week', 3000, false],
    ['month', 3600, false]
  ])
})

test('account usage stats expose dates for daily cards', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const stats = buildAccountUsageStats({
    dailyUsageBuckets: []
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.deepEqual(stats.cards.map(card => [card.key, card.date]), [
    ['today', '2026-07-09'],
    ['yesterday', '2026-07-08'],
    ['week', null],
    ['month', null]
  ])
})

test('account usage stats classify today against recent history', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const stats = buildAccountUsageStats({
    dailyUsageBuckets: [
      { startDate: '2026-07-02', tokens: 100 },
      { startDate: '2026-07-03', tokens: 120 },
      { startDate: '2026-07-04', tokens: 80 },
      { startDate: '2026-07-05', tokens: 100 },
      { startDate: '2026-07-06', tokens: 100 },
      { startDate: '2026-07-07', tokens: 100 },
      { startDate: '2026-07-08', tokens: 100 },
      { startDate: '2026-07-09', tokens: 220 }
    ]
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.equal(stats.todayStatus.level, 'high')
  assert.equal(stats.todayStatus.ratio, 2.2)
  assert.equal(stats.todayStatus.averageTokens, 100)
  assert.equal(stats.todayStatus.yesterdayDeltaPercent, 120)
})

test('account usage stats expose chart points sorted by day', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const stats = buildAccountUsageStats({
    dailyUsageBuckets: [
      { startDate: '2026-07-09', tokens: 90 },
      { startDate: '2026-07-07', tokens: 70 },
      { startDate: '2026-07-08', tokens: 80 }
    ]
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.deepEqual(stats.chartPoints, [
    { date: '2026-07-07', tokens: 70, averageTokens: null, estimated: false },
    { date: '2026-07-08', tokens: 80, averageTokens: null, estimated: false },
    { date: '2026-07-09', tokens: 90, averageTokens: 80, estimated: false }
  ])
})

test('account usage stats aggregate trend series by day, week, and month', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const stats = buildAccountUsageStats({
    dailyUsageBuckets: [
      { startDate: '2026-06-30', tokens: 100 },
      { startDate: '2026-07-01', tokens: 200 },
      { startDate: '2026-07-06', tokens: 300 },
      { startDate: '2026-07-09', tokens: 400 }
    ]
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.deepEqual(stats.trendSeries.day.map(point => [point.date, point.endDate, point.tokens, point.estimated, point.partial]), [
    ['2026-06-30', '2026-06-30', 100, false, false],
    ['2026-07-01', '2026-07-01', 200, false, false],
    ['2026-07-06', '2026-07-06', 300, false, false],
    ['2026-07-09', '2026-07-09', 400, false, true]
  ])
  assert.deepEqual(stats.trendSeries.week.map(point => [point.date, point.endDate, point.tokens, point.estimated, point.partial]), [
    ['2026-06-29', '2026-07-05', 300, false, false],
    ['2026-07-06', '2026-07-12', 700, false, true]
  ])
  assert.deepEqual(stats.trendSeries.month.map(point => [point.date, point.endDate, point.tokens, point.estimated, point.partial]), [
    ['2026-06-01', '2026-06-30', 100, false, false],
    ['2026-07-01', '2026-07-31', 900, false, true]
  ])
})

test('account usage stats use dimension-specific moving average windows', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const dayStats = buildAccountUsageStats({
    dailyUsageBuckets: Array.from({ length: 15 }, (_, index) => ({
      startDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
      tokens: index + 1
    }))
  }, {
    nowMs: new Date(2026, 6, 15, 12).getTime()
  })

  assert.equal(dayStats.trendSeries.day.at(-1).averageTokens, 9)

  const weekStats = buildAccountUsageStats({
    dailyUsageBuckets: [
      '2026-05-11',
      '2026-05-18',
      '2026-05-25',
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
      '2026-06-22',
      '2026-06-29',
      '2026-07-06'
    ].map((startDate, index) => ({
      startDate,
      tokens: (index + 1) * 10
    }))
  }, {
    nowMs: new Date(2026, 6, 6, 12).getTime()
  })

  assert.equal(weekStats.trendSeries.week.at(-1).averageTokens, 55)

  const monthStats = buildAccountUsageStats({
    dailyUsageBuckets: Array.from({ length: 7 }, (_, index) => ({
      startDate: `2026-${String(index + 1).padStart(2, '0')}-01`,
      tokens: (index + 1) * 100
    }))
  }, {
    nowMs: new Date(2026, 6, 15, 12).getTime()
  })

  assert.equal(monthStats.trendSeries.month.at(-1).averageTokens, 450)
})

test('account usage stats use local estimate only when official today bucket is missing', () => {
  const { buildAccountUsageStats } = loadTsModule(path.join(__dirname, 'account-usage.ts'))

  const missingOfficialToday = buildAccountUsageStats({
    dailyUsageBuckets: [
      { startDate: '2026-07-08', tokens: 800 }
    ],
    localTodayEstimate: {
      date: '2026-07-09',
      tokens: 900,
      updatedAt: 1700000000000,
      threadCount: 2,
      eventCount: 6,
      source: 'localTranscript'
    }
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.deepEqual(missingOfficialToday.cards.map(card => [card.key, card.tokens, card.estimated]), [
    ['today', 900, true],
    ['yesterday', 800, false],
    ['week', 1700, true],
    ['month', 1700, true]
  ])
  assert.deepEqual(missingOfficialToday.chartPoints.map(point => [point.date, point.tokens, point.estimated]), [
    ['2026-07-08', 800, false],
    ['2026-07-09', 900, true]
  ])
  assert.deepEqual(missingOfficialToday.trendSeries.week.map(point => [point.date, point.tokens, point.estimated]), [
    ['2026-07-06', 1700, true]
  ])
  assert.deepEqual(missingOfficialToday.trendSeries.month.map(point => [point.date, point.tokens, point.estimated]), [
    ['2026-07-01', 1700, true]
  ])

  const officialTodayZero = buildAccountUsageStats({
    dailyUsageBuckets: [
      { startDate: '2026-07-08', tokens: 800 },
      { startDate: '2026-07-09', tokens: 0 }
    ],
    localTodayEstimate: {
      date: '2026-07-09',
      tokens: 900,
      updatedAt: 1700000000000,
      threadCount: 2,
      eventCount: 6,
      source: 'localTranscript'
    }
  }, {
    nowMs: new Date(2026, 6, 9, 12).getTime()
  })

  assert.deepEqual(officialTodayZero.cards.map(card => [card.key, card.tokens, card.estimated]), [
    ['today', 0, false],
    ['yesterday', 800, false],
    ['week', 800, false],
    ['month', 800, false]
  ])
})
