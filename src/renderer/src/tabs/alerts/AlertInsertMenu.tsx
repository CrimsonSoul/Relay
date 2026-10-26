import { useRef, useState } from 'react';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { toolbarActivationProps } from './toolbarActivation';

export type AlertInsertKind = 'step' | 'note' | 'warning' | 'success' | 'divider' | 'button';

const INSERT_ITEMS: ReadonlyArray<{ kind: AlertInsertKind; label: string }> = [
  { kind: 'step', label: 'Step' },
  { kind: 'note', label: 'Note' },
  { kind: 'warning', label: 'Warning' },
  { kind: 'success', label: 'Success' },
  { kind: 'divider', label: 'Divider' },
  { kind: 'button', label: 'Button Link' },
];

type AlertInsertMenuProps = {
  /** Called as the menu opens, while the body still holds the caret. */
  onOpen: () => void;
  onChoose: (kind: AlertInsertKind) => void;
};

/** Body toolbar menu that adds a guide block after the caret's block. */
export function AlertInsertMenu({ onOpen, onChoose }: Readonly<AlertInsertMenuProps>) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items: ContextMenuItem[] = INSERT_ITEMS.map(({ kind, label }) => ({
    label,
    onClick: () => onChoose(kind),
  }));

  return (
    <>
      <Tooltip content={`Insert: ${INSERT_ITEMS.map((item) => item.label).join(', ')}`}>
        <button
          ref={triggerRef}
          type="button"
          className={`alerts-fmt-btn alerts-fmt-btn--text alerts-insert-trigger${position ? ' active' : ''}`}
          aria-label="Insert"
          aria-haspopup="menu"
          aria-expanded={position !== null}
          {...toolbarActivationProps(() => {
            if (position) return;
            onOpen();
            const rect = triggerRef.current?.getBoundingClientRect();
            setPosition({ x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 });
          })}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span aria-hidden="true">Insert</span>
        </button>
      </Tooltip>
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
