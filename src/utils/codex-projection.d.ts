interface ProjectionRevision {
  currentGeneration: number
  currentRevision: number
  nextGeneration: number
  nextRevision: number
}

export declare const shouldApplyProjection: (revision: ProjectionRevision) => boolean

export declare const hasUsableCodexProjection: (codexStore: { threads?: unknown } | null | undefined) => boolean
