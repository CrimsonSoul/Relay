import { useState } from 'react';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';

export type AlertActionsMenuProps = {
  captureBusy: boolean;
  onScheduleAlarm: () => void;
  onOpenAlarms: () => void;
  onOpenHistory: () => void;
  onPinTemplate: () => void;
  onReset: () => void;
};

export function AlertActionsMenu(props: Readonly<AlertActionsMenuProps>) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const items: ContextMenuItem[] = [
    { label: 'Schedule Alarm', onClick: props.onScheduleAlarm },
    { label: 'Alarms', onClick: props.onOpenAlarms },
    { label: 'History', onClick: props.onOpenHistory },
    { label: 'Pin Template', onClick: props.onPinTemplate },
    { label: 'Reset', onClick: props.onReset, danger: true },
  ];

  return (
    <>
      <button
        type="button"
        className="alerts-overflow-trigger"
        aria-label="More alert actions"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        disabled={props.captureBusy}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ x: rect.right, y: rect.bottom + 4 });
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
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
