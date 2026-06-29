# Sidecar 状态模型

本文档说明 Sidecar 顶部四个状态灯的来源、聚合规则和维护边界。

## 状态灯

Sidecar 当前只展示四类任务状态：

| 状态 | 颜色 | 含义 |
|---|---|---|
| `running` | 蓝色 | Codex 线程当前有任务在执行，或最近 hook 显示任务已开始但尚未被终态纠正 |
| `completedUnread` | 绿色 | Codex 原生未读线程中，最新 turn 已完成的线程 |
| `waiting` | 橙色 | Codex 线程等待用户处理，例如审批或输入 |
| `failed` | 红色 | Codex 线程最新 turn 失败、latest turn 异常完成，或 hook 明确报告失败 |

UI 不直接计算业务状态。UI 只按 `thread.sidecarStatus` 计数和筛选。

## 数据源

| 数据源 | 用途 | 说明 |
|---|---|---|
| Codex hooks | 即时状态变化 | `UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`Stop` 写入 Sidecar hook event 文件 |
| `runtime-state.json` | Sidecar 运行态缓存 | 保存 hook 推导出的 `running` / `waiting` / `failed`，用于跨 snapshot 保持状态 |
| app-server `thread/list` | 当前可见线程列表 | 决定 Sidecar 只展示 Codex 当前列表中的线程 |
| app-server `thread/read` | 读取 latest turn signal | 用于判断完成未读、失败、异常空完成；不能单独作为运行中任务的结束依据 |
| Codex transcript JSONL | turn lifecycle 终态确认 | 读取同一 `turn_id` 的 `task_complete` / `turn_aborted` 事件，用于清理 runtime |
| `~/.codex/.codex-global-state.json` | Codex 原生未读 | 只读取 `unread-thread-ids-by-host-v1.local`，不写入 |

## Hook 到 runtime 的映射

Hook 是即时信号，不是最终真相。

| Hook 事件 | 写入 runtime 状态 |
|---|---|
| `UserPromptSubmit` | `running` |
| `PreToolUse` | `running` |
| `PermissionRequest` | `waiting` |
| `PostToolUse` | 如果 payload 有结构化失败标记则 `failed`，否则 `running` |
| `Stop` | 如果 payload 有结构化失败标记则 `failed`，否则删除 runtime 记录 |

`Stop` 可能漏掉或无法匹配，所以 snapshot 必须再用 transcript lifecycle 纠偏。

## Transcript Lifecycle

本地已验证的 turn lifecycle 事件：

| Transcript 事件 | Sidecar 处理 |
|---|---|
| `event_msg.payload.type = task_started` | 说明 turn 开始；当前不直接写 runtime，避免扫描所有 transcript |
| `event_msg.payload.type = task_complete` | 同一 `turn_id` 的 runtime 可以清除 |
| `event_msg.payload.type = turn_aborted` | 同一 `turn_id` 的 runtime 可以清除 |

不能用 `thread/read` 的 latest turn `status = interrupted` 直接清理 runtime。已验证在任务仍有 hook 写入、transcript 仍在更新时，`thread/read` 也可能返回同一 turn 的 `interrupted`。

## Latest Turn Signal

Sidecar 会对当前列表中的线程读取 latest turn，并用线程 `updatedAt + path` 做内存缓存。线程没有变化时复用缓存，避免每次 snapshot 重复读取所有 `thread/read`。

Latest turn 的失败判断规则：

| app-server latest turn | Sidecar 处理 |
|---|---|
| `status = failed` | `failed` |
| `error != null` | `failed` |
| `status = completed`，有 `userMessage`，但没有 `agentMessage` | `failed` |

第三条用于覆盖已验证的断网失败样本。该样本在 `thread/read` 中表现为 `status = completed`、`error = null`、`items` 只有 `userMessage`；对应 transcript 的 `task_complete.last_agent_message = null`。因此不能只用 `status = failed` 判断红灯。

## Snapshot 聚合流程

每次生成 snapshot 时，按以下流程计算最终状态：

1. 处理 hook event 队列，更新 `runtime-state.json`。
2. 读取 Sidecar 本地数据。
3. 读取 Codex 原生未读文件。
4. 通过 `thread/list` 获取当前可见线程。
5. 用 transcript lifecycle 清理 runtime：
   - 同一 `turn_id` 出现 `task_complete`：删除该 runtime；
   - 同一 `turn_id` 出现 `turn_aborted`：删除该 runtime；
   - 没有 lifecycle 终态事件：保留 runtime。
6. 找出需要读取 latest turn 的线程：
   - 当前 `thread/list` 返回的全部可见线程都会进入 latest turn signal 校验；
   - 线程 `updatedAt + path` 未变化时复用内存缓存，不重复调用 `thread/read`。
7. 对这些线程读取 latest turn signal，用于完成未读、失败和辅助展示。
8. 计算最终 `sidecarStatus`。

## 最终状态优先级

每个线程最终状态按以下优先级计算：

1. runtime 为 `failed`，或 `thread/list` 为 `systemError`，或没有 runtime / runtime 属于同一 turn 时 latest turn signal 为失败：`failed`
2. `thread/list` active flags 表示等待，或 runtime 为 `waiting`：`waiting`
3. `thread/list` 表示 active，或 runtime 为 `running`：`running`
4. Codex 原生 unread、latest turn 为 `completed`，且 latest turn signal 不是失败：`completedUnread`
5. latest turn 为 `completed` / `interrupted`，或 `thread/list` 为 idle：`idle`
6. 其他：`unknown`

## 状态变化规则

| 状态 | 进入条件 | 退出或转移条件 |
|---|---|---|
| `running` | `UserPromptSubmit`、`PreToolUse`、非失败 `PostToolUse`、或 `thread/list` active | 同一 `turn_id` 出现 `task_complete` / `turn_aborted` 时清除；`PermissionRequest` 转 `waiting` |
| `completedUnread` | Codex 原生 unread 中包含该线程，latest turn 为 `completed`，且 latest turn signal 不是失败 | Codex 原生 unread 移除该线程；或 latest turn 不再是 `completed`；或 latest turn signal 变为失败 |
| `waiting` | `PermissionRequest`，或 `thread/list` active flags 包含 `waitingOnApproval` / `waitingOnUserInput` | `PreToolUse` 转 `running`；同一 `turn_id` 出现 `task_complete` / `turn_aborted` 时清除 |
| `failed` | latest turn signal 为失败，`thread/list` 为 `systemError`，或 hook 明确失败 | 新一轮任务开始后 hook 会写入 `running`；同一 `turn_id` 出现 `task_complete` / `turn_aborted` 时清除 stale failed |

## 已验证事实

- 本地 app-server `thread/list` 当前会返回线程列表，但多数线程 `status.type` 为 `notLoaded`。
- 本地 app-server `thread/read` 能读取 latest turn `status`。
- 已观察到 latest turn `status` 包含 `completed` 和 `interrupted`。
- 已观察到断网失败样本在 `thread/read` 中返回 `status = completed`、`error = null`，但 latest turn 只有 `userMessage`，没有 `agentMessage`。
- 已观察到任务仍在执行时，`thread/read` 也可能返回同一 turn 的 `interrupted`，所以不能用它直接清理 `running`。
- 已观察到正常完成时 transcript 写入 `task_complete`，用户中止时 transcript 写入 `turn_aborted`。
- 已观察到断网失败样本的 transcript 写入 `task_complete.last_agent_message = null`。
- 已观察到 `/s` 停止后 latest turn 为 `interrupted`，但 runtime 仍可能残留 `running`，所以需要 transcript lifecycle 纠偏。
- Codex 原生未读来自 `~/.codex/.codex-global-state.json` 中的 `electron-persisted-atom-state.unread-thread-ids-by-host-v1.local`。

## 维护注意

- 不要把 hook 当作唯一真相；hook 只用于即时提醒。
- 不要把 Codex 原生 unread 数直接显示成绿灯；绿灯只取当前列表中的 unread completed 子集。
- 不要让 `thread/read` 的 latest turn status 直接覆盖 hook runtime。
- 不要只用 `latestTurn.status = failed` 判断红灯；异常空完成也要算失败。
- 如果 latest turn signal 失败且 runtime 仍指向同一个 `turn_id`，应显示红灯，避免同一 turn 的 stale running/waiting 盖住失败。
- 如果以后发现新的 transcript lifecycle 事件，必须先用本地 transcript 验证含义，再加入状态规则。
