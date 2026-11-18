[English](README.md) | [简体中文](README.zh-CN.md)

# hermes-context-insight

只读的 Hermes Desktop 插件，显示当前对话的上下文占用情况。

面板跟随 Hermes 的界面语言：英文与简体中文语言包内置于 `plugin.js`，按 `display.language` 解析。

## 显示内容

四张卡片，按重要性排序：

1. **会话累计** — 双弧圆环：**输入**（未缓存输入 + 缓存读取 + 缓存写入）对 **输出**，圆心是两段相加的总量。旁边的四个数字来自 `session.stats`：缓存命中率、未缓存输入、缓存读取、输出。整张卡只用这一个来源，所以弧与图例不可能互相矛盾。缓存写入并入输入弧，不单列。
2. **当前窗口** — 以模型窗口为分母的实测占用：百分比圆环、已用/容量、剩余量、占用彩条，以及分类构成。
3. **耗时** — 自然历时、平均延迟、模型调用次数、缓存命中率、压缩次数与吞吐量。默认收起为一行摘要。

逐项条数卡片已移除：只有**对话**有可数的行集，其余类别只给 token 不给条数，卡片上大多数是“条数未暴露”。随之也去掉了 `session.history` 读取，它是每次刷新里最贵的一次调用。

### 估算与实测

`context_breakdown` 按文本长度估算每个类别，而 `context_used` 是服务商给出的实测值。估算可能偏高或偏低，所以面板同时列出两者并写出差值（例如“估算比实测高 8.7K”）。两个数字都不会被调整成一致。

## 数据与隐私

插件只读取 Hermes Desktop 的公开 SDK 状态和若干个只读网关调用，另有一个可选的冷启动兜底：

| 来源 | 用途 |
|---|---|
| `host.state.focusedUsage` | 实时累计 token 计数 |
| `session.context_breakdown` | 当前占用与分类估算 |
| `session.active_list` | 会话自然起点 |
| `session.stats` | 累计的输入 / 输出 / 缓存计数 |
| `host.listPersistedSessions` | 冷启动时兜底读取已持久化的 `input_tokens` + `output_tokens` |

它**不写文件、不发起外部网络请求、不直接访问数据库**。冷启动兜底走公开 SDK，由宿主读取已持久化的会话行；该数值标记为近似，因为它与实时 `usage.total` 不是同一口径（缓存、推理与压缩血缘可能不同）。状态只留在内存中。

## 已知限制

- 分类数值是 Hermes 的估算，不是精确的分词计数。
- `session.stats` 是唯一把缓存计数以绝对值暴露出来的读取（`cache_read_tokens`、`cache_write_tokens`）；`focusedUsage` 只给出百分比。拿不到 stats 时（第一轮之前尚未建立 agent），卡片回落到 `usage.input` / `usage.output`，并且不显示缓存行，而不是编造一个。
- `context_breakdown.context_used` 与 `focusedUsage.context_used` 是两个不同的测量。本插件在窗口占用上只用前者，从不混用。
- 会话不在 `active_list` 中、或没有 `started_at` 时，历时显示为不可用，而不是臆造一个起点。
- agent 尚未构建上下文时，分类可能为空；面板如实说明，不画零值。
- 没有窗口容量时**不绘制占用彩条**：任何填充都等于声称一个没人测量过的占用。窗口容量优先取分类接口，接口尚未计算时取 `focusedUsage.context_max`。

## 故障排查

**插件显示已加载，但找不到 `Context` 标签页。** 那是 Hermes 持久化的面板关闭记录，不是加载失败：把右侧边栏折叠再展开（`Ctrl+J`），或重置布局。本插件在加载时会清除这样一条记录一次，让面板被重新安置到其他右侧面板旁边。

## 测试

插件没有构建步骤。测试用 Node VM 加一个假的 Hermes SDK 加载 `plugin.js`：

```sh
node test/plugin.test.cjs
```

## 安装（目录发布前，本地安装）

把 `plugin.js` 复制到：

```
<HERMES_HOME>/desktop-plugins/hermes-context-insight/plugin.js
```

目录名必须与插件 id 一致。然后在「能力 → 插件」中启用 **Context Insight**。没有构建步骤。

## 许可证

MIT，见 [LICENSE](LICENSE)。
