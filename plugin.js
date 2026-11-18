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
    capacity: total => `Capacity ${total}`,
    windowTitle: 'Current window',
    tokensUsed: 'Tokens used',
    ofWindow: 'of window',
    free: 'free',
    barWindowAria: 'Estimated share of the context window',
    barWindow: 'Top bar = occupancy of the window. Grey = unclassified and free.',
    barNoWindow: 'Window size unavailable, so no occupancy bar is drawn — the list below is composition only.',
    stateEstimated: 'estimated',
    reading: 'Reading context…',
    contextUnavailable: 'Context unavailable.',
    breakdownUnavailable: 'Context breakdown unavailable.',
    notBuilt: 'Context not built yet — send a message first.',
    classified: 'Classified estimate',
    coverage: pct => `≈${pct}% of window`,
    occupancyUnavailable: 'occupancy unavailable',
    greyNote: 'Grey is content the breakdown did not attribute.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    awaitingUsage: 'Awaiting live usage',
    persistedHint: (input, output) => `Persisted in ${input} + out ${output}; exact total unavailable after restart`,
    freeHint: (free, max) => `${free} tokens free of ${max}`,
    updatedJustNow: 'Updated just now',
    updatedAgo: seconds => `Updated ${seconds}s ago`,
    notReadYet: 'Not read yet',
    session: id => `Session ${id}`,
    cumulativeTitle: 'Session total',
    historyLine: (total, input, output) => `Session total ≈ ${total} (input ${input} + output ${output}, including usage before this run) with no cache split`,
    runScopeNote: 'Counted since this run started. Hermes rebuilds the agent on restart or after a context compression, and these counters restart with it.',
    totalTokens: 'Total tokens',
    uncachedInput: 'Uncached input',
    cacheReadLabel: 'Cache read',
    outputLabel: 'Output',
    elapsedTitle: 'Timing',
    totalElapsed: 'Elapsed',
    latencyLabel: 'Avg latency',
    timingSummary: (elapsed, latency, cache) => `${elapsed} · ${latency} · cache ${cache}`,
    modelCallsLabel: 'Model calls',
    cacheLabel: 'Cache hit',
    compressionsLabel: 'Compressions',
    tpsLabel: 'Throughput',
    catSystemPrompt: 'System prompt',
    catToolDefinitions: 'Tool definitions',
    catSubagentDefinitions: 'Subagent definitions',
    catMemory: 'Memory',
    catConversation: 'Conversation',
    catSkills: 'Skills index',
    catRules: 'Rules',
    catMcp: 'MCP tools',
    estimateNote: 'Category figures are estimates.',
    deltaHigher: v => `Estimate runs ${v} above the measured usage`,
    deltaLower: v => `Estimate runs ${v} below the measured usage`,
    noSession: 'No active session',
    openChat: 'Open a chat to see its context.'
  },
  zh: {
    tab: '上下文',
    title: '上下文洞察',
    capacity: total => `容量 ${total}`,
    windowTitle: '当前窗口',
    tokensUsed: '已用 token',
    ofWindow: '占窗口',
    free: '剩余',
    barWindowAria: '窗口占用比例的估算',
    barWindow: '上方彩条 = 窗口占用比例；灰色为未分类与空闲部分。',
    barNoWindow: '窗口容量未知，因此不绘制占用彩条；下方仅为构成明细。',
    stateEstimated: '估算',
    reading: '正在读取上下文…',
    contextUnavailable: '上下文不可用。',
    breakdownUnavailable: '上下文分类暂不可用。',
    notBuilt: '上下文尚未构建 —— 先发一条消息试试。',
    classified: '分类合计约',
    coverage: pct => `约占窗口 ${pct}%`,
    occupancyUnavailable: '占用未知',
    greyNote: '灰色部分为未能归类的内容。',
    refresh: '刷新',
    refreshing: '刷新中…',
    awaitingUsage: '等待实时用量',
    persistedHint: (input, output) => `来自已保存记录：输入 ${input} + 输出 ${output}；重启后拿不到精确总量`,
    freeHint: (free, max) => `共 ${max}，剩余 ${free}`,
    updatedJustNow: '刚刚更新',
    updatedAgo: seconds => `${seconds} 秒前更新`,
    notReadYet: '尚未读取',
    session: id => `会话 ${id}`,
    cumulativeTitle: '会话累计',
    historyLine: (total, input, output) => `本会话累计 ≈ ${total}（输入 ${input} + 输出 ${output}，含本次运行之前的用量）无缓存拆分`,
    runScopeNote: '自本次运行起累计。Hermes 在重启或压缩上下文后会重建 agent，这些计数也随之从零开始。',
    totalTokens: '累计 token',
    uncachedInput: '未缓存输入',
    cacheReadLabel: '缓存读取',
    outputLabel: '输出',
    elapsedTitle: '耗时',
    totalElapsed: '总历时',
    latencyLabel: '平均延迟',
    timingSummary: (elapsed, latency, cache) => `${elapsed} · ${latency} · 缓存 ${cache}`,
    modelCallsLabel: '模型调用',
    cacheLabel: '缓存命中',
    compressionsLabel: '压缩次数',
    tpsLabel: '吞吐',
    catSystemPrompt: '系统提示词',
    catToolDefinitions: '工具定义',
    catSubagentDefinitions: '子代理定义',
    catMemory: '记忆',
    catConversation: '对话',
    catSkills: '技能索引',
    catRules: '规则',
    catMcp: 'MCP 工具',
    estimateNote: '分类数值为估算。',
    deltaHigher: v => `估算比实测高 ${v}`,
    deltaLower: v => `估算比实测低 ${v}`,
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
  const approximate = model?.cumulativeApprox === true
  const mark = approximate ? '\u2248 ' : ''
  const parts = model?.cumulativeParts
  if (parts) {
    // One source for every figure on the card: the arcs are uncached input plus
    // cache replay (and cache write, when the provider reports it) against
    // output, and the centre is their sum.
    const input = parts.uncached + parts.cacheRead + parts.cacheWrite
    const total = input + parts.output
    const hitBase = parts.uncached + parts.cacheRead + parts.cacheWrite
    return {
      kind: approximate ? 'approx' : 'live',
      input,
      output: parts.output,
      uncached: parts.uncached,
      cacheRead: parts.cacheRead,
      cacheWrite: parts.cacheWrite,
      cacheHitPct: hitBase > 0 ? Math.round((parts.cacheRead / hitBase) * 1000) / 10 : null,
      value: `${mark}${formatTokens(total)}`,
      total
    }
  }
  // Fallback before the first turn has counters: usage.input / usage.output only.
  const total = finiteNumber(model?.cumulativeTotal)
  if (total === null) return { kind: 'empty', value: '\u2014', input: null, output: null, uncached: null, cacheRead: null, cacheWrite: null, cacheHitPct: null, total: null }
  const input = finiteNumber(model?.cumulativeInput)
  const output = finiteNumber(model?.cumulativeOutput)
  if (input === null || output === null) {
    return { kind: approximate ? 'approx' : 'live', input, output, uncached: null, cacheRead: null, cacheWrite: null, cacheHitPct: null, value: `${mark}${formatTokens(total)}`, total }
  }
  return {
    kind: approximate ? 'approx' : 'live',
    input,
    output,
    uncached: input,
    cacheRead: null,
    cacheWrite: null,
    cacheHitPct: null,
    value: `${mark}${formatTokens(input + output)}`,
    total: input + output
  }
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
function compositionBars(model, t) {
  if (!model || model.categories.length === 0) return null
  const windowScale = model.contextMax !== null && model.contextMax > 0 ? model.contextMax : null
  if (windowScale === null) {
    // Without a window size a filled bar would claim an occupancy nobody
    // measured, so the bar is withheld and the panel says why.
    return { windowScale: null, windowBar: null }
  }
  const label = key => (typeof t === 'function' ? t(key) : key)
  return {
    windowScale,
    windowBar: jsx('div', {
      className: 'flex h-2.5 w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)',
      role: 'img',
      'aria-label': label('barWindowAria'),
      children: model.categories.map((item, index) => jsx('div', {
        className: 'h-full',
        style: {
          width: `${item.tokens === null ? 0 : Math.min(100, (item.tokens / windowScale) * 100)}%`,
          backgroundColor: categoryColor(item.id, index),
          boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.10)'
        },
        title: `${categoryLabel(item, label)} ${formatTokens(item.tokens)} / ${formatTokens(windowScale)}`
      }, item.id))
    })
  }
}

