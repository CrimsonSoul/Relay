import { Tooltip } from '../../components/Tooltip';
import type { AlertBlockKind } from './alertBlocks';
import { toolbarActivationProps } from './toolbarActivation';

type AlertBlockToolbarProps = {
  kind: AlertBlockKind;
  /** Offset of the block's top edge inside the editor frame. */
  top: number;
  stepNumber: number;
  stepCount: number;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
};

const ICON_PROPS = {
  'aria-hidden': true,
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Controls for the guide block holding the caret, floated beside that block. */
export function AlertBlockToolbar({
  kind,
  top,
  stepNumber,
  stepCount,
  onMove,
  onRemove,
}: Readonly<AlertBlockToolbarProps>) {
  const isStep = kind === 'step';
  const removeLabel = isStep ? 'Remove Step' : 'Remove';
  return (
    <div
      className="alerts-block-toolbar"
      role="toolbar"
      aria-label={isStep ? `Step ${stepNumber} Actions` : 'Block Actions'}
      style={{ top }}
    >
      {isStep && (
        <>
          <Tooltip content="Move Up (Ctrl+Alt+Up)">
            <button
              type="button"
              className="alerts-fmt-btn"
              aria-label="Move Up"
              aria-keyshortcuts="Control+Alt+ArrowUp"
              disabled={stepNumber <= 1}
              {...toolbarActivationProps(() => onMove('up'))}
            >
              <svg {...ICON_PROPS}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip content="Move Down (Ctrl+Alt+Down)">
            <button
              type="button"
              className="alerts-fmt-btn"
              aria-label="Move Down"
              aria-keyshortcuts="Control+Alt+ArrowDown"
              disabled={stepNumber >= stepCount}
              {...toolbarActivationProps(() => onMove('down'))}
            >
              <svg {...ICON_PROPS}>
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          </Tooltip>
        </>
      )}
      <Tooltip content={removeLabel}>
        <button
          type="button"
          className="alerts-fmt-btn"
          aria-label={removeLabel}
          {...toolbarActivationProps(onRemove)}
        >
          <svg {...ICON_PROPS}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}
