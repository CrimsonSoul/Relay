import type { StartupPhase, StartupSnapshot } from '@shared/ipc';

const MAX_MESSAGE_LENGTH = 240;

const DEFAULT_MESSAGES: Record<StartupPhase, string> = {
  launching: 'Starting Relay…',
  'preparing-data': 'Preparing Relay data…',
  ready: 'Relay is ready.',
  failed: 'Relay could not finish starting.',
};

const LEGAL_TRANSITIONS: Record<StartupPhase, ReadonlySet<StartupPhase>> = {
  launching: new Set(['preparing-data', 'failed']),
  'preparing-data': new Set(['ready', 'failed']),
  ready: new Set(),
  failed: new Set(),
};

export type StartupStateController = {
  getSnapshot: () => StartupSnapshot;
  beginGeneration: () => number;
  transition: (generation: number, phase: StartupPhase, message?: string) => boolean;
  subscribe: (listener: (snapshot: StartupSnapshot) => void) => () => void;
};

function normalizeMessage(phase: StartupPhase, message?: string): string {
  const value = message?.trim() || DEFAULT_MESSAGES[phase];
  return value.slice(0, MAX_MESSAGE_LENGTH);
}

export function createStartupStateController(
  metadata: Readonly<Pick<StartupSnapshot, 'recoveryMode' | 'launchIntent'>> = {},
): StartupStateController {
  let snapshot: StartupSnapshot = {
    generation: 0,
    sequence: 0,
    phase: 'launching',
    message: DEFAULT_MESSAGES.launching,
    ...metadata,
  };
  const listeners = new Set<(value: StartupSnapshot) => void>();

  const publish = (next: StartupSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener({ ...next });
  };

  return {
    getSnapshot: () => ({ ...snapshot }),
    beginGeneration: () => {
      const generation = snapshot.generation + 1;
      publish({
        generation,
        sequence: snapshot.sequence + 1,
        phase: 'launching',
        message: DEFAULT_MESSAGES.launching,
        ...metadata,
      });
      return generation;
    },
    transition: (generation, phase, message) => {
      if (generation !== snapshot.generation || !LEGAL_TRANSITIONS[snapshot.phase].has(phase)) {
        return false;
      }
      publish({
        generation,
        sequence: snapshot.sequence + 1,
        phase,
        message: normalizeMessage(phase, message),
        ...metadata,
      });
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
