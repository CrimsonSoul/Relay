import { useCallback, useEffect } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useToast } from '../components/Toast';

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
  /** Toast messages – allows each consumer to keep its original wording. */
  toastMessages?: {
    copyTeamSuccess?: (team: string) => string;
    copyTeamError?: string;
    copyAllSuccess?: string;
    copyAllError?: string;
  };
}

/**
 * Shared logic for the on-call board used by both PersonnelTab and PopoutBoard.
 *
 * Provides:
 * - `animationParent` ref and `enableAnimations` control (auto-animate)
 * - Resize-aware animation disable effect
 * - `handleCopyTeamInfo` / `handleCopyAllOnCall` clipboard helpers
 * - `formatTeamOnCall` (also exported standalone above)
 */
export function useOnCallBoard({ teams, getTeamRows, toastMessages }: UseOnCallBoardOptions) {
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
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [enableAnimations]);

  // --------------- Clipboard helpers ---------------
  const handleCopyTeamInfo = useCallback(
    async (team: string, rows: OnCallRow[]) => {
      const text = formatTeamOnCall(team, rows);
      const success = await window.api?.writeClipboard(text);
      if (success) {
        showToast(
          toastMessages?.copyTeamSuccess
            ? toastMessages.copyTeamSuccess(team)
            : `Copied ${team} info`,
          'success',
        );
      } else {
        showToast(toastMessages?.copyTeamError ?? 'Failed to copy', 'error');
      }
    },
    [showToast, toastMessages],
  );

  const handleCopyAllOnCall = useCallback(async () => {
    const allText = teams.map((team) => formatTeamOnCall(team, getTeamRows(team))).join('\n');
    const success = await window.api?.writeClipboard(allText);
    if (success) {
      showToast(toastMessages?.copyAllSuccess ?? 'Copied all info', 'success');
    } else {
      showToast(toastMessages?.copyAllError ?? 'Failed to copy', 'error');
    }
  }, [teams, getTeamRows, showToast, toastMessages]);

  return {
    animationParent,
    enableAnimations,
    handleCopyTeamInfo,
    handleCopyAllOnCall,
  };
}
