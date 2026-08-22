import { useState } from 'react';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { TactileButton } from '../../components/TactileButton';

export type AlertActionsMenuProps = {
  captureBusy: boolean;
  onScheduleAlarm: () => void;
  onOpenAlarms: () => void;
  onPinTemplate: () => void;
  onReset: () => void;
};

export function AlertActionsMenu(props: Readonly<AlertActionsMenuProps>) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const items: ContextMenuItem[] = [
    { label: 'Schedule Alarm', onClick: props.onScheduleAlarm },
    { label: 'Alarms', onClick: props.onOpenAlarms },
    { label: 'Pin Template', onClick: props.onPinTemplate },
    { label: 'Reset', onClick: props.onReset, danger: true },
  ];

  return (
    <>
      <TactileButton
        className="alerts-overflow-trigger"
        aria-label="More alert actions"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        disabled={props.captureBusy}
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        }
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ x: rect.right, y: rect.bottom + 4 });
        }}
      />
      {position && (
        <ContextMenu
          x={position.x}
          y={position.y}
          items={items}
          onClose={() => setPosition(null)}
        />
      )}
    </>
  );
}