/**
 * One composition legend row. Returns the props object (not a JSX call) so the
 * label/value pair cannot be dropped by passing children as a third argument —
 * `jsxs(type, props, children)` silently treats that third argument as a key.
 */
function legendRow(item, index, t) {
  return {
    className: 'flex min-w-0 items-baseline gap-1.5 text-[0.75rem]',
    children: kids([
      jsx('span', {
        'aria-hidden': true,
        className: 'mt-1 size-2 shrink-0 rounded-sm',
        style: { backgroundColor: categoryColor(item.id, index) }
      }),
      jsx('span', {
        className: 'min-w-0 break-words text-(--ui-text-secondary)',
        children: categoryLabel(item, typeof t === 'function' ? t : null)
      }),
      jsx('span', {
        className: 'ml-auto shrink-0 text-right tabular-nums text-(--ui-text-tertiary)',
        title: item.tokens === null ? undefined : `${formatCount(item.tokens)} tokens`,
        children: item.share === null
          ? (item.tokens === null ? '—' : `≈${formatTokens(item.tokens)}`)
          : `≈${formatTokens(item.tokens)} · ${item.share}%`
      })
    ])
  }
}

/** Proportional arcs for the cumulative input/output split. */
function Donut({ segments, centerValue, centerLabel }) {
  const radius = 26
  const thickness = 9
  const circumference = 2 * Math.PI * radius
  const total = segments.reduce((sum, segment) => sum + (segment.value > 0 ? segment.value : 0), 0)
  let offset = 0
  const arcs = []
  if (total > 0) {
    for (const segment of segments) {
      if (!(segment.value > 0)) continue
      const length = circumference * (segment.value / total)
      arcs.push(jsx('circle', {
        key: segment.id,
        cx: 32, cy: 32, r: radius, fill: 'none',
        stroke: segment.color, strokeWidth: thickness,
        strokeDasharray: `${Math.max(0, length - 1.5)} ${circumference}`,
        strokeDashoffset: `${-offset}`,
        transform: 'rotate(-90 32 32)'
      }))
      offset += length
    }
  }
  return jsxs('svg', {
    width: 72, height: 72, viewBox: '0 0 64 64', role: 'img',
    'aria-label': `${centerLabel}: ${centerValue}`,
    className: 'shrink-0',
    children: kids([
      jsx('circle', { key: 'track', cx: 32, cy: 32, r: radius, fill: 'none', stroke: 'var(--ui-stroke-secondary)', strokeWidth: thickness }),
      ...arcs,
      jsx('text', { key: 'v', x: 32, y: 29, textAnchor: 'middle', dominantBaseline: 'central', fontSize: 11, fontWeight: 600, fill: 'var(--ui-text-primary)', children: centerValue }),
      jsx('text', { key: 'l', x: 32, y: 41, textAnchor: 'middle', dominantBaseline: 'central', fontSize: 7.5, fill: 'var(--ui-text-tertiary)', children: centerLabel })
    ])
  })
}

