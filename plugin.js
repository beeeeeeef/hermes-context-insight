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
import { atom, host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-context-insight'

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
  if (value === null) return '—'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
  return `${(value / 1_000_000).toFixed(2)}M`
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
  if (total === null) return { kind: 'empty', value: '—', hint: 'Awaiting live usage' }
  const input = finiteNumber(model?.cumulativeInput)
  const output = finiteNumber(model?.cumulativeOutput)
  if (model?.cumulativeApprox === true) {
    return {
      kind: 'approx',
      value: `≈ ${formatTokens(total)}`,
      hint: `Persisted in ${formatTokens(input)} + out ${formatTokens(output)}; exact total unavailable after restart`
    }
  }
  return {
    kind: 'live',
    value: formatTokens(total),
    hint: input === null ? '' : `in ${formatTokens(input)} · out ${formatTokens(output)}`
  }
}

function Metric({ label, value, hint }) {
  return jsxs('div', {
    className: 'flex flex-col gap-0.5',
    children: [
      jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: label }),
      jsx('span', { className: 'text-[0.875rem] font-medium text-(--ui-text-primary)', children: value }),
      hint ? jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: hint }) : null
    ]
  })
}

/**
 * Fixed semantic colours per category id. Stable across sessions on purpose:
 * the bar is read by colour, so a category must not change colour because the
 * theme changed. Unknown ids cycle through the same palette.
 */
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
    className: 'flex h-2 w-full overflow-hidden rounded-sm bg-(--ui-stroke-secondary)',
    'aria-label': label,
    children: model.categories.map((item, index) => jsx('div', {
      className: 'h-full',
      style: {
        width: `${scale === null || item.tokens === null ? 0 : Math.min(100, (item.tokens / scale) * 100)}%`,
        backgroundColor: categoryColor(item.id, index)
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

function Section({ title, subtitle, children, className }) {
  return jsxs('section', {
    className: `rounded-md border border-(--ui-stroke-secondary) bg-(--ui-surface-background) p-2.5 ${className ?? ''}`,
    children: [
      jsxs('div', { className: 'mb-1.5 flex items-baseline gap-2', children: [
        jsx('h3', { className: 'text-[0.75rem] font-medium text-(--ui-text-primary)', children: title }),
        subtitle ? jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: subtitle }) : null
      ] }),
      children
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
    activeListError: ''
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
    elapsedKnown: startedAt !== null
  }
}

function ContextPanel() {
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

  if (!sessionId) {
    return jsxs('div', { className: 'flex h-full flex-col items-center justify-center gap-2 bg-(--ui-surface-background) px-4 text-center', children: [
      jsx('div', { className: 'text-[0.8125rem] text-(--ui-text-secondary)', children: 'No active session' }),
      jsx('div', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children: 'Open a chat to see its context.' })
    ] })
  }

  return jsxs('div', { className: 'flex h-full flex-col gap-2 overflow-auto bg-(--ui-surface-background) p-2 text-(--ui-text-primary)', children: [
    jsx('div', { className: 'text-sm font-semibold', children: 'Context Insight' }),
    jsx('p', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: 'Cumulative usage, session elapsed time, and current context composition. Category estimates are approximate.' }),
    jsx('div', {
      className: 'flex flex-wrap items-baseline gap-x-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
      children: [
        jsx('span', { className: 'text-(--ui-text-secondary)', children: cumulative.value }),
        jsx('span', { children: 'cumulative' }),
        jsx('span', { 'aria-hidden': true, children: '·' }),
        jsx('span', { className: 'text-(--ui-text-secondary)', children: shown === null || !shown.elapsedKnown ? '—' : formatElapsed(elapsedAt(shown, snapshot.at, now)) }),
        jsx('span', { children: 'elapsed' })
      ]
    }),
    jsx(Section, { title: 'Current window', children: jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsxs('div', { className: 'flex items-baseline justify-between gap-2', children: [
        jsxs('div', { className: 'flex min-w-0 flex-col gap-0.5', children: [
          jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'Tokens used' }),
          jsx('span', { className: 'text-[1.25rem] leading-tight font-semibold tabular-nums', children: shown === null || shown.contextUsed === null
            ? '—'
            : `${formatTokens(shown.contextUsed)} / ${shown.contextMax === null ? '—' : formatTokens(shown.contextMax)}` })
        ] }),
        jsxs('div', { className: 'flex shrink-0 flex-col items-end gap-0.5', children: [
          jsx('span', { className: 'text-[1.25rem] leading-tight font-semibold tabular-nums', children: shown === null || shown.windowPercent === null ? '—' : `${shown.windowPercent}%` }),
          jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'of window' })
        ] })
      ] }),
      shown !== null && (shown.contextUsed === null || shown.contextMax === null)
        ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: 'Not measured before the model builds context.' })
        : null,
      shown !== null && shown.categories.length > 0 && bars !== null && bars.windowBar
        ? bars.windowBar
        : null,
      shown !== null && shown.categories.length > 0
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: bars === null || bars.windowBar === null
          ? 'Window size unavailable; bar shows classified content only.'
          : 'Top bar = occupancy of the window. Grey = unclassified and free.' })
        : null
    ] }) }),
    jsx(Section, {
      title: 'Estimated composition',
      subtitle: shown === null ? 'loading' : shown.breakdownAvailable === false ? 'unavailable' : 'estimated',
      children: shown === null
        ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: snapshot.loading ? 'Reading context…' : 'Context unavailable.' })
        : shown.breakdownAvailable === false
          ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: shown.breakdownError || 'Context breakdown unavailable.' })
          : shown.categories.length === 0
            ? jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: 'Context not built yet — send a message first.' })
            : jsxs('div', { className: 'flex flex-col gap-1.5', children: [
              jsx('div', { className: 'text-[0.75rem] text-(--ui-text-secondary)', children: shown.contextUsed === null || shown.contextMax === null
                ? `Classified estimate ${formatTokens(shown.categoryTotal)} · occupancy unavailable`
                : `Classified estimate ${formatTokens(shown.categoryTotal)}` }),
              bars !== null && bars.classifiedBar
                ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                    bars.classifiedBar,
                    jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'Share of classified content, so small categories stay readable.' })
                  ] })
                : null,
              jsx('div', { className: 'grid grid-cols-2 gap-x-2 gap-y-1', children: shown.categories.map((item, index) => jsxs('div', {
                className: 'flex min-w-0 items-baseline gap-1.5 text-[0.75rem]'
              }, [
                jsx('span', {
                  'aria-hidden': true,
                  className: 'mt-1 size-2 shrink-0 rounded-sm',
                  style: { backgroundColor: categoryColor(item.id, index) }
                }),
                jsx('span', { className: 'min-w-0 break-words text-(--ui-text-secondary)', children: item.label }),
                jsx('span', { className: 'ml-auto shrink-0 tabular-nums text-(--ui-text-tertiary)', children: item.share === null ? '—' : `${item.share}%` })
              ])) }),
              jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'Grey is content the breakdown did not attribute.' })
            ] })
    }),
    jsx('button', {
      type: 'button',
      disabled: snapshot.loading,
      className: 'min-h-8 w-fit rounded-md border border-(--ui-stroke-secondary) px-2.5 py-1 text-[0.75rem] text-(--ui-text-secondary) enabled:hover:bg-(--ui-bg-tertiary) disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-accent)',
      onClick: () => setRefreshKey(value => value + 1),
      children: snapshot.loading ? 'Refreshing…' : 'Refresh'
    }),
    jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: `Session ${String(sessionId).slice(-8)}` })
  ] })
}

export default {
  id: ID,
  name: 'Context Insight',
  defaultEnabled: true,
  register(ctx) {
    ctx.onEvent('message.complete', event => {
      if (event?.session_id !== host.state.focusedSessionId.get()) return
      $tick.set($tick.get() + 1)
    })
    ctx.register({
      id: 'panel',
      area: 'panes',
      title: 'Context',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(ContextPanel, {})
    })
  }
}
