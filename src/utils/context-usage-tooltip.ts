export interface ContextUsageTooltipSource {
  percent: number
  totalTokens: number
  modelContextWindow: number
}

export interface ContextUsageTooltipParams {
  percent: number
  totalTokens: string
  modelContextWindow: string
}

const toFiniteNumber = (value: unknown) => {
  const number = Number(value)

  return Number.isFinite(number) ? number : null
}

const formatTokenCount = (value: number, locale: 'en' | 'zh') => {
  const normalizedValue = Math.round(value)
  const localeName = locale === 'zh' ? 'zh-CN' : 'en-US'

  if (normalizedValue < 10000) {
    return new Intl.NumberFormat(localeName, {
      maximumFractionDigits: 0
    }).format(normalizedValue)
  }

  return `${new Intl.NumberFormat(localeName, {
    maximumFractionDigits: 1
  }).format(normalizedValue / 1000)}k`
}

export const getContextUsageTooltipParams = (
  usage: ContextUsageTooltipSource | null | undefined,
  locale: 'en' | 'zh'
): ContextUsageTooltipParams | null => {
  if (!usage) {
    return null
  }

  const percent = toFiniteNumber(usage.percent)
  const totalTokens = toFiniteNumber(usage.totalTokens)
  const modelContextWindow = toFiniteNumber(usage.modelContextWindow)

  if (percent === null || totalTokens === null || modelContextWindow === null) {
    return null
  }

  return {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    totalTokens: formatTokenCount(Math.max(0, totalTokens), locale),
    modelContextWindow: formatTokenCount(Math.max(0, modelContextWindow), locale)
  }
}
