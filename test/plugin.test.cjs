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
    setInterval: () => 0,
    clearInterval: () => {},
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
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

  console.log('PASS context-insight: model, category denominator, failure state')
})().catch(error => { console.error(error); process.exitCode = 1 })
