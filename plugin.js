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
import { useEffect, useRef, useState } from 'react'
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
    ioHint: (input, output) => `in ${input} · out ${output}`,
    freeHint: (free, max) => `${free} tokens free of ${max}`,
    updatedJustNow: 'Updated just now',
    updatedAgo: seconds => `Updated ${seconds}s ago`,
    notReadYet: 'Not read yet',
    session: id => `Session ${id}`,
    cumulativeTitle: 'Session total',
    totalTokens: 'Total tokens',
    inputLabel: 'Input',
    outputLabel: 'Output',
    itemsTitle: 'Items by category',
    items: n => `${n} items`,
    countUnavailable: 'count not exposed',
    historyCounts: (u, a, tool) => `${u} user · ${a} assistant · ${tool} tool rows`,
    historyUnavailable: 'History unavailable; item counts need session.history.',
    elapsedTitle: 'Timing',
    totalElapsed: 'Elapsed',
    recordGaps: 'Record gaps',
    gapMean: 'avg',
    gapHint: 'Interval between two consecutive history records. It spans tool execution plus whatever came after it, so it is not the tool\'s own runtime.',
    timingSummary: (elapsed, gaps, cache) => `${elapsed} · gaps ${gaps} · cache ${cache}`,
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
    expand: 'Show detail',
    collapse: 'Hide detail',
    noMessages: 'No messages recorded yet.',
    listTruncated: (shown, total) => `Showing the first ${shown} of ${total} records.`,
    promptUnavailable: 'Not captured for this session yet — it arrives with a session update.',
    promptCaptured: 'Captured from the last session update.',
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
    ioHint: (input, output) => `输入 ${input} · 输出 ${output}`,
    freeHint: (free, max) => `共 ${max}，剩余 ${free}`,
    updatedJustNow: '刚刚更新',
    updatedAgo: seconds => `${seconds} 秒前更新`,
    notReadYet: '尚未读取',
    session: id => `会话 ${id}`,
    cumulativeTitle: '会话累计',
    totalTokens: '累计 token',
    inputLabel: '输入',
    outputLabel: '输出',
    itemsTitle: '逐项条数',
    items: n => `${n} 项`,
    countUnavailable: '条数未暴露',
    historyCounts: (u, a, tool) => `用户 ${u} · 助手 ${a} · 工具 ${tool} 条`,
    historyUnavailable: '历史不可用，条数需要 session.history。',
    elapsedTitle: '耗时',
    totalElapsed: '总历时',
    recordGaps: '记录间隔',
    gapMean: '平均',
    gapHint: '相邻两条历史记录之间的间隔，包含工具执行以及其后的所有等待，因此不等于工具本身的运行时长。',
    timingSummary: (elapsed, gaps, cache) => `${elapsed} · 间隔 ${gaps} · 缓存 ${cache}`,
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
    expand: '展开明细',
    collapse: '收起明细',
    noMessages: '还没有记录到消息。',
    listTruncated: (shown, total) => `仅显示前 ${shown} 条，共 ${total} 条。`,
    promptUnavailable: '本次会话暂未获取；它只在会话信息更新时带出来。',
    promptCaptured: '来自最近一次会话信息更新。',
    noSession: '没有活跃会话',
    openChat: '打开一个对话后即可查看上下文。'
  }
}

const $snapshot = atom({ sessionId: null, profile: null, data: null, loading: false, error: '', at: 0 })
const $tick = atom(0)

/**
 * Opportunistic capture, keyed by runtime session id. `session.info` is the only
 * place the full system prompt ever crosses into the renderer, and it is an
 * EVENT — the plugin cannot ask for it. So it is cached when it happens to
 * arrive and honestly reported as absent otherwise.
 */
const $systemPrompts = atom({})

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

/** Bounded, display-only view of the conversation. Text is truncated, never
 *  rewritten; the panel shows what the session actually recorded. */
