/**
 * hermes-context-insight — 会话上下文洞察面板。
 *
 * 数据来源（全部为 Hermes Desktop 公开 SDK）：
 * - host.state.focusedUsage：整场会话累计 token（实时）
 * - session.active_list：会话自然起点
 * - session.context_breakdown：当前窗口占用与分类估算
 * - host.listPersistedSessions：冷启动时读取已持久化的 input/output 近似累计
 *
 * 只读：不写盘、不发起外部网络请求、不直接访问数据库；不改变会话内容。
 */
import { atom, host, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-context-insight'

/**
 * Plugin-scoped strings. Hermes resolves them against the app's active locale
 * (`display.language`), so the panel follows the language switcher instead of
 * carrying its own. English is the fallback bundle.
 */
const MESSAGES = {
  en: {
    tab: 'Context',
    title: 'Context Insight',
    lede: 'Cumulative usage, natural elapsed time, and what fills the context window.',
    capacity: total => `Capacity ${total}`,
    cumulative: 'cumulative',
    elapsed: 'elapsed',
    windowTitle: 'Current window',
    tokensUsed: 'Tokens used',
    ofWindow: 'of window',
    free: 'free',
    notMeasured: 'Not measured before the model builds context.',
    barWindow: 'Top bar = occupancy of the window. Grey = unclassified and free.',
    barNoWindow: 'Window size unavailable; bar shows classified content only.',
    factsTitle: 'Session facts',
    factsSubtitle: 'from Hermes usage',
    factModel: 'Model',
    factCalls: 'Model calls',
    factCompressions: 'Compressions',
    factCache: 'Cache hit',
    factTps: 'Avg throughput',
    factLatency: 'Avg latency',
    compositionTitle: 'Estimated composition',
    stateLoading: 'loading',
    stateUnavailable: 'unavailable',
    stateEstimated: 'estimated',
    reading: 'Reading context…',
    contextUnavailable: 'Context unavailable.',
    breakdownUnavailable: 'Context breakdown unavailable.',
    notBuilt: 'Context not built yet — send a message first.',
    classified: 'Classified estimate',
    coverage: pct => `≈${pct}% of window`,
    occupancyUnavailable: 'occupancy unavailable',
    classifiedNote: 'Share of classified content, so small categories stay readable.',
    greyNote: 'Grey is content the breakdown did not attribute.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    awaitingUsage: 'Awaiting live usage',
    persistedHint: (input, output) => `Persisted in ${input} + out ${output}; exact total unavailable after restart`,
    ioHint: (input, output) => `in ${input} · out ${output}`,
    freeHint: (free, max) => `${free} tokens free of ${max}`,
    updatedJustNow: 'Updated just now',
    updatedAgo: seconds => `Updated ${seconds}s ago`,
    notReadYet: 'Not read yet',
    session: id => `Session ${id}`,
    noSession: 'No active session',
    openChat: 'Open a chat to see its context.'
  },
  zh: {
    tab: '上下文',
    title: '上下文洞察',
    lede: '累计用量、自然历时，以及当前上下文都由什么占着。',
    capacity: total => `容量 ${total}`,
    cumulative: '累计',
    elapsed: '历时',
    windowTitle: '当前窗口',
    tokensUsed: '已用 token',
    ofWindow: '占窗口',
    free: '剩余',
    notMeasured: '模型尚未构建上下文，暂无测量值。',
    barWindow: '上方彩条 = 窗口占用比例；灰色为未分类与空闲部分。',
    barNoWindow: '窗口容量未知，彩条仅表示已分类内容的构成。',
    factsTitle: '会话统计',
    factsSubtitle: '数据来自 Hermes',
    factModel: '模型',
    factCalls: '模型调用',
    factCompressions: '压缩次数',
    factCache: '缓存命中',
    factTps: '平均吞吐',
    factLatency: '平均延迟',
    compositionTitle: '估算组成',
    stateLoading: '读取中',
    stateUnavailable: '不可用',
    stateEstimated: '估算',
    reading: '正在读取上下文…',
    contextUnavailable: '上下文不可用。',
    breakdownUnavailable: '上下文分类暂不可用。',
    notBuilt: '上下文尚未构建 —— 先发一条消息试试。',
    classified: '分类合计约',
    coverage: pct => `约占窗口 ${pct}%`,
    occupancyUnavailable: '占用未知',
    classifiedNote: '按已分类内容计算占比，因此小类别也能看清。',
    greyNote: '灰色部分为未能归类的内容。',
    refresh: '刷新',
    refreshing: '刷新中…',
    awaitingUsage: '等待实时用量',
    persistedHint: (input, output) => `来自已保存记录：输入 ${input} + 输出 ${output}；重启后拿不到精确总量`,
    ioHint: (input, output) => `输入 ${input} · 输出 ${output}`,
    freeHint: (free, max) => `共 ${max}，剩余 ${free}`,
    updatedJustNow: '刚刚更新',
    updatedAgo: seconds => `${seconds} 秒前更新`,
    notReadYet: '尚未读取',
    session: id => `会话 ${id}`,
    noSession: '没有活跃会话',
    openChat: '打开一个对话后即可查看上下文。'
  }
}

const $snapshot = atom({ sessionId: null, profile: null, data: null, loading: false, error: '', at: 0 })
const $tick = atom(0)

/** 分类估算合计：只作为分类占比的分母。 */
function sumCategories(categories) {
  let total = 0
  for (const item of categories) {
    if (typeof item?.tokens === 'number' && Number.isFinite(item.tokens)) total += item.tokens
  }
  return total
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatTokens(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
  return `${(value / 1_000_000).toFixed(2)}M`
}

/** Whole counts (calls, compressions) with thousands separators. */
function formatCount(value) {
  if (value === null) return '—'
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatElapsed(ms) {
  if (ms === null || ms < 0) return '—'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** 让已加载的自然历时随当前时钟前进，而不是停在取样时刻。 */
function elapsedAt(data, snapshotAt, now) {
  if (!data?.elapsedKnown || typeof data.elapsedMs !== 'number') return null
  if (typeof snapshotAt !== 'number' || snapshotAt <= 0) return data.elapsedMs
  return data.elapsedMs + Math.max(0, now - snapshotAt)
}

/** One reading of the cumulative total, so the label, marker and hint cannot drift apart. */
function presentCumulative(model) {
  const total = finiteNumber(model?.cumulativeTotal)
  if (total === null) return { kind: 'empty', value: '—', input: null, output: null }
  const input = finiteNumber(model?.cumulativeInput)
  const output = finiteNumber(model?.cumulativeOutput)
  if (model?.cumulativeApprox === true) {
    return { kind: 'approx', value: `≈ ${formatTokens(total)}`, input, output }
  }
  return { kind: 'live', value: formatTokens(total), input, output }
}

const CATEGORY_COLORS = {
  system_prompt: '#3b6fd4',
  tool_definitions: '#e08a1e',
  subagent_definitions: '#8b5cf6',
  memory: '#d6457f',
  conversation: '#1f9d63'
}
const EXTRA_COLORS = ['#0e9aa7', '#7c8a3f', '#b04b3f']

function categoryColor(id, index) {
  if (CATEGORY_COLORS[id]) return CATEGORY_COLORS[id]
  return EXTRA_COLORS[index % EXTRA_COLORS.length]
}

/**
 * Two bars, because one scale cannot answer both questions:
 *  - window bar: how full is the window (small categories collapse to slivers);
 *  - composition bar: what fills the classified part, where small categories
 *    stay readable.
 */
function compositionBars(model) {
  if (!model || model.categories.length === 0) return null
  const windowScale = model.contextMax !== null && model.contextMax > 0
    ? model.contextMax
    : model.contextUsed !== null && model.contextUsed > 0 ? model.contextUsed : null
  const classifiedScale = model.categoryTotal > 0 ? model.categoryTotal : null
  if (windowScale === null && classifiedScale === null) return null

  const row = (scale, label) => jsx('div', {
    className: 'flex h-2.5 w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)',
    role: 'img',
    'aria-label': label,
    children: model.categories.map((item, index) => jsx('div', {
      className: 'h-full',
      style: {
        width: `${scale === null || item.tokens === null ? 0 : Math.min(100, (item.tokens / scale) * 100)}%`,
        backgroundColor: categoryColor(item.id, index),
        boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.10)'
      },
      title: `${item.label} ${formatTokens(item.tokens)} of ${formatTokens(scale)}`
    }, item.id))
  })

  return {
    windowScale,
    classifiedScale,
    windowBar: windowScale === null ? null : row(windowScale, 'Estimated share of the context window'),
    classifiedBar: classifiedScale === null ? null : row(classifiedScale, 'Estimated share of classified content')
  }
}

/**
 * One composition legend row. Returns the props object (not a JSX call) so the
 * label/value pair cannot be dropped by passing children as a third argument —
 * `jsxs(type, props, children)` silently treats that third argument as a key.
 */
function legendRow(item, index) {
  return {
    className: 'flex min-w-0 items-baseline gap-1.5 text-[0.75rem]',
    children: [
      {
        type: 'span',
        props: {
          'aria-hidden': true,
          className: 'mt-1 size-2 shrink-0 rounded-sm',
          style: { backgroundColor: categoryColor(item.id, index) }
        }
      },
      {
        type: 'span',
        props: {
          className: 'min-w-0 break-words text-(--ui-text-secondary)',
          children: item.label
        }
      },
      {
        type: 'span',
        props: {
          className: 'ml-auto shrink-0 text-right tabular-nums text-(--ui-text-tertiary)',
          title: item.tokens === null ? undefined : `${formatCount(item.tokens)} tokens`,
          children: item.share === null
            ? (item.tokens === null ? '—' : `≈${formatTokens(item.tokens)}`)
            : `≈${formatTokens(item.tokens)} · ${item.share}%`
        }
      }
    ]
  }
}

function Section({ title, subtitle, children, className }) {
  return jsxs('section', {
    className: `rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-surface-background) p-3 ${className ?? ''}`,
    children: [
      jsxs('div', { className: 'mb-2 flex items-baseline gap-2', children: [
        jsx('h3', { className: 'text-[0.8125rem] font-medium text-(--ui-text-primary)', children: title }),
        subtitle ? jsx('span', { className: 'ml-auto shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)', children: subtitle }) : null
      ] }),
      children
    ]
  })
}

/** Occupancy ring: the one figure that should read at a glance. */
function OccupancyRing({ percent, label }) {
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const safe = percent === null || !Number.isFinite(percent) ? null : Math.max(0, Math.min(100, percent))
  const offset = safe === null ? circumference : circumference * (1 - safe / 100)
  return jsxs('svg', {
    width: 64, height: 64, viewBox: '0 0 64 64',
    role: 'img',
    'aria-label': label,
    className: 'shrink-0',
    children: [
      jsx('circle', { cx: 32, cy: 32, r: radius, fill: 'none', stroke: 'var(--ui-stroke-secondary)', strokeWidth: 6 }),
      safe === null ? null : jsx('circle', {
        cx: 32, cy: 32, r: radius, fill: 'none',
        stroke: 'var(--ui-accent)', strokeWidth: 6, strokeLinecap: 'round',
        strokeDasharray: `${circumference}`, strokeDashoffset: `${offset}`,
        transform: 'rotate(-90 32 32)'
      }),
      jsx('text', {
        x: 32, y: 32, textAnchor: 'middle', dominantBaseline: 'central',
        fontSize: safe === null ? 11 : 13, fontWeight: 600,
        fill: 'var(--ui-text-primary)',
        children: safe === null ? '—' : `${safe}%`
      })
    ]
  })
}

/**
 * 读取当前聚焦会话的两个只读接口，并归一为面板模型。
 * 任一接口失败都保留其余数据，不把失败解释为零。
 */
async function loadSessionModel({ request, sessionId, storedSessionId, profile, usage, now, listPersistedSessions }) {
  const result = {
    cumulativeTotal: finiteNumber(usage?.total),
    cumulativeInput: finiteNumber(usage?.input),
    cumulativeOutput: finiteNumber(usage?.output),
    cumulativeApprox: false,
    cumulativeSource: finiteNumber(usage?.total) === null ? 'unavailable' : 'live',
    contextUsed: null,
    contextMax: null,
    windowPercent: null,
    categories: [],
    categoryTotal: 0,
    elapsedMs: null,
    elapsedKnown: false,
    breakdownAvailable: false,
    elapsedAvailable: false,
    breakdownError: '',
    activeListError: '',
    // Usage counters travel with the snapshot so the panel keeps rendering them
    // after a refresh; they are read verbatim, never derived.
    model: typeof usage?.model === 'string' && usage.model ? usage.model : null,
    calls: finiteNumber(usage?.calls),
    compressions: finiteNumber(usage?.compressions),
    cacheHitPct: finiteNumber(usage?.cache_hit_pct),
    avgTps: finiteNumber(usage?.avg_tps),
    avgLatencyS: finiteNumber(usage?.avg_latency_s),
    freeTokens: null
  }
  if (!sessionId) return result

  const params = { session_id: sessionId, profile }
  const [breakdownResult, activeResult] = await Promise.all([
    request('session.context_breakdown', params).then(value => ({ ok: true, value }), () => ({ ok: false })),
    request('session.active_list', { profile }).then(value => ({ ok: true, value }), () => ({ ok: false }))
  ])

  if (breakdownResult.ok) {
    result.breakdownAvailable = true
    const model = buildModel({ usage, breakdown: breakdownResult.value, startedAt: null, now })
    result.contextUsed = model.contextUsed
    result.contextMax = model.contextMax
    result.windowPercent = model.windowPercent
    result.categories = model.categories
    result.categoryTotal = model.categoryTotal
    result.freeTokens = model.freeTokens
  } else {
    result.breakdownError = 'Context breakdown unavailable.'
  }

  if (activeResult.ok) {
    const rows = Array.isArray(activeResult.value?.sessions) ? activeResult.value.sessions : []
    const found = rows.find(row => row?.id === sessionId)
    const startedAt = finiteNumber(found?.started_at)
    if (startedAt !== null) {
      result.elapsedAvailable = true
      result.elapsedKnown = true
      result.elapsedMs = Math.max(0, (typeof now === 'number' ? now : Date.now()) - startedAt * 1000)
    }
  } else {
    result.activeListError = 'Session start time unavailable.'
  }

  // Cold start: the live usage atom and agentless stats have no counters yet.
  // A persisted session row still holds input/output, but it is not the same
  // aggregate as usage.total (cache, reasoning and compression lineage differ),
  // so this path is always labelled approximate in the UI.
  // A cold-start usage object can arrive with a zeroed total rather than null.
  // Only a zero with no persisted counters is treated as a real empty session.
  if ((result.cumulativeTotal === null || result.cumulativeTotal === 0) && storedSessionId && profile && typeof listPersistedSessions === 'function') {
    try {
      const page = await listPersistedSessions(null, { profile, limit: 500 })
      const rows = Array.isArray(page?.sessions) ? page.sessions : []
      const wanted = String(storedSessionId)
      const bare = wanted.replace(/^local-/, '')
      const row = rows.find(item => item?.id === wanted || item?.id === bare)
      const input = finiteNumber(row?.input_tokens)
      const output = finiteNumber(row?.output_tokens)
      if (input !== null && output !== null && (input > 0 || output > 0)) {
        result.cumulativeInput = input
        result.cumulativeOutput = output
        result.cumulativeTotal = input + output
        result.cumulativeApprox = true
        result.cumulativeSource = 'persisted'
      }
    } catch {
      // Keep the honest unavailable state; never turn a failed lookup into zero.
    }
  }
  return result
}
function buildModel(input) {
  const usage = input.usage && typeof input.usage === 'object' ? input.usage : null
  const breakdown = input.breakdown && typeof input.breakdown === 'object' ? input.breakdown : null
  const now = typeof input.now === 'number' ? input.now : Date.now()
  const startedAt = finiteNumber(input.startedAt)

  const rawUsed = finiteNumber(breakdown?.context_used)
  const rawMax = finiteNumber(breakdown?.context_max)
  const categories = Array.isArray(breakdown?.categories)
    ? breakdown.categories.filter(item => item && typeof item.id === 'string')
    : []
  const categoryTotal = sumCategories(categories)
  // An agentless cold start can return estimated categories with context_used=0
  // and context_max=0. Those zeros mean "not measured", not "empty window".
  const contextMax = rawMax !== null && rawMax > 0 ? rawMax : null
  const contextUsed = rawUsed === 0 && categoryTotal > 0 ? null : rawUsed

  return {
    cumulativeTotal: finiteNumber(usage?.total),
    cumulativeInput: finiteNumber(usage?.input),
    cumulativeOutput: finiteNumber(usage?.output),
    contextUsed,
    contextMax,
    windowPercent: contextUsed !== null && contextMax !== null && contextMax > 0
      ? Math.min(100, Math.round((contextUsed / contextMax) * 1000) / 10)
      : null,
    categories: categories.map(item => ({
      id: item.id,
      label: typeof item.label === 'string' && item.label ? item.label : item.id,
      tokens: finiteNumber(item.tokens),
      share: categoryTotal > 0 && finiteNumber(item.tokens) !== null
        ? Math.round(((item.tokens / categoryTotal) * 1000)) / 10
        : null
    })),
    categoryTotal,
    elapsedMs: startedAt === null ? null : Math.max(0, now - startedAt * 1000),
    elapsedKnown: startedAt !== null,
    // Counters Hermes already reports on the focused session. They are read
    // verbatim — the plugin never derives or estimates them.
    model: typeof usage?.model === 'string' && usage.model ? usage.model : null,
    calls: finiteNumber(usage?.calls),
    compressions: finiteNumber(usage?.compressions),
    cacheHitPct: finiteNumber(usage?.cache_hit_pct),
    avgTps: finiteNumber(usage?.avg_tps),
    avgLatencyS: finiteNumber(usage?.avg_latency_s),
    freeTokens: contextUsed !== null && contextMax !== null ? Math.max(0, contextMax - contextUsed) : null
  }
}

/** Session counters as label/value rows; absent values are omitted, never zeroed. */
function presentFacts(model) {
  if (!model) return []
  const facts = []
  if (model.model) facts.push({ labelKey: 'factModel', value: model.model })
  if (model.calls !== null) facts.push({ labelKey: 'factCalls', value: formatCount(model.calls) })
  if (model.compressions !== null) facts.push({ labelKey: 'factCompressions', value: formatCount(model.compressions) })
  if (model.cacheHitPct !== null) facts.push({ labelKey: 'factCache', value: `${Math.round(model.cacheHitPct * 10) / 10}%` })
  if (model.avgTps !== null) facts.push({ labelKey: 'factTps', value: `${Math.round(model.avgTps * 10) / 10} tok/s` })
  if (model.avgLatencyS !== null) facts.push({ labelKey: 'factLatency', value: `${Math.round(model.avgLatencyS * 10) / 10}s` })
  return facts
}

function ContextPanel() {
  const t = usePluginI18n(ID)
  const usage = useValue(host.state.focusedUsage)
  const sessionId = useValue(host.state.focusedSessionId)
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const profile = useValue(host.state.focusedSessionProfile)
  const snapshot = useValue($snapshot)
  const tick = useValue($tick)
  const [refreshKey, setRefreshKey] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const usageModel = buildModel({ usage })

  useEffect(() => {
    if (!sessionId) {
      $snapshot.set({ sessionId: null, profile: null, data: null, loading: false, error: '', at: 0 })
      return undefined
    }
    let cancelled = false
    const previous = $snapshot.get()
    const sameSession = previous.sessionId === sessionId && previous.profile === profile
    $snapshot.set({ ...previous, sessionId, profile, data: sameSession ? previous.data : null, loading: true, error: '' })
    loadSessionModel({
      request: host.request,
      sessionId,
      storedSessionId,
      profile,
      usage,
      now: Date.now(),
      listPersistedSessions: typeof host.listPersistedSessions === 'function' ? host.listPersistedSessions.bind(host) : undefined
    })
      .then(data => {
        if (!cancelled) $snapshot.set({ sessionId, profile, data, loading: false, error: '', at: Date.now() })
      })
      .catch(() => {
        if (!cancelled) $snapshot.set({ sessionId, profile, data: null, loading: false, error: 'Could not read context.', at: Date.now() })
      })
    return () => { cancelled = true }
  }, [sessionId, storedSessionId, profile, refreshKey, tick])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const isCurrent = snapshot.sessionId === sessionId && snapshot.profile === profile
  const shown = isCurrent ? snapshot.data : null
  const liveTotal = usageModel.cumulativeTotal
  const zeroedLiveTotal = liveTotal === 0 && shown?.cumulativeApprox === true
  const useLive = liveTotal !== null && !zeroedLiveTotal
  const cumulativeTotal = useLive ? liveTotal : shown?.cumulativeTotal ?? liveTotal ?? null
  const cumulativeApprox = !useLive && shown?.cumulativeApprox === true
  const cumulativeInput = useLive ? usageModel.cumulativeInput : shown?.cumulativeInput ?? usageModel.cumulativeInput
  const cumulativeOutput = useLive ? usageModel.cumulativeOutput : shown?.cumulativeOutput ?? usageModel.cumulativeOutput
  const cumulative = presentCumulative({
    cumulativeTotal,
    cumulativeInput,
    cumulativeOutput,
    cumulativeApprox
  })
  const bars = compositionBars(shown)
  const facts = presentFacts(shown !== null ? shown : usageModel)
  const updatedSeconds = snapshot.at > 0 ? Math.max(0, Math.round((now - snapshot.at) / 1000)) : null
  const cumulativeHint = cumulative.kind === 'empty'
    ? t('awaitingUsage')
    : cumulative.kind === 'approx'
      ? t('persistedHint', formatTokens(cumulative.input), formatTokens(cumulative.output))
      : cumulative.input === null ? '' : t('ioHint', formatTokens(cumulative.input), formatTokens(cumulative.output))

  if (!sessionId) {
    return jsxs('div', { className: 'flex h-full flex-col items-center justify-center gap-2 bg-(--ui-surface-background) px-4 text-center', children: [
      jsx('div', { className: 'text-[0.8125rem] text-(--ui-text-secondary)', children: t('noSession') }),
      jsx('div', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children: t('openChat') })
    ] })
  }

  return jsxs('div', { className: 'flex h-full flex-col gap-2 overflow-auto bg-(--ui-surface-background) p-2 text-(--ui-text-primary)', children: [
    jsx('div', { className: 'text-sm font-semibold', children: t('title') }),
    jsx('p', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: t('lede') }),
    jsx('div', {
      className: 'flex flex-wrap items-baseline gap-x-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
      title: cumulativeHint || undefined,
      children: [
        jsx('span', { className: 'text-(--ui-text-secondary)', children: cumulative.value }),
        jsx('span', { children: t('cumulative') }),
        jsx('span', { 'aria-hidden': true, children: '·' }),
        jsx('span', { className: 'text-(--ui-text-secondary)', children: shown === null || !shown.elapsedKnown ? '—' : formatElapsed(elapsedAt(shown, snapshot.at, now)) }),
        jsx('span', { children: t('elapsed') })
      ]
    }),
    jsx(Section, {
      title: t('windowTitle'),
      subtitle: shown !== null && shown.contextMax !== null ? t('capacity', formatTokens(shown.contextMax)) : null,
      children: jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsxs('div', { className: 'flex items-center justify-between gap-3', children: [
        jsxs('div', { className: 'flex min-w-0 flex-col gap-0.5', children: [
          jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t('tokensUsed') }),
          jsx('span', { className: 'text-[1.5rem] leading-tight font-semibold tabular-nums', children: shown === null || shown.contextUsed === null
            ? '—'
            : `${formatTokens(shown.contextUsed)} / ${shown.contextMax === null ? '—' : formatTokens(shown.contextMax)}` }),
          shown !== null && typeof shown.freeTokens === 'number'
            ? jsx('span', {
                className: 'text-[0.75rem] text-(--ui-text-tertiary)',
                title: shown.contextMax === null ? undefined : t('freeHint', formatCount(shown.freeTokens), formatCount(shown.contextMax)),
                children: `${formatTokens(shown.freeTokens)} ${t('free')}`
              })
            : null
        ] }),
        jsx(OccupancyRing, { percent: shown === null ? null : shown.windowPercent, label: t('ofWindow') })
      ] }),
      shown !== null && (shown.contextUsed === null || shown.contextMax === null)
        ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: t('notMeasured') })
        : null,
      shown !== null && shown.categories.length > 0 && bars !== null && bars.windowBar
        ? bars.windowBar
        : null,
      shown !== null && shown.categories.length > 0
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: bars === null || bars.windowBar === null
          ? t('barNoWindow')
          : t('barWindow') })
        : null
    ] }) }),
    facts.length > 0
      ? jsx(Section, { title: t('factsTitle'), subtitle: t('factsSubtitle'), children: jsx('div', {
          className: 'grid grid-cols-2 gap-1.5',
          children: facts.map(fact => jsxs('div', {
            className: 'flex min-w-0 flex-col gap-0.5 rounded-md bg-(--ui-bg-tertiary) px-2 py-1.5',
            children: [
              jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t(fact.labelKey) }),
              jsx('span', { className: 'truncate text-[0.75rem] font-medium tabular-nums text-(--ui-text-secondary)', title: fact.value, children: fact.value })
            ]
          }))
        }) })
      : null,
    jsx(Section, {
      title: t('compositionTitle'),
      subtitle: shown === null ? t('stateLoading') : shown.breakdownAvailable === false ? t('stateUnavailable') : t('stateEstimated'),
      children: shown === null
        ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: snapshot.loading ? t('reading') : t('contextUnavailable') })
        : shown.breakdownAvailable === false
          ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', title: shown.breakdownError, children: t('breakdownUnavailable') })
          : shown.categories.length === 0
            ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: t('notBuilt') })
            : jsxs('div', { className: 'flex flex-col gap-1.5', children: [
              jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: shown.contextUsed === null || shown.contextMax === null
                ? `${t('classified')} ${formatTokens(shown.categoryTotal)} · ${t('occupancyUnavailable')}`
                : `${t('classified')} ${formatTokens(shown.categoryTotal)} · ${t('coverage', Math.round((shown.categoryTotal / shown.contextMax) * 1000) / 10)}` }),
              bars !== null && bars.classifiedBar
                ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                    bars.classifiedBar,
                    jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t('classifiedNote') })
                  ] })
                : null,
              jsx('div', { className: 'flex flex-col gap-1', children: shown.categories.map((item, index) => jsx('div', legendRow(item, index), item.id)) }),
              jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t('greyNote') })
            ] })
    }),
    jsx('button', {
      type: 'button',
      disabled: snapshot.loading,
      className: 'min-h-8 w-fit rounded-md border border-(--ui-stroke-secondary) px-2.5 py-1 text-[0.75rem] text-(--ui-text-secondary) enabled:hover:bg-(--ui-bg-tertiary) disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-accent)',
      onClick: () => setRefreshKey(value => value + 1),
      children: snapshot.loading ? t('refreshing') : t('refresh')
    }),
    jsxs('div', { className: 'flex items-center justify-between gap-2 text-[0.6875rem] text-(--ui-text-quaternary)', children: [
      jsx('span', { children: updatedSeconds === null
        ? t('notReadYet')
        : updatedSeconds < 2 ? t('updatedJustNow') : t('updatedAgo', updatedSeconds) }),
      jsx('span', { children: t('session', String(sessionId).slice(-8)) })
    ] })
  ] })
}

