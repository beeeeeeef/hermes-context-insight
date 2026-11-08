# Troubleshooting: the panel does not appear

Symptom: **Capabilities → Plugins** lists *Context Insight* with a checkmark and
`Desktop` / `Disk`, Hermes was restarted, the file is the current build — yet no
`Context` tab exists anywhere in the window.

That combination means the plugin **loaded**; the problem is placement, not loading.

## Root cause

Hermes persists the whole pane layout (dock tree, tab order, per-pane open/closed
records) in the renderer's `localStorage` under keys such as
`hermes.desktop.layoutTree.v2` and `hermes.desktop.dismissedPanes.v1`. A
contributed pane that was once closed keeps a **dismissal record** across
restarts.

A dismissal is honoured even though the plugin keeps registering its pane: the
pane stays in the saved tree but is not rendered in any tab strip. Reinstalling
the plugin or restarting Hermes does **not** clear the record, because neither
touches layout state.

Observed layout while broken (read from `Local Storage/leveldb`):

```json
{"id":"g-...-6","panes":["workspace","quick-dashboard:overview-pane",
                         "step-ledger:ledger","hermes-context-insight:panel"],
 "active":"workspace"}
{"id":"g-...-65","panes":["hermes-trajectory:panel"],"tabStrip":"always"}
```

`hermes-context-insight:panel` sat in the **main workspace** group, which showed
only its `active` tab. Trajectory had its own right-hand group, which is why one
plugin was visible and the other was not.

## Fix shipped in this plugin

`register()` clears the stale dismissal once, then records a flag so a later
deliberate close is respected:

```js
if (ctx.storage?.get?.('placementRepaired.v1') !== true) {
  host.undismissPane(`${ID}:panel`)   // forget the remembered close
  ctx.storage?.set?.('placementRepaired.v1', true)
}
```

`undismissPane` forgets the close and re-runs placement adoption, so the pane
returns to the location its `data.placement` hint names (`right`). It is the
SDK's documented remedy for a pane "stranded where only a layout reset can
recover it".

## User-facing recovery (applies to any plugin)

If a plugin pane is closed and seems gone:

1. **Collapse and re-open that sidebar** (toggle button, or `Ctrl+J`).
   Opening a side heals every dismissed pane mapped to that side — see
   `setTreeSideCollapsed` -> `restoreDismissedSidePanes` in Hermes' pane store.
2. If that does not help, **reset the layout** in Hermes. This restores default
   placement for every contributed pane, at the cost of your custom arrangement.

## Notes for other plugins

This is Hermes behaviour, not specific to this plugin: **any** contributed pane
can be in a dismissed state. A plugin that only registers its pane and never
calls `undismissPane` will look "installed but invisible" in exactly this way.

If the pane is meant to stay available, call `host.undismissPane('<pluginId>:<paneId>')`
once on load (guarded by a stored flag, as above) or rely on the user's
side-toggle recovery.
