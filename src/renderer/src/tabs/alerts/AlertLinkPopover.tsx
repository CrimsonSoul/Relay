import React, { useEffect, useRef, useState } from 'react';
import { TactileButton } from '../../components/TactileButton';
import { sanitizeAlertClickUrl } from '../alertLinks';

interface AlertLinkPopoverProps {
  initialUrl: string;
  onApply: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Address field for a body link; only HTTP(S) destinations are applied. */
export const AlertLinkPopover: React.FC<AlertLinkPopoverProps> = ({
  initialUrl,
  onApply,
  onRemove,
  onClose,
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState(false);
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
    if (!safeUrl) {
      setError(true);
      return;
    }
    onApply(safeUrl);
  };

  return (
    <div ref={popoverRef} className="alerts-link-popover" data-motion="popover">
      <input
        className={`alerts-input${error ? ' alerts-input-invalid' : ''}`}
        type="url"
        aria-label="Link address"
        aria-invalid={error}
        aria-describedby={error ? 'alerts-link-error' : undefined}
        placeholder="https://"
        value={url}
        autoFocus
        onChange={(event) => {
          setUrl(event.target.value);
          setError(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}
      />
      {error && (
        <p id="alerts-link-error" className="field-error" role="alert">
          Enter an HTTP or HTTPS address
        </p>
      )}
      <div className="alerts-link-popover-actions">
        {initialUrl && (
          <TactileButton variant="ghost" size="sm" onClick={onRemove}>
            Remove Link
          </TactileButton>
        )}
        <TactileButton variant="primary" size="sm" onClick={apply}>
          Apply Link
        </TactileButton>
      </div>
    </div>
  );
};
