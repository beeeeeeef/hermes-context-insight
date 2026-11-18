const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const pluginPath = path.join(__dirname, '..', 'plugin.js')
const source = fs.readFileSync(pluginPath, 'utf8')

function atom(value) {
  return { value, get() { return this.value }, set(next) { this.value = next } }
}

function load(requests) {
  const calls = []
  const created = []
  const ctx = {
    register: item => { created.push(item); return () => {} },
    onEvent: () => () => {},
    storage: {},
    i18n: { register: bundles => { ctx.bundles = bundles; return () => {} } },
    host: {
      state: {
        focusedSessionId: atom('runtime-1'),
        focusedStoredSessionId: atom('stored-1'),
        focusedSessionProfile: atom('tech'),
        profile: atom('tech'),
        focusedSessionOwner: { get: () => ({ connectionId: 'local', profile: 'tech' }) },
        connectionId: atom('local'),
        focusedUsage: atom({ total: 254688, input: 125988, output: 3132, context_used: 22401, context_max: 1000000 }),
        busy: atom(false)
      },
      request: async (method, params) => {
        calls.push({ method, params })
        const handler = requests[method]
        if (handler === undefined) throw new Error(`unexpected ${method}`)
        return await handler(params)
      }
    }
  }
  const sandbox = {
    atom,
    computed: fn => ({ get: fn }),
    host: ctx.host,
    useValue: value => (typeof value?.get === 'function' ? value.get() : value),
    useState: initial => [initial, () => {}],
    useEffect: () => {},
    useRef: initial => ({ current: initial }),
    setInterval: () => 0,
    clearInterval: () => {},
    jsx: (type, props) => ({ $$typeof: Symbol.for('react.element'), type, props }),
    jsxs: (type, props) => ({ $$typeof: Symbol.for('react.element'), type, props }),
    usePluginI18n: () => (key, ...args) => (typeof args[0] === 'undefined' ? key : `${key}:${args.join(',')}`),
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Math,
    JSON,
    Array,
    Object,
    Promise,
    Error
  }
  const executable = source
    .replace(/^import .*$/gm, '')
    .replace('export default {', 'globalThis.plugin = {')
  vm.createContext(sandbox)
  vm.runInContext(executable, sandbox, { filename: pluginPath })
  return { ctx, calls, created, sandbox, plugin: sandbox.plugin }
}

const STARTED_AT = 1793524760.58
const breakdown = {
  context_used: 28568,
  context_max: 1000000,
  estimated_total: 30930,
  context_source: 'provider_usage_plus_estimate',
  context_estimated: true,
  categories: [
    { id: 'system_prompt', tokens: 5970 },
    { id: 'tool_definitions', tokens: 8327 },
    { id: 'subagent_definitions', tokens: 1171 },
    { id: 'memory', tokens: 3169 },
    { id: 'conversation', tokens: 12293 }
  ]
}