/** Swatch + label + formatted token value, used beside the donut. */
/** Label on the left, a plain figure on the right (raw token counts). */
function statRow(label, value, key) {
  return jsxs('div', {
    key,
    className: 'flex items-baseline gap-1.5',
    children: kids([
      jsx('span', { key: 'lb', className: 'min-w-0 break-words text-(--ui-text-secondary)', children: label }),
      jsx('span', { key: 'vl', className: 'ml-auto shrink-0 tabular-nums text-(--ui-text-tertiary)', children: value })
    ])
  })
}


/** A labelled statistic cell. */
function tile(label, value, key, hint) {
  return jsxs('div', {
    key,
    className: 'flex min-w-0 flex-col gap-0.5 rounded-md bg-(--ui-bg-tertiary) px-2 py-1.5',
    children: kids([
      jsx('span', { key: 'lb', className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: label }),
      jsx('span', { key: 'vl', className: 'truncate text-[0.75rem] font-medium tabular-nums text-(--ui-text-secondary)', title: hint || value, children: value })
    ])
  })
}


/** Input/output arcs for the cumulative donut. */
function inputOutputSegments(cumulative) {
  if (!cumulative || cumulative.input === null || cumulative.output === null) return []
  // Two arcs only: input already carries cache replay, so the pair adds up to
  // the centre figure without needing a third slice.
  return [
    { id: 'in', color: 'var(--ui-accent)', value: cumulative.input },
    { id: 'out', color: '#d6457f', value: cumulative.output }
  ]
}