/** Pane tab label that follows the app locale, unlike the register-time title. */
function TabTitle() {
  const t = usePluginI18n(ID)
  return t('tab')
}

export default {
  id: ID,
  name: 'Context Insight',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n?.register?.(MESSAGES)
    ctx.onEvent('message.complete', event => {
      if (event?.session_id !== host.state.focusedSessionId.get()) return
      $tick.set($tick.get() + 1)
    })
    ctx.register({
      id: 'panel',
      area: 'panes',
      title: 'Context',
      data: { placement: 'right', width: '340px', tabTitle: () => jsx(TabTitle, {}) },
      render: () => jsx(ContextPanel, {})
    })

    // One-time placement repair. A pane that was once closed stays remembered
    // as closed even though it still registers, which strands it outside every
    // tab strip (the plugin looks loaded but never appears). Clearing that
    // remembered close lets adoption re-apply the `placement: 'right'` hint.
    // Runs once, so a later deliberate close is not undone on every reload.
    try {
      if (ctx.storage?.get?.('placementRepaired.v1') !== true) {
        if (typeof host.undismissPane === 'function') host.undismissPane(`${ID}:panel`)
        ctx.storage?.set?.('placementRepaired.v1', true)
      }
    } catch {
      // Older desktops without storage/undismissPane: leave the layout alone.
    }
  }
}