function summariseMessages(rows, limit = 120, clip = 160) {
  const out = []
  for (const row of rows) {
    if (out.length >= limit) break
    const role = row && typeof row.role === 'string' ? row.role : 'unknown'
    const at = finiteNumber(row?.timestamp)
    let text = ''
    if (typeof row?.text === 'string') text = row.text
    else if (typeof row?.content === 'string') text = row.content
    else if (role === 'tool') {
      const name = typeof row?.name === 'string' ? row.name : 'tool'
      text = name
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (text.length > clip) text = `${text.slice(0, clip)}…`
    out.push({ role, at, text })
  }
  return out
}

/** Counts history rows by role; the only per-item numbers the plugin can see. */
function countHistory(rows) {
  const counts = { user: 0, assistant: 0, tool: 0, messages: 0, total: rows.length }
  for (const row of rows) {
    const role = row && typeof row.role === 'string' ? row.role : ''
    if (role === 'user') counts.user += 1
    else if (role === 'assistant') counts.assistant += 1
    else if (role === 'tool') counts.tool += 1
    if (role === 'user' || role === 'assistant') counts.messages += 1
  }
  return counts
}

/** Intervals between consecutive history timestamps. History tool rows carry no
 *  duration, so a gap spans more than the tool: it is a record interval. */
function timelineGaps(rows) {
  const gaps = []
  let previous = null
  for (const row of rows) {
    const at = finiteNumber(row?.timestamp)
    if (at === null) continue
    if (previous !== null && at >= previous) gaps.push(at - previous)
    previous = at
  }
  return gaps
}

/** Mean and max of recorded gaps, in seconds. */
function gapStats(gaps) {
  if (!Array.isArray(gaps) || gaps.length === 0) return { count: 0, mean: null, max: null }
  let total = 0
  let max = 0
  for (const seconds of gaps) {
    total += seconds
    if (seconds > max) max = seconds
  }
  return { count: gaps.length, mean: total / gaps.length, max }
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
function legendLine(color, label, value, key) {
  return jsxs('div', {
    key,
    className: 'flex items-baseline gap-1.5',
    children: kids([
      jsx('span', { key: 'sw', 'aria-hidden': true, className: 'mt-1 size-2 shrink-0 rounded-sm', style: { backgroundColor: color } }),
      jsx('span', { key: 'lb', className: 'min-w-0 break-words text-(--ui-text-secondary)', children: label }),
      jsx('span', { key: 'vl', className: 'ml-auto shrink-0 tabular-nums text-(--ui-text-tertiary)', children: formatTokens(value) })
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

/** Seconds as a compact duration. */
function formatDuration(seconds) {
  const value = finiteNumber(seconds)
  if (value === null) return '—'
  if (value < 1) return '<1s'
  if (value < 60) return `${Math.round(value)}s`
  const minutes = Math.floor(value / 60)
  const rest = Math.round(value % 60)
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Input/output arcs for the cumulative donut. */
function inputOutputSegments(cumulative) {
  if (!cumulative || cumulative.input === null || cumulative.output === null) return []
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
 * Detail body for one category row, or null when this category has no detail
 * the plugin can honestly show. Conversation comes from session.history; the
 * system prompt is whatever the last `session.info` event carried.
 */
function categoryDetail(item, model, systemPrompt, t) {
  if (!item || !model) return null
  if (item.id === 'conversation') {
    const messages = Array.isArray(model.messages) ? model.messages : []
    if (messages.length === 0) return { nodes: [jsx('div', { key: 'n', children: t('noMessages') })] }
    const total = model.counts ? model.counts.total : messages.length
    const truncated = total > messages.length
      ? [jsx('div', { key: 'more', className: 'text-(--ui-text-quaternary)', children: t('listTruncated', formatCount(messages.length), formatCount(total)) })]
      : []
    return {
      nodes: messages.map((message, index) => jsxs('div', {
        key: `m${index}`,
        className: 'flex gap-1.5',
        children: [
          jsx('span', { key: 'r', className: 'w-14 shrink-0 text-(--ui-text-quaternary)', children: message.role }),
          jsx('span', { key: 'x', className: 'min-w-0 break-words', children: message.text || '—' })
        ]
      })).concat(truncated)
    }
  }
  if (item.id === 'system_prompt') {
    if (!systemPrompt) return { nodes: [jsx('div', { key: 'n', children: t('promptUnavailable') })] }
    return {
      nodes: [
        jsx('div', { key: 'note', className: 'text-(--ui-text-quaternary)', children: t('promptCaptured') }),
        jsx('pre', {
          key: 'text',
          className: 'm-0 whitespace-pre-wrap break-words font-mono text-[0.6875rem]',
          children: systemPrompt
        })
      ]
    }
  }
  return null
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
async function loadSessionModel({ request, sessionId, storedSessionId, profile, usage, now, listPersistedSessions, includeHistory = true, previous = null }) {
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
    counts: null,
    gaps: [],
    estimateDelta: null,
    messages: []
  }
  if (!sessionId) return result

  const params = { session_id: sessionId, profile }
  const [breakdownResult, activeResult, historyResult] = await Promise.all([
    request('session.context_breakdown', params).then(value => ({ ok: true, value }), () => ({ ok: false })),
    request('session.active_list', { profile }).then(value => ({ ok: true, value }), () => ({ ok: false })),
    includeHistory
      ? request('session.history', params).then(value => ({ ok: true, value }), () => ({ ok: false }))
      : Promise.resolve({ ok: false, skipped: true })
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

  // Item counts: only conversation is countable from here. The other categories
  // live inside the agent and report tokens without counts, so they stay null.
  if (!includeHistory && previous) {
    // A tick-only refresh: history is the expensive call, so the previously
    // read counts stand until the user refreshes or switches session.
    result.counts = previous.counts ?? null
    result.gaps = Array.isArray(previous.gaps) ? previous.gaps : []
    result.messages = Array.isArray(previous.messages) ? previous.messages : []
    result.categories = result.categories.map(item => ({
      ...item,
      count: item.id === 'conversation' && result.counts ? result.counts.messages : null
    }))
  }
  const historyRows = historyResult.ok && Array.isArray(historyResult.value?.messages)
    ? historyResult.value.messages
    : null
  if (historyRows !== null) {
    const counts = countHistory(historyRows)
    result.counts = counts
    result.gaps = timelineGaps(historyRows)
    result.categories = result.categories.map(item => ({
      ...item,
      count: item.id === 'conversation' ? counts.messages : null
    }))
    result.messages = summariseMessages(historyRows)
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
  const [openCategory, setOpenCategory] = useState(null)
  const [openTiming, setOpenTiming] = useState(false)
  // History is refetched only when the session changes or the user refreshes;
  // a message completing keeps the counts already read.
  const historyEpoch = useRef('')
  const systemPrompts = useValue($systemPrompts)
  const systemPrompt = sessionId ? (systemPrompts[sessionId] ?? null) : null
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
    const epoch = `${sessionId}|${profile}|${refreshKey}`
    const includeHistory = historyEpoch.current !== epoch
    if (includeHistory) historyEpoch.current = epoch
    $snapshot.set({ ...previous, sessionId, profile, data: sameSession ? previous.data : null, loading: true, error: '' })
    loadSessionModel({
      request: host.request,
      sessionId,
      storedSessionId,
      profile,
      usage,
      now: Date.now(),
      includeHistory,
      previous: sameSession ? previous.data : null,
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
  const bars = compositionBars(shown, t)
  const facts = presentFacts(shown !== null ? shown : usageModel)
  const updatedSeconds = snapshot.at > 0 ? Math.max(0, Math.round((now - snapshot.at) / 1000)) : null
  const cumulativeHint = cumulative.kind === 'empty'
    ? t('awaitingUsage')
    : cumulative.kind === 'approx'
      ? t('persistedHint', formatTokens(cumulative.input), formatTokens(cumulative.output))
      : cumulative.input === null ? '' : t('ioHint', formatTokens(cumulative.input), formatTokens(cumulative.output))

  if (!sessionId) {
    return jsxs('div', { className: 'flex h-full flex-col items-center justify-center gap-2 bg-(--ui-surface-background) px-4 text-center', children: kids([
      jsx('div', { className: 'text-[0.8125rem] text-(--ui-text-secondary)', children: t('noSession') }),
      jsx('div', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children: t('openChat') })
    ]) })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2 overflow-auto bg-(--ui-surface-background) p-3 text-(--ui-text-primary)',
    children: kids([
      jsx('div', { key: 'head', className: 'text-sm font-semibold', children: t('title') }),
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
                legendLine('var(--ui-accent)', t('inputLabel'), cumulative.input, 'in'),
                legendLine('#d6457f', t('outputLabel'), cumulative.output, 'out'),
                cumulativeHint ? jsx('div', { key: 'hint', className: 'mt-0.5 text-[0.6875rem] text-(--ui-text-tertiary)', children: cumulativeHint }) : null
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
      shown !== null && shown.categories.length > 0
        ? jsx(Section, {
            key: 'p3',
            title: t('itemsTitle'),
            children: [
              jsx('div', {
                key: 'rows',
                className: 'flex flex-col gap-1',
                children: shown.categories.map((item, index) => {
                  const open = openCategory === item.id
                  const detail = categoryDetail(item, shown, systemPrompt, t)
                  const cells = [
                    jsx('span', {
                      key: 'caret',
                      'aria-hidden': true,
                      className: 'w-3 shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)',
                      children: detail ? (open ? '▾' : '▸') : ''
                    }),
                    jsx('span', { key: 'dot', 'aria-hidden': true, className: 'mt-1 size-2 shrink-0 rounded-sm', style: { backgroundColor: categoryColor(item.id, index) } }),
                    jsx('span', { key: 'name', className: 'min-w-0 break-words text-(--ui-text-secondary)', children: categoryLabel(item, t) }),
                    jsx('span', {
                      key: 'count',
                      className: 'ml-auto shrink-0 tabular-nums ' + (typeof item.count === 'number' ? 'text-(--ui-text-tertiary)' : 'italic text-(--ui-text-quaternary)'),
                      children: typeof item.count === 'number' ? t('items', formatCount(item.count)) : t('countUnavailable')
                    })
                  ]
                  return jsxs('div', {
                    key: item.id,
                    className: 'flex flex-col gap-1',
                    children: [
                      detail
                        ? jsx('button', {
                            key: 'head',
                            type: 'button',
                            'aria-expanded': open,
                            'aria-label': `${open ? t('collapse') : t('expand')} ${categoryLabel(item, t)}`,
                            className: 'flex w-full items-baseline gap-2 rounded-sm text-left text-[0.75rem] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-accent)',
                            onClick: () => setOpenCategory(current => (current === item.id ? null : item.id)),
                            children: cells
                          })
                        : jsx('div', { key: 'head', className: 'flex items-baseline gap-2 text-[0.75rem]', children: cells }),
                      detail && open
                        ? jsx('div', {
                            key: 'body',
                            className: 'ml-5 flex max-h-56 flex-col gap-1 overflow-auto rounded-md bg-(--ui-bg-tertiary) p-2 text-[0.6875rem] text-(--ui-text-secondary)',
                            children: detail.nodes
                          })
                        : null
                    ]
                  })
                })
              }),
              jsx('div', {
                key: 'hist',
                className: 'mt-1 text-[0.6875rem] text-(--ui-text-tertiary)',
                children: shown.counts !== null
                  ? t('historyCounts', formatCount(shown.counts.user), formatCount(shown.counts.assistant), formatCount(shown.counts.tool))
                  : t('historyUnavailable')
              })
            ]
          })
        : null,
      jsx(Section, {
        key: 'p4',
        title: t('elapsedTitle'),
        collapsible: true,
        open: openTiming,
        onToggle: () => setOpenTiming(value => !value),
        summary: t('timingSummary',
          shown === null || !shown.elapsedKnown ? '—' : formatElapsed(elapsedAt(shown, snapshot.at, now)),
          shown === null || shown.gaps.length === 0 ? '—' : formatDuration(gapStats(shown.gaps).mean),
          shown !== null && shown.cacheHitPct !== null ? `${Math.round(shown.cacheHitPct * 10) / 10}%` : '—'),
        children: jsx('div', {
          className: 'grid grid-cols-2 gap-1.5',
          children: kids([
            tile(t('totalElapsed'), shown === null || !shown.elapsedKnown ? '—' : formatElapsed(elapsedAt(shown, snapshot.at, now)), 'elapsed'),
            tile(t('recordGaps'), shown === null || shown.gaps.length === 0 ? '—' : `${t('gapMean')} ${formatDuration(gapStats(shown.gaps).mean)}`, 'gaps', t('gapHint')),
            tile(t('modelCallsLabel'), shown !== null && shown.calls !== null ? formatCount(shown.calls) : '—', 'calls'),
            tile(t('cacheLabel'), shown !== null && shown.cacheHitPct !== null ? `${Math.round(shown.cacheHitPct * 10) / 10}%` : '—', 'cache'),
            tile(t('compressionsLabel'), shown !== null && shown.compressions !== null ? formatCount(shown.compressions) : '—', 'compressions'),
            tile(t('tpsLabel'), shown !== null && shown.avgTps !== null ? `${Math.round(shown.avgTps * 10) / 10} tok/s` : '—', 'tps')
          ])
        })
      }),
      jsxs('div', {
        key: 'foot',
        className: 'flex items-center gap-2 pt-1',
        children: [
          jsx('button', {
            key: 'btn',
            type: 'button',
            disabled: snapshot.loading,
            className: 'min-h-8 w-fit rounded-md border border-(--ui-stroke-secondary) px-2.5 py-1 text-[0.75rem] text-(--ui-text-secondary) enabled:hover:bg-(--ui-bg-tertiary) disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-accent)',
            onClick: () => setRefreshKey(value => value + 1),
            children: snapshot.loading ? t('refreshing') : t('refresh')
          }),
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
    ctx.onEvent('session.info', event => {
      const sessionId = event?.session_id
      const prompt = event?.payload?.system_prompt
      if (!sessionId || typeof prompt !== 'string' || !prompt) return
      const current = $systemPrompts.get()
      if (current[sessionId] === prompt) return
      // Keep only the focused session so a long run cannot accumulate prompts.
      $systemPrompts.set({ [sessionId]: prompt })
    })
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