/** Give array children stable positional keys, so no call site can omit one. */
function kids(nodes) {
  return nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node
    if (node.key !== undefined && node.key !== null) return node
    return { ...node, key: `k${index}` }
  })
}

/** Known breakdown ids to locale keys. Unknown ids fall back to the raw id. */
const CATEGORY_KEYS = {
  system_prompt: 'catSystemPrompt',
  tool_definitions: 'catToolDefinitions',
  subagent_definitions: 'catSubagentDefinitions',
  memory: 'catMemory',
  conversation: 'catConversation',
  skills: 'catSkills',
  rules: 'catRules',
  mcp: 'catMcp'
}

/** A category's display name: Hermes' own label when present, else the
 *  localised name for a known id, else the id itself. */
function categoryLabel(item, t) {
  if (typeof item?.label === 'string' && item.label && item.label !== item.id) return item.label
  const key = CATEGORY_KEYS[item?.id]
  if (key) {
    const localised = t(key)
    if (localised && localised !== key) return localised
  }
  return item?.id ?? ''
}

/**
 * The persisted session total, when it covers more than this run does. Shown
 * beside the live split so a rebuilt agent cannot look like the session shrank;
 * never used to claim a cache figure, which the row does not carry.
 */
function historicalTotal(shown, liveTotal) {
  if (!shown) return null
  const input = finiteNumber(shown.persistedInput)
  const output = finiteNumber(shown.persistedOutput)
  if (input === null || output === null) return null
  const total = input + output
  if (liveTotal !== null && liveTotal !== undefined && total <= liveTotal * 1.02) return null
  return { total, input, output }
}

