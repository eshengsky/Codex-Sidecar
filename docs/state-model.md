# Sidecar 数据引擎与状态模型

本文档说明 packaged Sidecar 的数据所有权、线程状态聚合、崩溃恢复和维护边界。

## 进程边界

| 进程 | 职责 | 禁止承担的工作 |
|---|---|---|
| Electron main | 窗口、原生菜单、更新、数据引擎监督、受限 IPC | transcript 扫描、SQLite 读写、CodexStore 聚合、直接持有 app-server |
| Sidecar Data Engine `utilityProcess` | SQLite v2、单一 app-server、Hook inbox、增量 transcript 索引、投影生成 | UI 与窗口生命周期 |
| Renderer | 展示 revisioned projection、发出有界命令 | 轮询 CodexStore、读取 transcript、推导业务状态 |

主进程只监督数据引擎。数据引擎异常退出后按 `250ms / 1s / 4s / 15s` 退避重启；60 秒内超过 5 次退出时打开熔断，避免无限重启。

Renderer 通过 `MessagePortMain` 接收投影。每次数据引擎重启都会增加 `generation`，同一 generation 内只接受递增的 `revision`，因此旧进程或乱序消息不能覆盖新状态。

## 持久化

正式数据文件是 `sidecar-v2.sqlite`。首次启动 v2 时：

1. 以 SQLite backup API 复制原 `sidecar.sqlite`；
2. 保留 `sidecar-v1.backup.sqlite`；
3. 在候选库中创建 v2 schema；
4. 执行 `PRAGMA integrity_check`；
5. 校验通过后原子 rename 为正式 v2 库；
6. 迁移失败则拒绝启动，不删除原库或备份。

迁移候选始终执行完整 `integrity_check`。正常运行时数据引擎先写入 dirty marker，只有有序退出才写回 clean marker；下次 clean 启动跳过全库校验，dirty/未知状态执行 `quick_check` 后再开放数据库。这样保留异常退出恢复检查，同时避免每次正常启动扫描整个数据库。

旧 `runtime-state.json` 只在首次 v2 启动时导入一次，之后不再是 live state owner。

v2 额外保存：

| 表 | 用途 |
|---|---|
| `hook_inbox` | Hook 幂等入库与处理结果 |
| `runtime_signals` | Hook 推导的即时状态 |
| `transcript_checkpoints` | 文件 identity、byte offset、partial line 和 token 基线 |
| `transcript_facts` | latest lifecycle 与最后用户预览 |
| `thread_daily_usage` | 每线程、每天的 token delta 汇总 |
| `thread_projections` | 当前线程小投影 |
| `projection_meta` | 当前 CodexStore 与 revision |
| `change_log` | 最近 5 个 revision 的恢复记录 |

transcript facts、daily usage 和 checkpoint 在同一 SQLite 事务提交。进程在任意写入点退出，都不会因 checkpoint 落后而重复累计 token。

## Transcript 增量索引

生产路径禁止对 transcript 使用整文件 `readFile()` 或 `split('\n')`。

索引器从 SQLite checkpoint 的 byte offset 继续读取：

- 每次最多读取 256 KiB；
- incomplete JSONL line 以 base64 保存在 checkpoint；
- 单行最大保留 2 MiB；超大图片/base64 记录进入丢弃状态，遇到下一换行后恢复；超大 event_msg 仍从有界前缀提取 lifecycle；
- malformed 或超大记录不会阻塞后续 lifecycle、token 和 context facts；
- inode/device 变化或文件截断时，原子清除该线程的旧 facts、daily usage 和 context usage，再从头索引。
- checkpoint 同时保存 size 与 mtime。文件 identity、size、mtime 均未变化且 checkpoint 位于完整 EOF 时，索引器不会打开 transcript，也不会回写 SQLite。

单行上限只丢弃无法安全保留的大 payload。即使 task lifecycle 记录本身超限，只要 event type 和 `turn_id` 位于有界前缀中，仍会生成 lifecycle fact。

## 数据源

| 数据源 | 用途 |
|---|---|
| Codex hooks | 即时 `running / waiting / failed` 信号 |
| app-server `thread/list` | 可见线程与官方 active/waiting/systemError 元数据 |
| transcript JSONL | lifecycle、异常空完成、context usage、token delta、最后用户预览 |
| `~/.codex/.codex-global-state.json` | Codex 原生未读集合，只读 |
| app-server account APIs | rate limit 与 account usage 辅助数据 |

周期性投影不调用 `thread/read`。`thread/read` 只在用户明确打开线程内导航时由数据引擎读取，数据引擎先提取小预览，再把有界结果返回主进程。

## Hook 到 runtime 的映射

