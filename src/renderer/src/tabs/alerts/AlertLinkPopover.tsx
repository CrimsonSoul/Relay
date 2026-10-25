import React, { useEffect, useRef, useState } from 'react';
import { TactileButton } from '../../components/TactileButton';
import { sanitizeAlertClickUrl } from '../alertLinks';
import { buttonLabelError } from './alertBlocks';

interface AlertLinkPopoverProps {
  initialUrl: string;
  /** Present for a Button Link: adds a required label field and applies with the label. */
  labelMode?: { initialLabel: string };
  onApply: (url: string, label?: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Address field for a body link; only HTTP(S) destinations are applied. */
export const AlertLinkPopover: React.FC<AlertLinkPopoverProps> = ({
  initialUrl,
  labelMode,
  onApply,
  onRemove,
  onClose,
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState(false);
  const [label, setLabel] = useState(labelMode?.initialLabel ?? '');
  const [labelError, setLabelError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const apply = () => {
    const safeUrl = sanitizeAlertClickUrl(url);
    const nextLabelError = labelMode ? buttonLabelError(label) : null;
    setError(!safeUrl);
    setLabelError(nextLabelError);
    if (!safeUrl || nextLabelError) return;
    if (labelMode) onApply(safeUrl, label.trim());
    else onApply(safeUrl);
  };

  const handleFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  };

  return (
    <div ref={popoverRef} className="alerts-link-popover" data-motion="popover">
      {labelMode && (
        <>
          <input
            className={`alerts-input${labelError ? ' alerts-input-invalid' : ''}`}
            type="text"
            aria-label="Button label"
            aria-invalid={labelError !== null}
            aria-describedby={labelError ? 'alerts-link-label-error' : undefined}
            placeholder="Button label"
            value={label}
            autoFocus
            onChange={(event) => {
              setLabel(event.target.value);
              setLabelError(null);
            }}
            onKeyDown={handleFieldKeyDown}
          />
          {labelError && (
            <p id="alerts-link-label-error" className="field-error" role="alert">
              {labelError}
            </p>
          )}
        </>
      )}
      <input
        className={`alerts-input${error ? ' alerts-input-invalid' : ''}`}
        type="url"
        aria-label="Link address"
        aria-invalid={error}
        aria-describedby={error ? 'alerts-link-error' : undefined}
        placeholder="https://"
        value={url}
        autoFocus={!labelMode}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(false);
        }}
        onKeyDown={handleFieldKeyDown}
      />
      {error && (
        <p id="alerts-link-error" className="field-error" role="alert">
          Enter an HTTP or HTTPS address
        </p>
      )}
      <div className="alerts-link-popover-actions">
        {initialUrl && !labelMode && (
          <TactileButton variant="ghost" size="sm" onClick={onRemove}>
            Remove Link
          </TactileButton>
        )}
        <TactileButton variant="primary" size="sm" onClick={apply}>
          {labelMode ? 'Insert Button' : 'Apply Link'}
        </TactileButton>
      </div>
    </div>
  );
};
