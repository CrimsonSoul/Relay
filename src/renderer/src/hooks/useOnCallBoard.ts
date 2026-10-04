import { useCallback, useEffect } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';

/**
 * Format on-call rows as a human-readable text line for copying.
 */
export function formatTeamOnCall(team: string, rows: OnCallRow[]): string {
  if (rows.length === 0) return `${team}: (empty)`;
  const members = rows.map((r) => {
    const parts = [r.role];
    if (r.name) parts.push(r.name);
    if (r.contact) parts.push(`(${r.contact})`);
    if (r.timeWindow) parts.push(`[${r.timeWindow}]`);
    return parts.join(' ');
  });
  return `${team}: ${members.join(' | ')}`;
}

interface UseOnCallBoardOptions {
  /** Ordered list of team names. */
  teams: string[];
  /** Returns the on-call rows for a given team. */
  getTeamRows: (team: string) => OnCallRow[];
}

/** Rows with a person on them; blank role placeholders are not people. */
const countPeople = (rows: readonly OnCallRow[]) =>
  rows.filter((row) => row.name.trim() || row.contact.trim()).length;

const peopleLabel = (count: number) => (count === 1 ? '1 person' : `${count} people`);

const CLIPBOARD_FAILURE = {
  error: 'Clipboard access was blocked',
  outcome: 'Nothing was copied.',
  next: 'Allow clipboard access and try again.',
};

/**
 * Shared logic for the on-call board rendered by PersonnelTab.
 *
 * Provides:
 * - `animationParent` ref and `enableAnimations` control (auto-animate)
 * - Resize-aware animation disable effect
 * - `handleCopyTeamInfo` / `handleCopyAllOnCall` clipboard helpers
 * - `formatTeamOnCall` (also exported standalone above)
 */
export function useOnCallBoard({ teams, getTeamRows }: UseOnCallBoardOptions) {
  const { showToast } = useToast();

  // --------------- Auto-animate setup ---------------
  const [animationParent, enableAnimations] = useAutoAnimate({
    duration: 500,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  });

  // Disable animations during active window resize to prevent jank
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      enableAnimations(false);
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        enableAnimations(true);
      }, 150);
    };
    globalThis.addEventListener('resize', handleResize);
    return () => {
      globalThis.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [enableAnimations]);

  // --------------- Clipboard helpers ---------------
  const handleCopyTeamInfo = useCallback(
    async function copyTeam(team: string, rows: OnCallRow[]): Promise<void> {
      const text = formatTeamOnCall(team, rows);
      const success = await globalThis.api?.writeClipboard(text);
      if (success) {
        showToast(`Copied ${team} (${peopleLabel(countPeople(rows))})`, 'success');
        return;
      }
      showToast(formatFailure({ what: `Couldn't copy ${team}`, ...CLIPBOARD_FAILURE }), 'error', {
        action: { label: 'Retry', onClick: () => void copyTeam(team, rows) },
      });
    },
    [showToast],
  );

  const handleCopyAllOnCall = useCallback(
    async function copyAll(): Promise<void> {
      const allText = teams.map((team) => formatTeamOnCall(team, getTeamRows(team))).join('\n');
      const success = await globalThis.api?.writeClipboard(allText);
      if (success) {
        const people = teams.reduce((sum, team) => sum + countPeople(getTeamRows(team)), 0);
        const teamLabel = teams.length === 1 ? '1 team' : `${teams.length} teams`;
        showToast(`Copied ${teamLabel} (${peopleLabel(people)})`, 'success');
        return;
      }
      showToast(
        formatFailure({ what: "Couldn't copy the on-call board", ...CLIPBOARD_FAILURE }),
        'error',
        { action: { label: 'Retry', onClick: () => void copyAll() } },
      );
    },
    [teams, getTeamRows, showToast],
  );

  return {
    animationParent,
    enableAnimations,
    handleCopyTeamInfo,
    handleCopyAllOnCall,
  };
}
