[English](README.md) | [简体中文](README.zh-CN.md)

# hermes-context-insight

A read-only Hermes Desktop plugin that shows the current chat's context usage.

The panel follows the Hermes interface language: English and Simplified Chinese
bundles ship in `plugin.js` and resolve against `display.language`.

## What it shows

Four cards, in the order the numbers matter:

1. **Session total** — a two-arc donut: **input** (uncached input + cache replay
   + cache write) against **output**, with the centre showing the total the two
   arcs add up to. Beside it, four figures from `session.stats`: cache hit rate,
   uncached input, cache read and output. Every number on this card comes from
   that one RPC, so the arcs and the legend cannot disagree. Cache write is folded
   into the input arc rather than given its own slice.
   A second line shows the persisted session row (`input_tokens + output_tokens`)
   when it covers more than this run does, so a rebuilt agent cannot look like the
   session shrank. That row has no cache fields, so it can never supply the split.
2. **Current window** — measured occupancy over a model-property window: the
   percentage ring, the used/capacity figure, the free remainder, an occupancy bar
   and the per-category composition.
3. **Timing** — natural elapsed time, average latency, model calls, cache hit rate,
   compressions and throughput. Collapsed to one summary line by default.

The item-count card was removed: only *conversation* has a countable row set, and
the other categories expose tokens without counts, so the card was mostly "count
not exposed". Removing it also removed the `session.history` read, which was the
expensive call in every refresh.

### Estimates versus measurements

`context_breakdown` reports each category as an estimate derived from text length,
while `context_used` is the provider's measured figure. The estimate can come out
higher or lower, so the panel states both and prints the gap (for example
"estimate runs 8.7K above the measured usage"). Neither number is adjusted to
match the other.

## Data and privacy

The plugin reads Hermes Desktop's public SDK state and three read-only gateway calls, plus one optional cold-start fallback:

| Source | Use |
|---|---|
| `host.state.focusedUsage` | live cumulative token counters |
| `session.context_breakdown` | current occupancy and estimated categories |
| `session.active_list` | the session's natural start time |
| `session.stats` | cumulative input/output/cache counters |
| `host.listPersistedSessions` | cold-start fallback for persisted `input_tokens` + `output_tokens` |

It does **not** write files, make external network requests, or access a database directly. The cold-start fallback goes through the public SDK, which reads the persisted session row on the host; it is labelled approximate because it is not the same aggregate as live `usage.total` (cache, reasoning and compression lineage can differ). State stays in memory.

## Known limits

- Category figures are Hermes estimates; they are not exact tokenizer counts.
- `session.stats` is the only read that exposes the cache counters as absolute
  numbers (`cache_read_tokens`, `cache_write_tokens`); `focusedUsage` reduces them
  to a percentage. Without stats (before the first turn builds an agent) the card
  falls back to `usage.input` / `usage.output` and shows no cache row.
- `context_breakdown.context_used` and `focusedUsage.context_used` are different measurements. This plugin deliberately uses the former for the window figure and never combines the two.
- A session absent from `active_list`, or without `started_at`, shows elapsed time as unavailable rather than inventing a start.
- Before the agent has built its context, the breakdown may return no categories; the panel says so instead of drawing zeros.
- Without a window size the occupancy bar is withheld entirely: any fill would
  claim an occupancy nobody measured. The window is taken from the breakdown, and
  from `focusedUsage.context_max` when the breakdown has not been computed yet.

## Troubleshooting

**The plugin shows as loaded but no `Context` tab appears.** That is a stale pane
dismissal persisted by Hermes, not a load failure: collapse and re-open the right
sidebar (`Ctrl+J`), or reset the layout. This plugin clears such a record once on
load so the pane is re-adopted next to the other right-hand panes.

## Tests

The plugin has no build step. The mock test loads `plugin.js` in a Node VM with a fake Hermes SDK:

```sh
node test/plugin.test.cjs
```

## Install (local, before catalog publication)

Copy `plugin.js` to:

```
<HERMES_HOME>/desktop-plugins/hermes-context-insight/plugin.js
```

The directory name must match the plugin id. Then enable **Context Insight** under Capabilities → Plugins. There is no build step.

## License

MIT. See [LICENSE](LICENSE).
