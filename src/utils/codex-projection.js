export const shouldApplyProjection = ({
  currentGeneration,
  currentRevision,
  nextGeneration,
  nextRevision
}) => {
  if (!Number.isSafeInteger(nextGeneration) || !Number.isSafeInteger(nextRevision)) {
    return false
  }

  if (nextGeneration > currentGeneration) {
    return true
  }

  return nextGeneration === currentGeneration && nextRevision > currentRevision
}

export const hasUsableCodexProjection = codexStore => {
  return Boolean(codexStore && Array.isArray(codexStore.threads))
}