;(async () => {
  const { ctx, calls, created, sandbox } = load({
    'session.active_list': async () => ({
      sessions: [{ id: 'runtime-1', started_at: STARTED_AT, status: 'idle' }]
    }),
    'session.context_breakdown': async () => breakdown
  })

  assert.equal(sandbox.plugin.id, 'hermes-context-insight')
  assert.equal(typeof sandbox.plugin.register, 'function')
  sandbox.plugin.register(ctx)
  assert.equal(created.length, 1)
  assert.equal(created[0].area, 'panes')

  // Localization: both bundles registered, same key set, and the tab label is
  // resolved at render time so it follows the app locale.
  assert.ok(ctx.bundles && ctx.bundles.en && ctx.bundles.zh, 'en and zh bundles registered')
  const enKeys = Object.keys(ctx.bundles.en).sort()
  const zhKeys = Object.keys(ctx.bundles.zh).sort()
  assert.equal(zhKeys.join(','), enKeys.join(','), 'zh bundle must cover every en key')
  assert.equal(created[0].data.tabTitle().type, sandbox.TabTitle)
  const labels = created[0].data.tabTitle()
  assert.ok(labels)

  const model = await sandbox.loadSessionModel({
    request: ctx.host.request,
    sessionId: 'runtime-1',
    profile: 'tech',
    usage: ctx.host.state.focusedUsage.get(),
    now: (STARTED_AT + 3600) * 1000
  })
  assert.equal(model.cumulativeTotal, 254688)
  assert.equal(model.windowPercent, 2.9)
  assert.equal(model.categoryTotal, 30930)
  assert.equal(model.categories.length, 5)
  const conversation = model.categories.find(item => item.id === 'conversation')
  assert.equal(conversation.share, 39.7, 'category share uses estimated-category total, not the window')
  assert.equal(model.elapsedKnown, true)
  assert.equal(model.elapsedMs, 3600000)
  assert.equal(sandbox.elapsedAt(model, 1000, 5000), 3604000)
  // The snapshot itself must carry the counters the panel renders after a
  // refresh; they used to be dropped, which produced "NaN 剩余" and an empty
  // Session facts card.
  assert.equal(typeof model.freeTokens, 'number', 'freeTokens must survive the loader')
  assert.equal(model.freeTokens, 1000000 - 28568)
  assert.equal(model.calls, null, 'absent counters stay null, never zero')
  assert.equal(sandbox.formatTokens(Number.NaN), '—', 'NaN must not render as a number')

  const missing = await sandbox.loadSessionModel({
    request: async () => { throw new Error('down') },
    sessionId: 'runtime-1',
    profile: 'tech',
    usage: null
  })
  assert.equal(missing.breakdownAvailable, false)
  assert.equal(missing.categoryTotal, 0)
  assert.equal(missing.categories.length, 0)
  assert.equal(missing.windowPercent, null)
  assert.equal(missing.elapsedKnown, false)

  const cold = sandbox.buildModel({
    usage: null,
    breakdown: {
      context_used: 0,
      context_max: 0,
      estimated_total: 236000,
      categories: [{ id: 'conversation', tokens: 217000 }, { id: 'system_prompt', tokens: 19000 }]
    }
  })
  assert.equal(cold.contextUsed, null, 'agentless zero is unknown occupancy, not a measured zero')
  assert.equal(cold.contextMax, null)
  assert.equal(cold.windowPercent, null)
  assert.equal(cold.categoryTotal, 236000, 'estimated categories remain visible while occupancy is unavailable')
  assert.equal(cold.freeTokens, null, 'no free-token figure without a measured window')

  const rich = sandbox.buildModel({
    usage: {
      total: 254688, input: 125988, output: 3132,
      model: 'deepseek-v4.1-flash', calls: 708, compressions: 1,
      cache_hit_pct: 90.57, avg_tps: 61.24, avg_latency_s: 1.83
    },
    breakdown: { context_used: 121000, context_max: 1050000, categories: [] },
    now: 100000
  })
  assert.equal(rich.freeTokens, 929000, 'free = capacity - used')
  // Regression: legend rows must keep dot + label + value. A row built as
  // jsxs(type, props, children) loses its children to the key argument.
  const row = sandbox.legendRow({ id: 'conversation', label: '对话', tokens: 122000, share: 86.5 }, 4)
  assert.equal(row.children.length, 3, 'a legend row keeps three cells')
  for (const cell of row.children) {
    assert.equal(cell.$$typeof, Symbol.for('react.element'), 'cells must be React elements, not plain objects')
  }
  assert.equal(row.children[0].props.style.backgroundColor, '#1f9d63', 'dot carries the semantic colour')
  assert.equal(row.children[1].props.children, '对话', 'label survives')
  assert.equal(row.children[2].props.children, '≈122K · 86.5%', 'value survives')

  // Regression: fact tiles are built with jsxs(type, props) — children passed as
  // a third argument are silently dropped, which rendered six blank tiles.
  ctx.host.state.focusedUsage.set({
    total: 82000, input: 70000, output: 12000,
    model: 'deepseek-v4.1-flash', calls: 708, compressions: 1,
    cache_hit_pct: 90.57, avg_tps: 61.24, avg_latency_s: 1.83
  })
  const panel = sandbox.ContextPanel()
  const walk = (node, predicate, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) { node.forEach(child => walk(child, predicate, out)); return out }
    if (node.props) {
      if (predicate(node)) out.push(node)
      if (node.props.children !== undefined) walk(node.props.children, predicate, out)
    }
    return out
  }
  const tiles = walk(panel, node => String(node.props.className || '').includes('flex-col gap-0.5 rounded-md bg-(--ui-bg-tertiary)'))
  assert.equal(tiles.length, 6, 'six fact tiles render')
  for (const tile of tiles) {
    assert.equal(tile.props.children.length, 2, 'each tile keeps its label and value')
    assert.ok(tile.props.children[0].props.children, 'tile label is not empty')
    assert.ok(tile.props.children[1].props.children, 'tile value is not empty')
  }

  const persisted = await sandbox.loadSessionModel({
    request: async () => { throw new Error('gateway down') },
    sessionId: 'runtime-1',
    storedSessionId: 'stored-1',
    profile: 'tech',
    usage: null,
    listPersistedSessions: async () => ({
      sessions: [{ id: 'stored-1', input_tokens: 120000, output_tokens: 453 }]
    })
  })
  assert.equal(persisted.cumulativeTotal, 120453, 'persisted input + output is the labelled fallback')
  assert.equal(persisted.cumulativeApprox, true)
  assert.equal(persisted.cumulativeSource, 'persisted')

  const zeroed = await sandbox.loadSessionModel({
    request: async () => { throw new Error('gateway down') },
    sessionId: 'runtime-1',
    storedSessionId: 'stored-1',
    profile: 'tech',
    usage: { total: 0, input: 0, output: 0 },
    listPersistedSessions: async () => ({
      sessions: [{ id: 'stored-1', input_tokens: 120000, output_tokens: 453 }]
    })
  })
  assert.equal(zeroed.cumulativeTotal, 120453, 'a zeroed cold-start total must not mask persisted counters')
  assert.equal(zeroed.cumulativeApprox, true)

  const liveWins = await sandbox.loadSessionModel({
    request: async () => { throw new Error('gateway down') },
    sessionId: 'runtime-1',
    storedSessionId: 'stored-1',
    profile: 'tech',
    usage: { total: 254688, input: 125988, output: 3132 },
    listPersistedSessions: async () => ({ sessions: [] })
  })
  assert.equal(liveWins.cumulativeTotal, 254688)
  assert.equal(liveWins.cumulativeApprox, false, 'live usage always outranks the persisted fallback')

  const tree = sandbox.ContextPanel()
  assert.ok(tree)
  const section = sandbox.Section({ title: 'T', subtitle: 'S', className: 'bg-(--ui-surface-background)', children: null })
  assert.ok(String(section.props.className).includes('bg-(--ui-surface-background)'))
  const label = sandbox.Section({ title: 'T', subtitle: 'S', children: null })
  assert.ok(String(label.props.className).includes('bg-(--ui-surface-background)'))
  // With session.stats the card runs on one source: uncached input + cache
  // replay + cache write form the input arc, output is the second arc, and the
  // centre is their sum, so nothing on the card can contradict anything else.
  const split = sandbox.presentCumulative({
    cumulativeApprox: false,
    cumulativeParts: { uncached: 41131275, cacheRead: 455919883, cacheWrite: 0, output: 507217 }
  })
  assert.equal(split.kind, 'live')
  assert.equal(split.input, 497051158, 'input arc carries cache replay')
  assert.equal(split.output, 507217)
  assert.equal(split.total, 497558375, 'centre is the sum of the arcs')
  assert.equal(split.value, '497.56M')
  assert.equal(split.cacheHitPct, 91.7, 'hit rate = cache read over all prompt input')
  assert.equal(split.uncached, 41131275)

  // Cache write, when a provider reports it, belongs to the input arc and to the
  // hit-rate base rather than appearing as a third slice.
  const withWrite = sandbox.presentCumulative({
    cumulativeParts: { uncached: 100, cacheRead: 300, cacheWrite: 100, output: 400 }
  })
  assert.equal(withWrite.input, 500)
  assert.equal(withWrite.total, 900)
  assert.equal(withWrite.cacheHitPct, 60)

  // Before the first turn there are no stats, and the card falls back to the
  // usage counters without inventing cache figures.
  const usageOnly = sandbox.presentCumulative({ cumulativeTotal: 254688, cumulativeInput: 125988, cumulativeOutput: 3132, cumulativeApprox: false })
  assert.equal(usageOnly.kind, 'live')
  assert.equal(usageOnly.value, '129K', 'fallback centre is input + output')
  assert.equal(usageOnly.cacheRead, null, 'no cache figure is fabricated')
  assert.equal(usageOnly.cacheHitPct, null)

  const empty = sandbox.presentCumulative({ cumulativeTotal: null })
  assert.equal(empty.kind, 'empty')
  assert.equal(empty.value, '\u2014')
  assert.equal(empty.input, null)

  // The ring is exactly two arcs, and together they are the centre figure.
  const arcs = sandbox.inputOutputSegments({ input: 497051158, output: 507217 })
  assert.equal(arcs.length, 2, 'two arcs only')
  assert.equal(arcs.reduce((sum, seg) => sum + seg.value, 0), 497558375, 'arcs add up to the centre')

  // A tile can carry a hover explanation instead of a label the reader has to
  // decode.
  const hintedTile = sandbox.tile('L', 'V', 'k', 'HINT')
  assert.equal(hintedTile.props.children[1].props.title, 'HINT')

  // No history read at all: the item-count card is gone, so the loader must not
  // pay for the full transcript on any refresh.
  const touched = []
  await sandbox.loadSessionModel({
    request: async method => { touched.push(method); return method === 'session.context_breakdown' ? { context_used: 1, context_max: 10, categories: [] } : { sessions: [] } },
    sessionId: 'runtime-1', profile: 'tech', usage: null, now: Date.now()
  })
  assert.ok(!touched.includes('session.history'), 'the loader no longer reads the transcript')

  // Estimate vs measurement: the gap is reported rather than hidden.
  const gap = await sandbox.loadSessionModel({
    request: async method => {
      if (method === 'session.context_breakdown') return { context_used: 97000, context_max: 1050000, categories: [{ id: 'conversation', label: '对话', tokens: 106000 }] }
      if (method === 'session.active_list') return { sessions: [] }
      throw new Error(method)
    },
    sessionId: 'runtime-1', profile: 'tech', usage: { total: 1 }, now: Date.now()
  })
  assert.equal(gap.estimateDelta, 9000, 'estimate drift is surfaced as a number')


  // The persisted row is read on every refresh: it survives agent rebuilds while
  // the live counters do not, so the card can show both scopes.
  const withRow = await sandbox.loadSessionModel({
    request: async method => {
      if (method === 'session.context_breakdown') return { context_used: 124000, context_max: 1000000, categories: [] }
      if (method === 'session.active_list') return { sessions: [] }
      if (method === 'session.stats') return { input_tokens: 123493, output_tokens: 160, cache_read_tokens: 0, cache_write_tokens: 0 }
      throw new Error(method)
    },
    sessionId: 'runtime-1', storedSessionId: 'stored-1', profile: 'tech',
    usage: { total: 123653 },
    listPersistedSessions: async () => ({ sessions: [{ id: 'stored-1', input_tokens: 479509, output_tokens: 25950 }] }),
    now: Date.now()
  })
  assert.equal(withRow.persistedInput, 479509)
  assert.equal(withRow.persistedOutput, 25950)
  const history = sandbox.historicalTotal(withRow, 123653)
  assert.equal(history.total, 505459, 'persisted total is surfaced')
  assert.equal(sandbox.historicalTotal(withRow, 505459), null, 'hidden when this run already covers it')
  assert.equal(sandbox.historicalTotal({ persistedInput: null }, 1), null, 'absent row hides the line')

  // Window length is a model property: when the breakdown reports 0 (no agent
  // built yet) the usage snapshot may still know it, and that is legitimate.
  const fallback = await sandbox.loadSessionModel({
    request: async method => {
      if (method === 'session.context_breakdown') return { context_used: 0, context_max: 0, categories: [{ id: 'conversation', label: '对话', tokens: 110000 }] }
      if (method === 'session.active_list') return { sessions: [] }
      throw new Error(method)
    },
    sessionId: 'runtime-1',
    profile: 'tech',
    usage: { total: 1000, context_max: 1000000, context_used: 0 },
    now: Date.now()
  })
  assert.equal(fallback.contextMax, 1000000, 'window size falls back to the usage snapshot')
  assert.equal(fallback.contextUsed, null, 'the USED figure is still never borrowed from usage')
  assert.equal(fallback.windowPercent, null)

  // Category names: a missing Hermes label must resolve to a localised name,
  // never to a raw id like "system_prompt".
  const zh = ctx.bundles ? ctx.bundles.zh : null
  const fakeT = key => (zh && zh[key]) || key
  assert.equal(sandbox.categoryLabel({ id: 'system_prompt', label: 'system_prompt' }, fakeT), '系统提示词')
  assert.equal(sandbox.categoryLabel({ id: 'tool_definitions' }, fakeT), '工具定义')
  assert.equal(sandbox.categoryLabel({ id: 'system_prompt', label: '自定义名称' }, fakeT), '自定义名称')
  assert.equal(sandbox.categoryLabel({ id: 'unknown_kind' }, fakeT), 'unknown_kind', 'unknown ids fall back to the id')
  assert.equal(sandbox.categoryColor('system_prompt', 0), '#3b6fd4')
  assert.equal(sandbox.categoryColor('conversation', 3), '#1f9d63')
  assert.equal(sandbox.categoryColor('unknown_thing', 0), '#0e9aa7', 'unknown ids fall back to the palette')
  assert.notEqual(sandbox.categoryColor('system_prompt', 0), sandbox.categoryColor('tool_definitions', 1), 'categories keep distinct colours')

  // Two scales: the window bar must stay small when occupancy is small, while
  // the classified bar normalises so small categories remain visible.
  const bars = sandbox.compositionBars({
    categories: [
      { id: 'system_prompt', label: 'S', tokens: 6300 },
      { id: 'conversation', label: 'C', tokens: 122000 }
    ],
    categoryTotal: 128300,
    contextUsed: 121000,
    contextMax: 1050000
  })
  const windowWidths = bars.windowBar.props.children.map(segment => Number.parseFloat(segment.props.style.width))
  assert.ok(Math.abs(windowWidths[1] - 11.619) < 0.01, `window bar conversation ${windowWidths[1]} should be ~11.6%`)
  assert.ok(windowWidths[0] + windowWidths[1] < 20, 'a small window occupancy must not fill the bar')

  // No window size -> no filled bar at all: a fill would assert an occupancy
  // nobody measured. This was the "capacity unknown but bar looks full" bug.
  const noWindow = sandbox.compositionBars({
    categories: [{ id: 'conversation', label: 'C', tokens: 110000 }],
    categoryTotal: 110000,
    contextUsed: null,
    contextMax: null
  })
  assert.equal(noWindow.windowBar, null, 'no bar without a window denominator')
  assert.equal(sandbox.compositionBars({ categories: [], categoryTotal: 0, contextUsed: null, contextMax: null }), null)

  // Placement repair: run once so a stranded pane is re-adopted, then never
  // again so a deliberate close survives the next reload.
  const repairCalls = []
  const repairStore = new Map()
  const repairCtx = {
    register: () => () => {},
    onEvent: () => () => {},
    onDispose: () => () => {},
    storage: {
      get: key => (repairStore.has(key) ? repairStore.get(key) : null),
      set: (key, value) => { repairStore.set(key, value) }
    }
  }
  sandbox.host.undismissPane = paneId => { repairCalls.push(paneId) }
  sandbox.plugin.register(repairCtx)
  assert.deepEqual(repairCalls, ['hermes-context-insight:panel'], 'first load must clear the remembered close')
  sandbox.plugin.register(repairCtx)
  assert.equal(repairCalls.length, 1, 'the repair must not run again on later reloads')

  console.log('PASS context-insight: model, category denominator, failure state')
})().catch(error => { console.error(error); process.exitCode = 1 })