近期 Hook 文件必须先在一个事务中写入 `hook_inbox` 并更新 runtime，才能删除源文件。同一个文件名重复到达时按 inbox 主键去重；源文件删除成功后同步删除已处理的 inbox payload，避免历史 payload 持续放大 SQLite。
Hook JSON 最多有界读取 4 MiB；超限或无效文件移入 `hook-events/quarantine/`，不会阻塞后续事件。
启动恢复不会等待 Hook 积压：数据引擎打开数据库后先发布上次提交的投影和 `ready`，首轮 app-server/transcript 刷新与 Hook 恢复都在后台进行。Hook 按 256 个文件一批处理，整批回放只触发一次投影刷新。超过 24 小时的 Hook 属于过期恢复收件箱，直接清理且不改变 runtime；当前状态由 app-server、transcript facts 和首次导入的 runtime state 重建。

| Hook | runtime |
|---|---|
| `UserPromptSubmit` | `running` |
| `PreToolUse` | `running` |
| `PermissionRequest` | `waiting` |
| `PostToolUse` | payload 有结构化失败标记时 `failed`，否则 `running` |
| `Stop` | 失败时 `failed`，否则清除 runtime |

Hook 是即时信号。若同一 `turn_id` 的 transcript 出现 `task_complete`、`turn_aborted` 或异常空完成，数据引擎会清除 stale runtime。

## Lifecycle 与失败

| transcript 事件 | fact |
|---|---|
| `task_started` | `started` |
| `task_complete` 且 `last_agent_message != null` | `completed` |
| `task_complete` 且显式 `last_agent_message = null` | `failed` |
| `turn_aborted` | `interrupted` |

异常空完成规则来自已验证的断网样本，不能只依赖 app-server `status = failed`。

## 最终状态优先级

每个线程按以下优先级生成 `sidecarStatus`：

1. Hook runtime 为 failed、`thread/list` 为 systemError，或同一 latest turn 的 transcript fact 为 failed：`failed`
2. `thread/list` active flags 等待，或 runtime 为 waiting：`waiting`
3. `thread/list` active，或 runtime 为 running：`running`
4. 原生 unread 且 latest lifecycle 为 completed：`completedUnread`
5. `thread/list` idle，或 latest lifecycle 为 completed/interrupted：`idle`
6. 其他：`unknown`

Renderer 不重新计算这些规则，只展示数据引擎发布的结果。

## 刷新与消息边界

所有刷新来源进入一个 single-flight scheduler：

- app-server notification；
- Hook ingestion；
- Codex 原生未读文件变化；
- 显式命令；
- 5 分钟集中 reconciliation，只用于修复丢失的文件或 app-server 通知。

刷新进行中收到的多个请求只合并为一次 follow-up pass。投影内容没有语义变化时不增加 revision。

rate limit 每 15 秒、account usage 每 60 秒按各自 TTL 刷新。这个轻量路径只访问 account API 并合并当前投影，不调用 `thread/list`，也不扫描 transcript。

跨进程协议采用 allowlist，并限制为 8 MiB。常规列表更小：

- SidecarData 列表只带 continuation metadata，完整摘要按线程读取；
- exploration 列表只带 4,000 字 prompt preview，候选和总结正文按 run 读取；
- 数据导入导出由数据引擎直接读写用户选择的文件；
- app-server mutation response 只返回主进程实际需要的 thread/turn id；
- transcript 或完整 `thread/read` response 不穿过主进程协议。

窗口创建只等待数据库打开/迁移和上次持久化投影，不等待 app-server、首轮 transcript 索引或历史 Hook 清理。首次安装没有旧投影时先显示应用外壳，后台首轮刷新完成后通过 revision stream 填充内容。packaged smoke 模式会显式等待一次完整刷新，避免正常启动的性能优化削弱发布校验。

首轮后台刷新结束后，数据引擎删除超过 5 条的旧 `change_log`。当数据库至少有 4096 页且 freelist 比例达到 25% 时，再执行一次条件 `VACUUM`；该维护发生在 `ready` 之后，不占用窗口启动关键路径。

## 诊断

`diagnostics/events.jsonl` 记录主进程、renderer 和数据引擎健康事件，单文件达到 2 MiB 后轮转为 `events.previous.jsonl`。记录会截断长字符串和深层对象，诊断写入失败不能影响原失败路径。

重点事件：

- `main.uncaughtException`
- `main.unhandledRejection`
- `renderer.gone`
- `renderer.unresponsive`
- `renderer.loadFailed`
- `dataEngine.health`
- `app.childProcessGone`
- `app.startupFailed`

## 维护约束

- 不得把 transcript 整文件读取重新放回 main 或 data engine。
- 不得在多个窗口各自启动 CodexStore 定时刷新。
- 不得绕过 `applyTranscriptBatch()` 分开提交 facts 与 checkpoint。
- 不得让 renderer 直接覆盖较新 generation/revision。
- 不得把 Hook 当作最终真相；必须保留 transcript lifecycle 纠偏。
- 不得把 account usage 的轻量定时刷新重新合并进全量线程扫描。
- 不得在窗口 readiness 前执行常规 integrity scan 或数据库压缩；完整校验只属于迁移，异常恢复使用 quick check。
- 新增跨进程操作必须进入协议 allowlist，并证明最坏响应不超过消息上限。
- 修改状态优先级或异常空完成规则前，必须先用真实 app-server/transcript 样本验证。
