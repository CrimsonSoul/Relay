import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { usePresence } from '../hooks/usePresence';
import { useModalStack } from './modalStack';
import { Tooltip } from './Tooltip';

export type ModalVariant = 'confirmation' | 'standard' | 'wide' | 'large';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  tabs?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: ModalVariant;
  width?: string;
  bodyClassName?: string;
  /** When true, renders only the portal/overlay/dialog shell. Children control all interior content. */
  bare?: boolean;
  /** Override the overlay CSS class (default: 'modal-overlay-generic') */
  overlayClassName?: string;
  /** Override the dialog CSS class (default: 'modal-dialog-generic') */
  dialogClassName?: string;
  /** Extra props spread onto the <dialog> element (e.g. data-entity-id). */
  dialogProps?: React.HTMLAttributes<HTMLDialogElement>;
  /** When false, removes close affordances and ignores Escape while work is pending. */
  dismissible?: boolean;
};

type Presentation = Pick<
  Props,
  | 'children'
  | 'title'
  | 'subtitle'
  | 'headerActions'
  | 'tabs'
  | 'footer'
  | 'variant'
  | 'width'
  | 'bodyClassName'
  | 'bare'
  | 'overlayClassName'
  | 'dialogClassName'
  | 'dialogProps'
  | 'dismissible'
>;

export const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  children,
  title,
  subtitle,
  headerActions,
  tabs,
  footer,
  variant = 'standard',
  width,
  bodyClassName,
  bare = false,
  overlayClassName = 'modal-overlay-generic',
  dialogClassName = 'modal-dialog-generic',
  dialogProps,
  dismissible = true,
}) => {
  const titleId = useId();
  const stackId = useId();
  const { isMounted, state } = usePresence(isOpen);
  const isTopModal = useModalStack(stackId, isMounted);
  const presentationRef = useRef<Presentation>({
    children,
    title,
    subtitle,
    headerActions,
    tabs,
    footer,
    variant,
    width,
    bodyClassName,
    bare,
    overlayClassName,
    dialogClassName,
    dialogProps,
    dismissible,
  });

  if (isOpen) {
    presentationRef.current = {
      children,
      title,
      subtitle,
      headerActions,
      tabs,
      footer,
      variant,
      width,
      bodyClassName,
      bare,
      overlayClassName,
      dialogClassName,
      dialogProps,
      dismissible,
    };
  }

  const presentation = presentationRef.current;
  const interactive = isOpen && state !== 'closing' && isTopModal;
  const focusTrapRef = useFocusTrap<HTMLDialogElement>(interactive, {
    restoreOnDeactivate: false,
    restoreWhen: !isMounted,
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (presentation.dismissible) onClose();
    },
    [onClose, presentation.dismissible],
  );

  useEffect(() => {
    if (!interactive) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, interactive]);

  if (!isMounted) return null;

  const hasHeader = Boolean(
    presentation.title ||
    presentation.subtitle ||
    presentation.headerActions ||
    presentation.dismissible,
  );
  const bodyClasses = ['modal-body-generic', presentation.bodyClassName].filter(Boolean).join(' ');
  const {
    className: extraDialogClass = '',
    style: retainedDialogStyle,
    ...restDialogProps
  } = presentation.dialogProps ?? {};
  const dialogClasses = [presentation.dialogClassName, extraDialogClass].filter(Boolean).join(' ');
  const dialogStyle = presentation.width
    ? { ...retainedDialogStyle, width: presentation.width }
    : retainedDialogStyle;
  let labelledBy = restDialogProps['aria-labelledby'];
  if (!presentation.bare && presentation.title) labelledBy = titleId;

  return createPortal(
    <div className={presentation.overlayClassName} data-state={state} data-modal-layer>
      {interactive && presentation.dismissible ? (
        <button
          type="button"
          className="overlay-hitbox"
          aria-label="Close modal backdrop"
          onClick={onClose}
          tabIndex={-1}
        />
      ) : (
        <div className="overlay-hitbox" aria-hidden="true" />
      )}
      <dialog
        {...restDialogProps}
        open
        ref={focusTrapRef}
        className={dialogClasses}
        style={dialogStyle}
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-state={state}
        data-variant={presentation.variant}
        data-bare={presentation.bare ? 'true' : 'false'}
        inert={interactive ? undefined : true}
      >
        {presentation.bare ? (
          presentation.children
        ) : (
          <>
            {hasHeader && (
              <header className="modal-header-generic">
                <div className="modal-heading-generic">
                  {presentation.title && (
                    <h2 id={titleId} className="modal-title-generic">
                      {presentation.title}
                    </h2>
                  )}
                  {presentation.subtitle && (
                    <div className="modal-subtitle-generic">{presentation.subtitle}</div>
                  )}
                </div>
                {(presentation.headerActions || presentation.dismissible) && (
                  <div className="modal-header-actions-generic">
                    {presentation.headerActions}
                    {presentation.dismissible && (
                      <Tooltip content="Close" position="left">
                        <button
                          type="button"
                          onClick={onClose}
                          className="modal-close-generic"
                          aria-label="Close"
                          disabled={!interactive}
                        >
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </Tooltip>
                    )}
                  </div>
                )}
              </header>
            )}
            {presentation.tabs && <div className="modal-tabs-generic">{presentation.tabs}</div>}
            <div className={bodyClasses}>{presentation.children}</div>
            {presentation.footer && (
              <footer className="modal-footer-generic">{presentation.footer}</footer>
            )}
          </>
        )}
      </dialog>
    </div>,
    document.body,
  );
};