function Section({ title, subtitle, children, className, collapsible, open, onToggle, summary }) {
  const headerCells = kids([
    jsx('h3', { key: 't', className: 'text-[0.8125rem] font-medium text-(--ui-text-primary)', children: title }),
    subtitle ? jsx('span', { key: 's', className: 'ml-auto shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)', children: subtitle }) : null
  ])
  const header = collapsible
    ? jsx('button', {
        type: 'button',
        'aria-expanded': Boolean(open),
        className: `flex w-full items-baseline gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-accent) ${open ? 'mb-2' : ''}`,
        onClick: onToggle,
        children: kids([
          jsx('span', { key: 'c', 'aria-hidden': true, className: 'w-3 shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)', children: open ? '▾' : '▸' }),
          ...headerCells
        ])
      })
    : jsx('div', { className: 'mb-2 flex items-baseline gap-2', children: headerCells })
  return jsxs('section', {
    className: `rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-surface-background) p-3 ${className ?? ''}`,
    children: kids([
      header,
      !open && collapsible && summary
        ? jsx('div', { className: 'mt-1 text-[0.6875rem] text-(--ui-text-tertiary)', children: summary })
        : null,
      collapsible && !open ? null : (Array.isArray(children) ? kids(children) : children)
    ])
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
    children: kids([
      jsx('circle', { key: 'track', cx: 32, cy: 32, r: radius, fill: 'none', stroke: 'var(--ui-stroke-secondary)', strokeWidth: 6 }),
      safe === null ? null : jsx('circle', { key: 'value',
        cx: 32, cy: 32, r: radius, fill: 'none',
        stroke: 'var(--ui-accent)', strokeWidth: 6, strokeLinecap: 'round',
        strokeDasharray: `${circumference}`, strokeDashoffset: `${offset}`,
        transform: 'rotate(-90 32 32)'
      }),
      jsx('text', {
        key: 'label',
        x: 32, y: 32, textAnchor: 'middle', dominantBaseline: 'central',
        fontSize: safe === null ? 11 : 13, fontWeight: 600,
        fill: 'var(--ui-text-primary)',
        children: safe === null ? '—' : `${safe}%`
      })
    ])
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
    freeTokens: null,
    estimateDelta: null,
    cumulativeParts: null,
    persistedInput: null,
    persistedOutput: null
  }
  if (!sessionId) return result

  const params = { session_id: sessionId, profile }
  const [breakdownResult, activeResult, statsResult] = await Promise.all([
    request('session.context_breakdown', params).then(value => ({ ok: true, value }), () => ({ ok: false })),
    request('session.active_list', { profile }).then(value => ({ ok: true, value }), () => ({ ok: false })),
    // session.stats is the only read that exposes the cache counters as absolute
    // numbers; focusedUsage reduces them to a percentage.
    request('session.stats', params).then(value => ({ ok: true, value }), () => ({ ok: false }))
  ])

  // Cumulative split. Every part comes from one source so the legend cannot
  // disagree with the arcs: uncached input, cache replay, optional cache write,
  // and output, with the centre being their sum.
  if (statsResult.ok && statsResult.value && typeof statsResult.value === 'object') {
    const uncached = finiteNumber(statsResult.value.input_tokens)
    const cacheRead = finiteNumber(statsResult.value.cache_read_tokens)
    const cacheWrite = finiteNumber(statsResult.value.cache_write_tokens)
    const out = finiteNumber(statsResult.value.output_tokens)
    if (uncached !== null && out !== null) {
      result.cumulativeParts = {
        uncached,
        cacheRead: cacheRead ?? 0,
        cacheWrite: cacheWrite ?? 0,
        output: out
      }
    }
  }

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

  // How far the category ESTIMATE drifts from the measured occupancy. The two
  // are different measurements, so the honest presentation is the gap itself.
  if (result.contextUsed !== null && result.categoryTotal > 0) {
    result.estimateDelta = result.categoryTotal - result.contextUsed
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

  // The persisted session row accumulates across agent rebuilds (a restart, or
  // the compression that evicts the agent) while `usage.total` restarts at zero.
  // It is read on every refresh and reported beside the live split. SessionInfo
  // carries input and output only, so it can never supply the cache split.
  if (storedSessionId && profile && typeof listPersistedSessions === 'function') {
    try {
      const page = await listPersistedSessions(null, { profile, limit: 500 })
      const rows = Array.isArray(page?.sessions) ? page.sessions : []
      const wanted = String(storedSessionId)
      const bare = wanted.replace(/^local-/, '')
      const row = rows.find(item => item?.id === wanted || item?.id === bare)
      const input = finiteNumber(row?.input_tokens)
      const output = finiteNumber(row?.output_tokens)
      if (input !== null && output !== null && (input > 0 || output > 0)) {
        result.persistedInput = input
        result.persistedOutput = output
        // Cold start: no live counters at all, so the row is also the best
        // available cumulative figure. A zeroed usage object counts as none.
        if (result.cumulativeTotal === null || result.cumulativeTotal === 0) {
          result.cumulativeInput = input
          result.cumulativeOutput = output
          result.cumulativeTotal = input + output
          result.cumulativeApprox = true
          result.cumulativeSource = 'persisted'
        }
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
  // The window length is a property of the model, not of one measurement, so
  // the usage snapshot is a legitimate fallback when the breakdown returns 0
  // (the agent has not built its compressor yet). The USED figure is never
  // taken from usage here: the two used values are different measurements.
  const usageMax = finiteNumber(usage?.context_max)
  const contextMax = rawMax !== null && rawMax > 0
    ? rawMax
    : (usageMax !== null && usageMax > 0 ? usageMax : null)
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

function ContextPanel() {
  const t = usePluginI18n(ID)
  const usage = useValue(host.state.focusedUsage)
  const sessionId = useValue(host.state.focusedSessionId)
  const storedSessionId = useValue(host.state.focusedStoredSessionId)
  const profile = useValue(host.state.focusedSessionProfile)
  const snapshot = useValue($snapshot)
  const tick = useValue($tick)
  const [refreshKey, setRefreshKey] = useState(0)
  const [openTiming, setOpenTiming] = useState(false)
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
    cumulativeApprox,
    cumulativeParts: shown !== null ? shown.cumulativeParts : null
  })
  // One cache figure for the whole panel: the live split when the stats read gave
  // us one, otherwise the usage mirror. Mixing the two showed 0% in one card and a
  // stale 68% in the other.
  const history = historicalTotal(shown, cumulative.total)
  const cacheRate = cumulative.cacheHitPct !== null && cumulative.cacheHitPct !== undefined
    ? cumulative.cacheHitPct
    : (shown !== null && shown.cacheHitPct !== null ? Math.round(shown.cacheHitPct * 10) / 10 : null)
  const bars = compositionBars(shown, t)
  const updatedSeconds = snapshot.at > 0 ? Math.max(0, Math.round((now - snapshot.at) / 1000)) : null
  const cumulativeHint = cumulative.kind === 'empty'
    ? t('awaitingUsage')
    : cumulative.kind === 'approx'
      ? t('persistedHint', formatTokens(cumulative.uncached), formatTokens(cumulative.output))
      : ''

  if (!sessionId) {
    return jsxs('div', { className: 'flex h-full flex-col items-center justify-center gap-2 bg-(--ui-surface-background) px-4 text-center', children: kids([
      jsx('div', { className: 'text-[0.8125rem] text-(--ui-text-secondary)', children: t('noSession') }),
      jsx('div', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children: t('openChat') })
    ]) })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2 overflow-auto bg-(--ui-surface-background) p-3 text-(--ui-text-primary)',
    children: kids([
      jsxs('div', {
        key: 'head',
        className: 'flex items-center gap-2',
        children: [
          jsx('span', { key: 'title', className: 'text-sm font-semibold', children: t('title') }),
          jsx('button', {
            key: 'refresh',
            type: 'button',
            disabled: snapshot.loading,
            className: 'ml-auto min-h-7 shrink-0 rounded-md border border-(--ui-stroke-secondary) px-2 py-0.5 text-[0.6875rem] text-(--ui-text-secondary) enabled:hover:bg-(--ui-bg-tertiary) disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-accent)',
            onClick: () => setRefreshKey(value => value + 1),
            children: snapshot.loading ? t('refreshing') : t('refresh')
          })
        ]
      }),
      jsx(Section, {
        key: 'p1',
        title: t('cumulativeTitle'),
        subtitle: cumulative.kind === 'approx' ? t('stateEstimated') : null,
        children: jsxs('div', {
          className: 'flex items-center gap-3',
          children: [
            jsx(Donut, {
              key: 'donut',
              segments: inputOutputSegments(cumulative),
              centerValue: cumulative.value,
              centerLabel: t('totalTokens')
            }),
            jsxs('div', {
              key: 'legend',
              className: 'flex min-w-0 flex-1 flex-col gap-1 text-[0.75rem]',
              children: [
                cumulative.cacheHitPct !== null
                  ? statRow(t('cacheLabel'), `${cumulative.cacheHitPct}%`, 'hit')
                  : null,
                cumulative.uncached !== null
                  ? statRow(t('uncachedInput'), `${formatCount(cumulative.uncached)} tok`, 'uncached')
                  : null,
                cumulative.cacheRead !== null
                  ? statRow(t('cacheReadLabel'), `${formatCount(cumulative.cacheRead)} tok`, 'read')
                  : null,
                statRow(t('outputLabel'), `${formatCount(cumulative.output)} tok`, 'out'),
                cumulativeHint ? jsx('div', { key: 'hint', className: 'mt-0.5 text-[0.6875rem] text-(--ui-text-tertiary)', children: cumulativeHint }) : null,
                history !== null
                  ? jsx('div', {
                      key: 'history',
                      className: 'mt-1 text-[0.6875rem] text-(--ui-text-tertiary)',
                      children: t('historyLine', formatTokens(history.total), formatTokens(history.input), formatTokens(history.output))
                    })
                  : null,
                jsx('div', { key: 'scope', className: 'mt-1 text-[0.6875rem] text-(--ui-text-quaternary)', children: t('runScopeNote') })
              ]
            })
          ]
        })
      }),
      jsx(Section, {
        key: 'p2',
        title: t('windowTitle'),
        subtitle: shown !== null && shown.contextMax !== null ? t('capacity', formatTokens(shown.contextMax)) : null,
        children: jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsxs('div', {
              key: 'top',
              className: 'flex items-center justify-between gap-3',
              children: [
                jsxs('div', {
                  key: 'figures',
                  className: 'flex min-w-0 flex-col gap-0.5',
                  children: [
                    jsx('span', { key: 'lbl', className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t('tokensUsed') }),
                    jsx('span', {
                      key: 'val',
                      className: 'text-[1.5rem] leading-tight font-semibold tabular-nums',
                      children: shown === null || shown.contextUsed === null
                        ? '—'
                        : `${formatTokens(shown.contextUsed)} / ${shown.contextMax === null ? '—' : formatTokens(shown.contextMax)}`
                    }),
                    shown !== null && typeof shown.freeTokens === 'number'
                      ? jsx('span', {
                          key: 'free',
                          className: 'text-[0.75rem] text-(--ui-text-tertiary)',
                          title: shown.contextMax === null ? undefined : t('freeHint', formatCount(shown.freeTokens), formatCount(shown.contextMax)),
                          children: `${formatTokens(shown.freeTokens)} ${t('free')}`
                        })
                      : null
                  ]
                }),
                jsx(OccupancyRing, {
                  key: 'ring',
                  percent: shown === null ? null : shown.windowPercent,
                  label: `${t('ofWindow')} ${shown === null || shown.windowPercent === null ? '—' : `${shown.windowPercent}%`}`
                })
              ]
            }),
            shown !== null && shown.categories.length > 0 && bars !== null && bars.windowBar
              ? jsx('div', { key: 'wbar', children: bars.windowBar })
              : null,
            shown !== null && shown.categories.length > 0 && (bars === null || bars.windowBar === null)
              ? jsx('div', { key: 'track', className: 'h-2.5 w-full rounded-full bg-(--ui-stroke-secondary)' })
              : null,
            shown !== null && shown.categories.length > 0
              ? jsx('div', {
                  key: 'barnote',
                  className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                  children: bars === null || bars.windowBar === null ? t('barNoWindow') : t('barWindow')
                })
              : null,
            shown !== null && shown.categories.length > 0
              ? jsx('div', {
                  key: 'classified',
                  className: 'text-[0.75rem] text-(--ui-text-secondary)',
                  children: shown.contextUsed === null || shown.contextMax === null
                    ? `${t('classified')} ${formatTokens(shown.categoryTotal)} · ${t('occupancyUnavailable')} · ${t('estimateNote')}`
                    : `${t('classified')} ${formatTokens(shown.categoryTotal)} · ${t('coverage', Math.round((shown.categoryTotal / shown.contextMax) * 1000) / 10)} · ${t('estimateNote')}`
                })
              : null,
            shown !== null && typeof shown.estimateDelta === 'number' && shown.estimateDelta !== 0
              ? jsx('div', {
                  key: 'delta',
                  className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                  children: shown.estimateDelta > 0
                    ? t('deltaHigher', formatTokens(shown.estimateDelta))
                    : t('deltaLower', formatTokens(-shown.estimateDelta))
                })
              : null,
            shown !== null && shown.categories.length > 0
              ? jsx('div', {
                  key: 'legend',
                  className: 'grid grid-cols-2 gap-x-3 gap-y-1.5',
                  children: shown.categories.map((item, index) => jsx('div', legendRow(item, index, t), item.id))
                })
              : null,
            shown !== null && shown.categories.length > 0
              ? jsx('div', { key: 'greynote', className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: t('greyNote') })
              : null,
            shown === null
              ? jsx('div', { key: 'state', className: 'text-[0.75rem] text-(--ui-text-secondary)', children: snapshot.loading ? t('reading') : t('contextUnavailable') })
              : null,
            shown !== null && shown.breakdownAvailable === false
              ? jsx('div', { key: 'state', className: 'text-[0.75rem] text-(--ui-text-secondary)', title: shown.breakdownError, children: t('breakdownUnavailable') })
              : null,
            shown !== null && shown.breakdownAvailable !== false && shown.categories.length === 0
              ? jsx('div', { key: 'state', className: 'text-[0.75rem] text-(--ui-text-secondary)', children: t('notBuilt') })
              : null
          ]
        })
      }),
      jsx(Section, {
        key: 'p4',
        title: t('elapsedTitle'),
        collapsible: true,
        open: openTiming,
        onToggle: () => setOpenTiming(value => !value),
        summary: t('timingSummary',
          shown === null || !shown.elapsedKnown ? '—' : formatElapsed(elapsedAt(shown, snapshot.at, now)),
          shown !== null && shown.avgLatencyS !== null ? `${shown.avgLatencyS}s` : '—',
          cacheRate !== null ? `${cacheRate}%` : '—'),
        children: jsx('div', {
          className: 'grid grid-cols-2 gap-1.5',
          children: kids([
            tile(t('totalElapsed'), shown === null || !shown.elapsedKnown ? '—' : formatElapsed(elapsedAt(shown, snapshot.at, now)), 'elapsed'),
            tile(t('latencyLabel'), shown === null || shown.avgLatencyS === null ? '—' : `${shown.avgLatencyS}s`, 'latency'),
            tile(t('modelCallsLabel'), shown !== null && shown.calls !== null ? formatCount(shown.calls) : '—', 'calls'),
            tile(t('cacheLabel'), cacheRate !== null ? `${cacheRate}%` : '—', 'cache'),
            tile(t('compressionsLabel'), shown !== null && shown.compressions !== null ? formatCount(shown.compressions) : '—', 'compressions'),
            tile(t('tpsLabel'), shown !== null && shown.avgTps !== null ? `${Math.round(shown.avgTps * 10) / 10} tok/s` : '—', 'tps')
          ])
        })
      }),
      jsxs('div', {
        key: 'foot',
        className: 'flex items-center gap-2 pt-1',
        children: [
          jsx('span', {
            key: 'age',
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: updatedSeconds === null
              ? t('notReadYet')
              : updatedSeconds < 2 ? t('updatedJustNow') : t('updatedAgo', updatedSeconds)
          }),
          jsx('span', {
            key: 'sid',
            className: 'ml-auto text-[0.6875rem] text-(--ui-text-quaternary)',
            children: t('session', String(sessionId).slice(-8))
          })
        ]
      })
    ])
  })
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
      data: { placement: 'right', width: '460px', tabTitle: () => jsx(TabTitle, {}) },
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
