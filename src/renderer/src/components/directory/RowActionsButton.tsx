import { TactileButton } from '../TactileButton';

/** Where a row's actions menu opens: under the left edge of the button that asked for it. */
export interface RowMenuAnchor {
  readonly x: number;
  readonly y: number;
}

interface RowActionsButtonProps {
  /** Record name, read as "Actions for <name>". */
  name: string;
  onOpen: (anchor: RowMenuAnchor) => void;
}

const anchorBelow = (element: Element): RowMenuAnchor => {
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom };
};

/**
 * The visible route to a Contacts or Servers row's context menu. At ≤1024px the detail panel, and
 * with it Add to Bridge / Edit / Delete, is hidden, so CSS shows this `⋯` button only there.
 */
export function RowActionsButton({ name, onOpen }: Readonly<RowActionsButtonProps>) {
  return (
    <div className="directory-row-actions">
      <TactileButton
        variant="ghost"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-keyshortcuts="Shift+F10"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        }
        onClick={(event) => {
          // The list closes an open menu on any window click; this click is the one opening it.
          event.stopPropagation();
          onOpen(anchorBelow(event.currentTarget));
        }}
        onKeyDown={(event) => {
          // The list's own Enter/Space (Add to Bridge) and Shift+F10 answer the focused row,
          // not this button.
          if (event.key === 'F10' && event.shiftKey) {
            event.preventDefault();
            onOpen(anchorBelow(event.currentTarget));
          }
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'F10') {
            event.stopPropagation();
          }
        }}
      />
    </div>
  );
}
