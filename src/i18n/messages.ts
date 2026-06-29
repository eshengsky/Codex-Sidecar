export const messages = {
  en: {
    common: {
      cancel: 'Cancel',
      copy: 'Copy',
      delete: 'Delete',
      edit: 'Edit',
      export: 'Export',
      import: 'Import',
      save: 'Save',
      unknown: 'Unknown',
      unnamedProject: 'Untitled project',
      unnamedPrompt: 'Untitled prompt',
      unnamedThread: 'Untitled conversation'
    },
    app: {
      miniMode: 'Mini mode',
      dataReadFailed: 'Failed to read Codex data'
    },
    mini: {
      expandFull: 'Restore full mode'
    },
    panels: {
      threads: 'Threads',
      bookmarks: 'Favorites',
      prompts: 'Prompts',
      settings: 'Settings',
      ariaLabel: 'Sidecar panels'
    },
    status: {
      running: 'Running',
      runningTooltip: 'Running',
      waiting: 'Waiting for approval',
      waitingTooltip: 'Approval needed',
      completedUnread: 'Completed unread',
      failed: 'Failed',
      failedTooltip: 'Failed tasks'
    },
    filters: {
      all: 'All',
      running: 'Running',
      waiting: 'Approval needed',
      completedUnread: 'Completed unread',
      failed: 'Failed tasks'
    },
    threads: {
      search: 'Search titles, projects, or messages',
      emptyTitle: 'No matching conversations',
      emptyDescription: 'Adjust the filter or search terms.'
    },
    bookmarks: {
      typeLabel: 'Favorite type',
      conversations: 'Threads',
      messages: 'Messages',
      searchConversations: 'Search favorite threads',
      searchMessages: 'Search favorite messages',
      emptyConversationsTitle: 'No favorite threads',
      emptyConversationsDescription: 'Favorite threads will appear here.',
      emptyMessagesTitle: 'No favorite messages',
      emptyMessagesDescription: 'Favorite messages from message navigation will appear here.',
      add: 'Add to favorites',
      remove: 'Remove from favorites'
    },
    prompts: {
      search: 'Search prompts',
      add: 'New prompt',
      emptyTitle: 'No matching prompts',
      emptyDescription: 'Adjust the search terms, or add a prompt.',
      editTitle: 'Edit prompt',
      newTitle: 'New prompt',
      tipsTitle: 'Usage guide',
      tipsAgent: 'Long-term project rules, coding standards, and fixed constraints should go in AGENTS.md first.',
      tipsSkill: 'Repeatable workflows, checklists, or specialized capabilities should be created as skills first.',
      tipsPrompt: 'Use prompts here for lightweight, temporary instructions that may need a second edit.',
      tipsDismiss: 'Hide this guide',
      titleLabel: 'Title',
      titlePlaceholder: 'Prompt title',
      bodyLabel: 'Prompt content',
      bodyPlaceholder: 'Enter the prompt content to copy',
      emptyPreview: 'No content',
      emptyBodyError: 'Prompt content is empty.'
    },
    settings: {
      language: 'Language',
      theme: 'Theme',
      miniOverDock: 'Mini mode covers Dock',
      showMiniPrompts: 'Mini mode prompt entry',
      data: 'Data',
      languageOptions: {
        auto: 'Auto',
        en: 'English',
        zh: 'Chinese'
      },
      themeOptions: {
        auto: 'Auto',
        light: 'Light',
        dark: 'Dark'
      }
    },
    navigation: {
      title: 'Message navigation',
      description: 'Browse and jump to user messages in the current conversation',
      accessibilityTitle: 'Accessibility permission required',
      accessibilityDescription: 'Clicking a message preview uses macOS Accessibility to activate Codex, open in-thread search, and paste the message snippet. Allow Sidecar/Electron and /usr/bin/osascript in System Settings / Privacy & Security / Accessibility.',
      search: 'Search user messages',
      empty: 'No matching user messages'
    },
    continuation: {
      title: 'Continue with summary',
      currentThread: 'current conversation',
      body: 'A continuation summary will be generated from "{title}", then used to open a new Codex conversation.',
      detailOne: 'The new conversation will inherit the current goal, constraints, completed work, key decisions, and next steps.',
      detailTwo: 'The original conversation will not be modified. This triggers one hidden model call and may take tens of seconds.',
      confirm: 'Generate and continue'
    },
    usage: {
      remaining: 'Left',
      used: 'Used',
      reset: 'Reset',
      toggleToUsed: 'Switch to used amount',
      toggleToRemaining: 'Switch to remaining amount',
      windowFiveHours: '5 hours',
      windowOneWeek: '1 week',
      referencePoint: 'Reference point {index}',
      resetUnknown: 'Reset time unknown',
      veryLowTitle: 'Very low usage remaining',
      veryLowDescription: 'Consider switching to a faster or lower-cost model before starting long tasks.',
      lowTitle: 'Usage remaining is low',
      lowDescription: 'For larger tasks, consider using a faster or lower-cost model.'
    },
    feedback: {
      copied: 'Copied to clipboard.',
      exported: 'Sidecar data exported.',
      imported: 'Sidecar data imported and overwritten.',
      openedSearch: 'Opened Codex and searched this message.',
      openedThread: 'Opened Codex conversation.',
      summaryOpened: 'Generated the summary and opened the continuation conversation.',
      messageBookmarkThreadMissing: 'The current conversation does not exist, so this message favorite cannot be saved.'
    },
    format: {
      unknown: 'Unknown',
      justNow: 'Just now'
    }
  },
  zh: {
    common: {
      cancel: '取消',
      copy: '复制',
      delete: '删除',
      edit: '编辑',
      export: '导出',
      import: '导入',
      save: '保存',
      unknown: '未知',
      unnamedProject: '未命名项目',
      unnamedPrompt: '未命名提示词',
      unnamedThread: '未命名对话'
    },
    app: {
      miniMode: '迷你模式',
      dataReadFailed: 'Codex 数据读取失败'
    },
    mini: {
      expandFull: '恢复完整模式'
    },
    panels: {
      threads: '对话',
      bookmarks: '收藏',
      prompts: '提示词',
      settings: '设置',
      ariaLabel: 'Sidecar 面板'
    },
    status: {
      running: '运行中',
      runningTooltip: '进行中',
      waiting: '等待用户',
      waitingTooltip: '待审批',
      completedUnread: '完成未读',
      failed: '失败',
      failedTooltip: '异常任务'
    },
    filters: {
      all: '全部',
      running: '进行中',
      waiting: '待审批',
      completedUnread: '完成未读',
      failed: '异常任务'
    },
    threads: {
      search: '搜索标题、项目或消息',
      emptyTitle: '没有匹配的对话',
      emptyDescription: '调整筛选或搜索条件。'
    },
    bookmarks: {
      typeLabel: '收藏类型',
      conversations: '对话',
      messages: '消息',
      searchConversations: '搜索对话收藏',
      searchMessages: '搜索消息收藏',
      emptyConversationsTitle: '没有对话收藏',
      emptyConversationsDescription: '在对话列表中点击添加收藏后，会出现在这里。',
      emptyMessagesTitle: '没有消息收藏',
      emptyMessagesDescription: '在消息导航中点击消息旁边的收藏按钮后，会出现在这里。',
      add: '添加收藏',
      remove: '取消收藏'
    },
    prompts: {
      search: '搜索提示词',
      add: '新增提示词',
      emptyTitle: '没有匹配的提示词',
      emptyDescription: '调整搜索条件，或新增一个提示词。',
      editTitle: '编辑提示词',
      newTitle: '新增提示词',
      tipsTitle: '使用建议',
      tipsAgent: '项目长期规则、代码规范和固定约束，应优先写进 AGENTS.md。',
      tipsSkill: '需要反复复用的流程、检查清单或专门能力，应优先做成 skill。',
      tipsPrompt: '这里适合保存轻量、临时、可能需要二次编辑的指令。',
      tipsDismiss: '不再显示',
      titleLabel: '标题',
      titlePlaceholder: '提示词标题',
      bodyLabel: '提示词内容',
      bodyPlaceholder: '输入要复制的提示词内容',
      emptyPreview: '内容为空',
      emptyBodyError: '提示词内容为空。'
    },
    settings: {
      language: '语言',
      theme: '主题',
      miniOverDock: '迷你模式覆盖 Dock',
      showMiniPrompts: '迷你模式提示词入口',
      data: '数据',
      languageOptions: {
        auto: '自动',
        en: 'English',
        zh: '中文'
      },
      themeOptions: {
        auto: '自动',
        light: '浅色',
        dark: '深色'
      }
    },
    navigation: {
      title: '消息导航',
      description: '浏览并跳转到当前对话中的 user 消息',
      accessibilityTitle: '需要开启辅助功能权限',
      accessibilityDescription: '点击消息预览会用 macOS 辅助功能自动激活 Codex、打开对话内搜索并粘贴消息片段。请在系统设置的“隐私与安全性 / 辅助功能”中允许 Sidecar/Electron 和 /usr/bin/osascript。',
      search: '搜索 user 消息',
      empty: '没有匹配的 user 消息'
    },
    continuation: {
      title: '用摘要接续对话',
      currentThread: '当前对话',
      body: 'Sidecar 会为【{title}】生成接续摘要，并用它自动打开一个新的对话。',
      detailOne: '适合在 Codex 自动压缩上下文后，或长对话需要换新对话继续时使用。',
      detailTwo: '摘要会保留目标、约束、已完成内容、关键决策和下一步；原对话不会被修改。',
      confirm: '继续'
    },
    usage: {
      remaining: '剩余',
      used: '已用',
      reset: '重置',
      toggleToUsed: '切换为已使用量',
      toggleToRemaining: '切换为剩余用量',
      windowFiveHours: '5 小时',
      windowOneWeek: '1 周',
      referencePoint: '参考点{index}',
      resetUnknown: '重置时间未知',
      veryLowTitle: '剩余用量很低',
      veryLowDescription: '后续任务建议切换更快或更低成本模型，避免长任务被限制。',
      lowTitle: '剩余用量偏低',
      lowDescription: '后续大任务可以考虑使用更快或更低成本模型。'
    },
    feedback: {
      copied: '已复制到剪贴板。',
      exported: '已导出 Sidecar 数据。',
      imported: '已覆盖导入 Sidecar 数据。',
      openedSearch: '已打开 Codex 并搜索该消息。',
      openedThread: '已打开 Codex 对话。',
      summaryOpened: '已生成摘要并打开接续对话。',
      messageBookmarkThreadMissing: '当前对话不存在，无法保存消息收藏。'
    },
    format: {
      unknown: '未知',
      justNow: '刚刚'
    }
  }
}
