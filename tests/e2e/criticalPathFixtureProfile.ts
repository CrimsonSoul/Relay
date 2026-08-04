export type CriticalPathFixtureProfile = Readonly<{
  knowledgeChunkDelayMs: number | null;
  seedKnowledgeLinks: boolean;
  startupDelayMs: number | null;
}>;

const profile = (values: CriticalPathFixtureProfile): CriticalPathFixtureProfile =>
  Object.freeze(values);

export const criticalPathFixtureProfiles = Object.freeze({
  default: profile({
    knowledgeChunkDelayMs: null,
    seedKnowledgeLinks: false,
    startupDelayMs: null,
  }),
  delayedStartup: profile({
    knowledgeChunkDelayMs: null,
    seedKnowledgeLinks: false,
    startupDelayMs: 1_000,
  }),
  seededKnowledge: profile({
    knowledgeChunkDelayMs: null,
    seedKnowledgeLinks: true,
    startupDelayMs: null,
  }),
  delayedKnowledgeUpload: profile({
    knowledgeChunkDelayMs: 150,
    seedKnowledgeLinks: true,
    startupDelayMs: null,
  }),
  renameContract: profile({
    knowledgeChunkDelayMs: 150,
    seedKnowledgeLinks: true,
    startupDelayMs: 1_000,
  }),
});
