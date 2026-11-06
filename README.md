# hermes-context-insight

A read-only Hermes Desktop plugin that shows the current chat's context usage.

## What it shows

- **Cumulative tokens** — the session's billed input and output tokens, read from Hermes's live `focusedUsage` state. When Hermes has just restarted and has no live usage snapshot, the panel falls back to the persisted session row's `input_tokens + output_tokens`, prefixed with `≈`. That fallback is approximate and is never presented as `usage.total`.
- **Elapsed (natural)** — wall-clock time from the session's `started_at` to now. It is not the sum of tool or step durations.
- **Window occupancy** — the current context occupancy reported by `session.context_breakdown` over the model window.
- **Current composition** — the breakdown's estimated category tokens, with each category's share of the **estimated classified content** (not of the whole window).

## Data and privacy

The plugin reads Hermes Desktop's public SDK state and three read-only gateway calls, plus one optional cold-start fallback:

| Source | Use |
|---|---|
| `host.state.focusedUsage` | live cumulative token counters |
| `session.context_breakdown` | current occupancy and estimated categories |
| `session.active_list` | the session's natural start time |
| `host.listPersistedSessions` | cold-start fallback for persisted `input_tokens` + `output_tokens` |

It does **not** write files, make external network requests, or access a database directly. The cold-start fallback goes through the public SDK, which reads the persisted session row on the host; it is labelled approximate because it is not the same aggregate as live `usage.total` (cache, reasoning and compression lineage can differ). State stays in memory.

## Known limits

- Category figures are Hermes estimates; they are not exact tokenizer counts.
- `context_breakdown.context_used` and `focusedUsage.context_used` are different measurements. This plugin deliberately uses the former for the window figure and never combines the two.
- A session absent from `active_list`, or without `started_at`, shows elapsed time as unavailable rather than inventing a start.
- Before the agent has built its context, the breakdown may return no categories; the panel says so instead of drawing zeros.

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
