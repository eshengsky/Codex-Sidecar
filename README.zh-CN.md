<div align="center">
  <img src="build/icon.png" alt="Codex Sidecar" width="120" />

  <h1>Codex Sidecar</h1>

  <p>
    Codex 伴随工具，用来管理 Codex 对话、收藏、额度、上下文占用、对话接续、优选任务和常用指令等。
  </p>

  <p>
    <a href="https://github.com/eshengsky/Codex-Sidecar/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/eshengsky/Codex-Sidecar?color=blue"></a>
    <a href="https://github.com/eshengsky/Codex-Sidecar/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/eshengsky/Codex-Sidecar?include_prereleases&sort=semver"></a>
    <img alt="Local-first" src="https://img.shields.io/badge/local--first-yes-2f855a">
    <img alt="Built with Electron" src="https://img.shields.io/badge/built%20with-Electron-47848f">
    <img alt="Platform" src="https://img.shields.io/badge/platform-macOS-lightgrey">
  </p>

  <p>
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a>
  </p>

  <p>
    <a href="https://github.com/eshengsky/Codex-Sidecar/releases/latest/download/Codex-Sidecar-mac-arm64.dmg">Mac Apple Silicon 下载</a> ·
    <a href="https://github.com/eshengsky/Codex-Sidecar/releases/latest/download/Codex-Sidecar-mac-x64.dmg">Mac Intel 下载</a>
  </p>
</div>

<br/>

<table align="center">
  <tr>
    <td align="center">
      <img src="preview/preview1.png" alt="Codex Sidecar 主窗口" title="主窗口" width="320" /><br/>
      <sub>主窗口</sub>
    </td>
    <td align="center">
      <img src="preview/preview2.png" alt="Codex Sidecar Mini 条" title="Mini 条" width="320" /><br/>
      <sub>Mini 条</sub>
    </td>
  </tr>
</table>

## Codex Sidecar 是什么？

Codex Sidecar 是一个为 Codex Desktop 准备的 macOS 伴随工具。它不替代 Codex 的聊天窗口，而是补上重度使用时缺少的整理、监控与接续能力。

## 为什么需要 Sidecar？

Codex Desktop 已经足够强，但长期使用时会遇到一些具体痛点：

- 缺少一个全局状态总览，无法快速扫到哪些任务正在运行、等待审批、已完成未读或异常失败。
- 想收藏某个重要对话，但「置顶对话」又太重。
- 想收藏某一轮问答，但 Codex 没有轻量入口。
- 无法随时看到额度使用情况和重置时间。
- 无法快速判断哪些长对话快要撑满上下文。
- 长任务需要换对话继续时，手动整理交接上下文很耗时间。

Sidecar 的目标就是解决实际痛点，并增加若干实用功能，让 Codex 更适合长时间和重度使用。

## 功能特色

### 对话总览

通过四个状态灯全局管理 Codex 任务：进行中、待审批、完成未读、异常任务一眼可见。点击对应数字即可查看该状态下的对话列表，多个任务并行时不用在 Codex 窗口里来回找。

### 对话收藏

对话可以收藏到 Sidecar，不需要把它变成 Codex 里的置顶对话。收藏是 Sidecar 本地数据，适合保存「以后还会用，但不一定要一直压在最上面」的对话。

### 消息收藏与索引

Sidecar 支持收藏一轮问答，并在收藏面板中按消息内容、项目、对话标题搜索。点击收藏后会打开对应 Codex 对话。

### 额度监控

Sidecar 在 mini 工具和主面板中展示 Codex 使用额度窗口，支持查看已用 / 剩余额度和重置时间。

### 上下文占用

每个对话可以显示当前上下文占用比例。低占用保持安静，高占用时提示可以考虑对话接续；接近风险区间时提醒尽快接续，避免长对话在关键步骤丢失上下文。

### 对话接续

当一个长对话需要换到新对话继续时，Sidecar 可以生成可复制的接续文本，保留当前目标、用户约束、已完成内容、关键决策、验证状态和下一步。原对话不会被修改。

### 优选

优选会并发运行 2-5 个只读 Codex 对话，让它们独立回答同一个任务，再汇总比较生成更稳的结果。它本质上是用更多 token 和时间换质量，适合架构判断、复杂方案、文案打磨、图片输入分析等需要多候选比较的任务。

### 指令库

保存轻量、临时、常用的指令文本，支持搜索、编辑、复制。长期项目规则仍建议放进 `AGENTS.md`，可复用流程建议做成 skill；Sidecar 指令库更适合临时命令和需要二次编辑的提示。

### Mini 工具

Sidecar 提供更轻量的 mini 窗口，用来常驻查看状态、额度和快捷入口。适合在主 Codex 窗口之外保持一个窄而安静的工作仪表。

### 本地优先

Sidecar 自有数据保存在本机，包括收藏、指令、优选记录、窗口状态、上下文占用缓存和设置。它围绕本地 Codex Desktop 工作，不提供额外云同步服务。

## 下载

- 最新版本：[github.com/eshengsky/Codex-Sidecar/releases/latest](https://github.com/eshengsky/Codex-Sidecar/releases/latest)
- 全部版本：[github.com/eshengsky/Codex-Sidecar/releases](https://github.com/eshengsky/Codex-Sidecar/releases)

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Apple Silicon | [Codex-Sidecar-mac-arm64.dmg](https://github.com/eshengsky/Codex-Sidecar/releases/latest/download/Codex-Sidecar-mac-arm64.dmg) |
| macOS | Intel | [Codex-Sidecar-mac-x64.dmg](https://github.com/eshengsky/Codex-Sidecar/releases/latest/download/Codex-Sidecar-mac-x64.dmg) |

## 首次使用

1. 保证 Codex Desktop 已安装并正在运行。
2. 下载并安装 Codex Sidecar。
3. 启动 Sidecar，按提示在 Codex 设置中信任并启用相关 Hooks。
4. 回到 Sidecar，开始使用。

## 开发者指南

### 技术栈

- **桌面框架**：Electron
- **前端**：Vite、Vue 3、TypeScript、Vue I18n
- **组件和样式**：@nuxt/ui、Tailwind CSS、Iconify / Lucide
- **本地数据**：better-sqlite3、本地 JSON 运行时状态
- **打包发布**：electron-builder、GitHub Actions

### 环境要求

- **Node.js** 24
- **pnpm** 11.3.0
- macOS
- 已安装 Codex Desktop

### 本地开发

```bash
pnpm i
pnpm dev
```

### 发布构建

本地验证当前架构的 macOS DMG：

```bash
pnpm release:local
```

## License

MIT
