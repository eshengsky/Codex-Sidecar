export type ContextUsageTooltipKey =
  | 'threads.contextUsageTooltip'
  | 'threads.contextUsageContinuationTooltip'
  | 'threads.contextUsageContinuationUrgentTooltip'

export const getContextUsageTooltipKey = (percent: number | null): ContextUsageTooltipKey => {
  if (percent !== null && percent >= 90) {
    return 'threads.contextUsageContinuationUrgentTooltip'
  }

  if (percent !== null && percent >= 70) {
    return 'threads.contextUsageContinuationTooltip'
  }

  return 'threads.contextUsageTooltip'
}
