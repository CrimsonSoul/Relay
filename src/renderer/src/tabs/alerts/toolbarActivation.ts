import type React from 'react';

/**
 * Props for a rich-text toolbar button that must work with both the mouse and the keyboard.
 *
 * These buttons preventDefault on mousedown so the contentEditable body keeps its selection
 * while the command runs — but mousedown is never dispatched by keyboard activation, so a
 * mousedown-only button is unreachable with Enter/Space. Wiring click as well is what makes
 * them keyboard operable; a keyboard-generated click reports `detail === 0`, which is how the
 * click handler tells itself apart from the click that follows a real mouse press and would
 * otherwise run the command twice.
 */
export const toolbarActivationProps = (action: () => void) => ({
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    action();
  },
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) action();
  },
});
