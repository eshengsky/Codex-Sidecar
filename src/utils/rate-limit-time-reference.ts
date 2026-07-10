import type { UsageDisplayMode } from '@/types/sidecar'

export interface RateLimitTimeReferenceInput {
  windowDurationMins: number | null | undefined
  resetsAt: number | null | undefined
  mode: UsageDisplayMode
  nowMs?: number
}

export interface RateLimitUsagePaceInput {
  usedPercent: number | null | undefined
  windowDurationMins: number | null | undefined
  resetsAt: number | null | undefined
  nowMs?: number
}

const clampPercent = (value: number) => {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

const getElapsedWindowPercent = (
  windowDurationMins: number | null | undefined,
  resetsAt: number | null | undefined,
  nowMs: number
) => {
  const durationMs = Number(windowDurationMins) * 60 * 1000

  if (!Number.isFinite(durationMs) || durationMs <= 0 || !resetsAt || !Number.isFinite(resetsAt)) {
    return null
  }

  const remainingMs = resetsAt - nowMs
  return clampPercent(((durationMs - remainingMs) / durationMs) * 100)
}

export const getRateLimitTimeReferencePercent = ({
  windowDurationMins,
  resetsAt,
  mode,
  nowMs = Date.now()
}: RateLimitTimeReferenceInput) => {
  const elapsedPercent = getElapsedWindowPercent(windowDurationMins, resetsAt, nowMs)

  if (elapsedPercent === null) {
    return null
  }

  return mode === 'remaining' ? clampPercent(100 - elapsedPercent) : elapsedPercent
}

export const isRateLimitUsageAheadOfTime = ({
  usedPercent,
  windowDurationMins,
  resetsAt,
  nowMs = Date.now()
}: RateLimitUsagePaceInput) => {
  if (usedPercent === null || usedPercent === undefined || !Number.isFinite(usedPercent)) {
    return false
  }

  const elapsedPercent = getElapsedWindowPercent(windowDurationMins, resetsAt, nowMs)

  if (elapsedPercent === null) {
    return false
  }

  return clampPercent(usedPercent) > elapsedPercent
}
