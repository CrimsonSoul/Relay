export type StartupMilestone =
  | 'entry'
  | 'electron-ready'
  | 'window-created'
  | 'shell-ready'
  | 'data-root'
  | 'pocketbase-healthy'
  | 'credentials-ready'
  | 'schema-ready'
  | 'workspace-ready'
  | 'renderer-mounted';

export type StartupTimeline = {
  mark: (milestone: Exclude<StartupMilestone, 'entry'>) => number;
  toJSON: () => Partial<Record<StartupMilestone, number>>;
  takeSummary: () => string | null;
};

const MAX_SUMMARY_LENGTH = 1_200;

export function createStartupTimeline(monotonicNow = () => performance.now()): StartupTimeline {
  const startedAt = monotonicNow();
  const milestones: Partial<Record<StartupMilestone, number>> = { entry: 0 };
  let summaryTaken = false;

  return {
    mark: (milestone) => {
      const existing = milestones[milestone];
      if (existing !== undefined) return existing;
      const elapsed = Math.max(0, Math.round(monotonicNow() - startedAt));
      milestones[milestone] = elapsed;
      return elapsed;
    },
    toJSON: () => ({ ...milestones }),
    takeSummary: () => {
      if (summaryTaken) return null;
      summaryTaken = true;
      return `Relay startup timing ${JSON.stringify(milestones)}`.slice(0, MAX_SUMMARY_LENGTH);
    },
  };
}
