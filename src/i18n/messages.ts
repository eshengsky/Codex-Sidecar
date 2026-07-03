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
      unnamedPrompt: 'Untitled instruction',
      unnamedThread: 'Untitled conversation'
    },
    app: {
      dataReadFailed: 'Failed to read Codex data'
    },
    hookSetup: {
      title: 'Enable Codex Hooks',
      description: 'Sidecar uses Codex Hooks to capture tool runs, permission requests, and task status. Trust and enable Sidecar hooks in Codex settings.',
      openSettings: 'Open Codex settings',
      steps: {
        openSettings: 'Open Codex settings',
        openHooks: 'Go to Hooks',
        trustHooks: 'Trust and enable all Sidecar hooks'
      },
      status: {
        missing: 'Sidecar hooks were not detected',
        untrusted: 'Some hooks are not trusted',
        disabled: 'Some hooks are not enabled'
      }
    },
    mini: {
      expandFull: 'Open main window'
    },
    panels: {
      threads: 'Threads',
      bookmarks: 'Favorites',
      explorations: 'Select',
      prompts: 'Instructions',
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
      emptyDescription: 'Adjust the filter or search terms.',
      contextUsageTooltip: 'Context used {percent}%',
      contextUsageContinuationTooltip: 'Context used {percent}%, consider using conversation continuation',
      contextUsageContinuationUrgentTooltip: 'Context used {percent}%, use conversation continuation'
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
      emptyMessagesDescription: 'Favorite Q&A turns from message navigation will appear here.',
      add: 'Add to favorites',
      remove: 'Remove from favorites',
      addTurn: 'Favorite',
      removeTurn: 'Remove'
    },
    explorations: {
      title: 'Select',
      new: 'New selection',
      tipsTitle: 'What Select does',
      tipsParallel: 'Runs 2-5 read-only Codex conversations in parallel, lets them answer the same task independently, then compares and summarizes a steadier result.',
      tipsTradeoff: 'It trades more tokens and time for quality; selection runs read-only and does not directly modify project files.',
      search: 'Search selections',
      context: 'Context',
      noContext: 'No history context',
      noContextPlaceholder: 'No conversation context',
      searchContext: 'Search conversations',
      promptPlaceholder: 'Ask Codex to select in parallel...',
      attachImage: 'Attach images',
      removeImage: 'Remove image',
      runCount: 'Run count',
      send: 'Send',
      countLabel: 'x{count}',
      emptyTitle: 'No matching selections',
      emptyDescription: 'Adjust the search terms, or start a new selection.',
      openResult: 'Open result',
      resultTitle: 'Selection result',
      summary: 'Summary',
      candidate: 'Candidate {index}',
      basedOnPrefix: 'Based on',
      basedOn: 'Based on {title}',
      standalone: 'No history context',
      images: '{count} images',
      copyContent: 'Copy content',
      copyContinuation: 'Copy continuation',
      originalRequest: 'Original request',
      viewFullRequest: 'View full',
      imageOnlyRequest: 'The original request only included {count} image(s).',
      emptyRequest: 'No original request text.',
      missingResult: 'Selection not found',
      resultPending: 'Results are available after summary finishes.',
      status: {
        running: 'Running',
        summarizing: 'Summarizing',
        completed: 'Completed',
        partialFailed: 'Partial failure',
        failed: 'Failed',
        pending: 'Pending'
      }
    },
    prompts: {
      search: 'Search instructions',
      add: 'New instruction',
      emptyTitle: 'No matching instructions',
      emptyDescription: 'Adjust the search terms, or add an instruction.',
      editTitle: 'Edit instruction',
      newTitle: 'New instruction',
      tipsTitle: 'Usage guide',
      tipsAgent: 'Long-term project rules, coding standards, and fixed constraints should go in AGENTS.md first.',
      tipsSkill: 'Repeatable workflows, checklists, or specialized capabilities should be created as skills first.',
      tipsPrompt: 'Use instructions here for lightweight, temporary commands that may need a second edit.',
      titleLabel: 'Title',
      titlePlaceholder: 'Instruction title',
      bodyLabel: 'Instruction content',
      bodyPlaceholder: 'Enter the instruction content to copy',
      emptyPreview: 'No content',
      emptyBodyError: 'Instruction content is empty.'
    },
    settings: {
      language: 'Language',
      theme: 'Theme',
      showMiniTool: 'Show mini tool',
      miniOverDock: 'Mini tool covers Dock',
      showMiniPrompts: 'Mini tool instruction entry',
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
      description: 'Browse user messages with final assistant answers; clicking opens the Codex conversation',
      search: 'Search messages',
      empty: 'No matching messages'
    },
    continuation: {
      title: 'Continue with summary',
      currentThread: 'current conversation',
      body: 'Sidecar will generate continuation text from "{title}" for copying.',
      detailOne: 'Use it when a long conversation needs a handoff context.',
      detailTwo: 'The text keeps the current goal, constraints, completed work, key decisions, and next steps. The original conversation will not be modified.',
      copyLast: 'Copy latest',
      generatedAt: 'Generated: {time}',
      generatedAtUnknown: 'Generated time unknown',
      confirm: 'Generate',
      regenerate: 'Regenerate'
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
      copied: 'Copied to clipboard',
      explorationCreated: 'Selection started',
      explorationImagesAdded: 'Images attached',
      explorationOpenAfterDone: 'Open results after summary finishes',
      exported: 'Sidecar data exported',
      imported: 'Sidecar data imported and overwritten',
      summaryOpened: 'Generated the continuation text',
      turnBookmarkThreadMissing: 'The current conversation does not exist, so this Q&A turn favorite cannot be saved'
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
      unnamedPrompt: '未命名指令',
      unnamedThread: '未命名对话'
    },
    app: {
      dataReadFailed: 'Codex 数据读取失败'
    },
    hookSetup: {
      title: '启用 Codex Hooks',
      description: 'Sidecar 需要通过 Codex Hooks 捕获工具执行、权限请求和任务状态。请在 Codex 设置中信任并启用 Sidecar hooks。',
      openSettings: '打开 Codex 设置',
      steps: {
        openSettings: '打开 Codex 设置',
        openHooks: '进入 Hooks',
        trustHooks: '信任并启用所有 Sidecar hooks'
      },
      status: {
        missing: '未检测到 Sidecar hooks',
        untrusted: '有 hooks 尚未信任',
        disabled: '有 hooks 尚未启用'
      }
    },
    mini: {
      expandFull: '打开主窗口'
    },
    panels: {
      threads: '对话',
      bookmarks: '收藏',
      explorations: '优选',
      prompts: '指令',
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
      emptyDescription: '调整筛选或搜索条件。',
      contextUsageTooltip: '已用上下文 {percent}%',
      contextUsageContinuationTooltip: '已用上下文 {percent}%，可考虑使用对话接续',
      contextUsageContinuationUrgentTooltip: '已用上下文 {percent}%，建议使用对话接续'
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
      emptyMessagesDescription: '在消息导航中收藏的一轮问答会出现在这里。',
      add: '添加收藏',
      remove: '取消收藏',
      addTurn: '收藏',
      removeTurn: '取消收藏'
    },
    explorations: {
      title: '优选',
      new: '新建优选',
      tipsTitle: '优选说明',
      tipsParallel: '并发运行 2-5 个只读 Codex 对话，让它们独立回答同一个任务，再汇总对比生成更稳的结果。',
      tipsTradeoff: '本质是用更多 token 和时间换质量；优选过程只读运行，不会直接修改项目文件。',
      search: '搜索优选',
      context: '上下文',
      noContext: '不使用历史上下文',
      noContextPlaceholder: '不使用对话上下文',
      searchContext: '搜索对话',
      promptPlaceholder: '让 Codex 并发优选...',
      attachImage: '添加图片',
      removeImage: '移除图片',
      runCount: '执行次数',
      send: '发送',
      countLabel: 'x{count}',
      emptyTitle: '没有匹配的优选',
      emptyDescription: '调整搜索条件，或新建一次优选。',
      openResult: '打开结果',
      resultTitle: '优选结果',
      summary: '总结',
      candidate: '候选 {index}',
      basedOnPrefix: '基于',
      basedOn: '基于 {title}',
      standalone: '无历史上下文',
      images: '{count} 张图片',
      copyContent: '复制内容',
      copyContinuation: '复制接续',
      originalRequest: '原始问题',
      viewFullRequest: '查看完整',
      imageOnlyRequest: '原始问题只包含 {count} 张图片。',
      emptyRequest: '原始问题没有文本内容。',
      missingResult: '优选记录不存在',
      resultPending: '总结完成后才能打开结果。',
      status: {
        running: '运行中',
        summarizing: '总结中',
        completed: '已完成',
        partialFailed: '部分失败',
        failed: '失败',
        pending: '等待中'
      }
    },
    prompts: {
      search: '搜索指令',
      add: '新增指令',
      emptyTitle: '没有匹配的指令',
      emptyDescription: '调整搜索条件，或新增一条指令。',
      editTitle: '编辑指令',
      newTitle: '新增指令',
      tipsTitle: '使用建议',
      tipsAgent: '项目长期规则、代码规范和固定约束，应优先写进 AGENTS.md。',
      tipsSkill: '需要反复复用的流程、检查清单或专门能力，应优先做成 skill。',
      tipsPrompt: '这里适合保存轻量、临时、可能需要二次编辑的指令。',
      titleLabel: '标题',
      titlePlaceholder: '指令标题',
      bodyLabel: '指令内容',
      bodyPlaceholder: '输入要复制的指令内容',
      emptyPreview: '内容为空',
      emptyBodyError: '指令内容为空。'
    },
    settings: {
      language: '语言',
      theme: '主题',
      showMiniTool: '显示 mini 工具',
      miniOverDock: 'mini 工具覆盖 Dock',
      showMiniPrompts: 'mini 工具指令入口',
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
      description: '浏览当前对话中的 user 消息和 assistant 最终回复，点击后打开 Codex 对话',
      search: '搜索消息',
      empty: '没有匹配的消息'
    },
    continuation: {
      title: '对话接续',
      currentThread: '当前对话',
      body: 'Sidecar 会为【{title}】生成一段可复制的接续文本。',
      detailOne: '适合在长对话需要交接上下文时使用。',
      detailTwo: '接续文本会保留目标、约束、已完成内容、关键决策和下一步；原对话不会被修改。',
      copyLast: '复制上次接续',
      generatedAt: '上次生成：{time}',
      generatedAtUnknown: '上次生成时间未知',
      confirm: '生成接续',
      regenerate: '重新生成'
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
      copied: '已复制到剪贴板',
      explorationCreated: '已开始优选',
      explorationImagesAdded: '已添加图片',
      explorationOpenAfterDone: '总结完成后才能打开结果',
      exported: '已导出 Sidecar 数据',
      imported: '已覆盖导入 Sidecar 数据',
      summaryOpened: '已生成接续文本',
      turnBookmarkThreadMissing: '当前对话不存在，无法保存本轮问答收藏'
    },
    format: {
      unknown: '未知',
      justNow: '刚刚'
    }
  }
}
