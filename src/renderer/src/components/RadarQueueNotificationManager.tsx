import { useEffect, useRef } from 'react';
import type { RadarSnapshot, RadarStatusColor } from '@shared/ipc';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
import { useToast } from './Toast';

export type RadarTargetKey = 'prod01' | 'prod02' | 'transactionalEmails';

type RadarTarget = {
  key: RadarTargetKey;
  label: string;
};

const TARGETS: readonly RadarTarget[] = [
  { key: 'prod01', label: 'Prod01' },
  { key: 'prod02', label: 'Prod02' },
  { key: 'transactionalEmails', label: 'Transactional Emails Queue Depth' },
];

export function readRadarTargetTones(
  snapshot: RadarSnapshot,
): Map<RadarTargetKey, RadarStatusColor> {
  const tones = new Map<RadarTargetKey, RadarStatusColor>();

  for (const dispatcher of snapshot.dispatchers) {
    const name = dispatcher.name.trim();
    if (/^prod0?1$/i.test(name)) tones.set('prod01', dispatcher.tone);
    if (/^prod0?2$/i.test(name)) tones.set('prod02', dispatcher.tone);
  }

  const transactionalEmailMetric = snapshot.metrics.find(
    (metric) => metric.label.trim().toLowerCase() === 'transactional emails queue depth',
  );
  if (transactionalEmailMetric) {
    tones.set('transactionalEmails', transactionalEmailMetric.tone);
  }

  return tones;
}

export function formatRadarTargetList(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function isUsableSnapshot(snapshot: RadarSnapshot): boolean {
  return snapshot.lastUpdated > 0 && !snapshot.signInRequired && !snapshot.error;
}

export function RadarQueueNotificationManager({
  onOpenRadar,
}: Readonly<{ onOpenRadar: () => void }>) {
  const { snapshot } = useRadarSnapshot();
  const { showToast } = useToast();
  const previousTonesRef = useRef<Map<RadarTargetKey, RadarStatusColor> | null>(null);

  useEffect(() => {
    if (!isUsableSnapshot(snapshot)) return;

    const currentTones = readRadarTargetTones(snapshot);
    if (previousTonesRef.current === null) {
      previousTonesRef.current = currentTones;
      return;
    }

    const newlyRed: string[] = [];
    for (const target of TARGETS) {
      const nextTone = currentTones.get(target.key);
      if (nextTone === undefined) continue;

      const previousTone = previousTonesRef.current.get(target.key);
      if (nextTone === 'red' && previousTone !== undefined && previousTone !== 'red') {
        newlyRed.push(target.label);
      }
      previousTonesRef.current.set(target.key, nextTone);
    }

    if (newlyRed.length === 0) return;

    const targetNames = formatRadarTargetList(newlyRed);
    showToast(
      `${targetNames} ${newlyRed.length === 1 ? 'is' : 'are'} red on Dispatcher Radar.`,
      'error',
      {
        title: newlyRed.length === 1 ? 'Radar queue critical' : 'Radar queues critical',
        durationMs: 8_000,
        delivery: 'radar-critical',
        action: {
          label: 'Open Radar',
          onClick: onOpenRadar,
        },
      },
    );
  }, [onOpenRadar, showToast, snapshot]);

  return null;
}
