# Codex-Sidecar

Codex Sidecar 是一个 macOS 上的 Codex Desktop 伴随面板。它通过 Codex app-server 读取线程、用量和线程内容，通过 Codex hooks 接收运行中、等待用户和失败事件，并维护自己的本地收藏、提示词模板与导入导出数据。

## 当前范围

- 迷你模式状态条：运行中、等待用户、失败、完成未读、5h / 1 周剩余用量。
- 完整模式对话列表：按更新时间倒序，支持状态筛选、搜索和收藏。
- 收藏页：统一查看对话收藏和消息收藏，消息收藏可打开 Codex 对话并搜索对应消息片段。
- 运行中 / 等待用户 / 失败：由用户级 Codex hooks 写入 Sidecar 事件队列，Sidecar 启动时先回放未处理事件，再监听新增事件。
- 完成未读：只读读取 `~/.codex/.codex-global-state.json` 中的 `electron-persisted-atom-state.unread-thread-ids-by-host-v1.local`，再和当前线程列表取交集，并用最近 turn 状态筛出已完成线程。
- 用量监控：通过 `account/rateLimits/read` 读取，并以“剩余用量”显示。
- 上下文使用率：通过 `thread/tokenUsage/updated` 缓存运行中/已加载线程的上下文百分比，拿不到则不显示。
- 提示词 / Runbook：支持搜索和复制到剪贴板。
- 本地数据导入导出：覆盖导入/导出 Sidecar 自己的数据，不写 Codex 原生状态。

## 运行

依赖尚未安装时，先执行：

```bash
pnpm install
```

开发运行：

```bash
pnpm dev
```

## app-server 与 hooks

Sidecar 通过 `codex app-server --stdio` 读取线程列表、用量和线程内容。

运行态不使用 app-server 轮询。Sidecar 启动时会确保用户级 `~/.codex/hooks.json` 包含自己的 command hooks：

- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`
- `Stop`

这些 hooks 调用 Sidecar 安装到 Electron `userData` 目录下的 `sidecar-hook-capture.sh`，把 Codex 传入的 hook JSON 写入 `hook-events/` 目录。Sidecar 会先回放目录内未处理事件，再监听新增事件，并把最终运行态保存到 `runtime-state.json`。

Codex 官方要求非 managed command hooks 经过 trust review；Sidecar 只负责自动写入 hook 配置和捕获脚本，不修改 Codex 的 trust 策略。

## 本地数据

Sidecar 数据存放在 Electron 的 `userData` 目录下。提示词、对话收藏和消息收藏都存放在 `sidecar-data.json`。Codex Desktop 的未读状态只读读取，不会被 Sidecar 修改。
