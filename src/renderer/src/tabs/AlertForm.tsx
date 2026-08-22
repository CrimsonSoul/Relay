import React, { useEffect, useRef, useState } from 'react';
import { isAlertMessageComplete } from './alertUtils';
import { sanitizeAlertClickUrl } from './alertLinks';
import { AlertSeveritySelector } from './alerts/AlertSeveritySelector';
import { AlertBodyEditor } from './alerts/AlertBodyEditor';
import { AlertDeliveryFields } from './alerts/AlertDeliveryFields';
import { useAlertDraft } from './alerts/AlertDraftContext';

export type AlertOptionalField = 'clickThroughUrl';

export type AlertOptionalAttentionRequest = {
  requestId: number;
  field: AlertOptionalField;
};

export interface AlertFormProps {
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
  footerLogoDataUrl: string | null;
  onSetFooterLogo: () => void;
  onRemoveFooterLogo: () => void;
  attentionRequest?: AlertOptionalAttentionRequest | null;
}

export const AlertForm: React.FC<AlertFormProps> = ({
  logoDataUrl,
  onSetLogo,
  onRemoveLogo,
  footerLogoDataUrl,
  onSetFooterLogo,
  onRemoveFooterLogo,
  attentionRequest = null,
}) => {
  const { state, setField } = useAlertDraft();
  const {
    severity,
    subject,
    bodyHtml,
    sender,
    recipient,
    clickThroughUrl,
    updateNumber,
    eventTimeStart,
    eventTimeEnd,
  } = state;
  const [deliveryExpanded, setDeliveryExpanded] = useState(false);
  const lastAttentionRequestIdRef = useRef<number | null>(null);
  const messageComplete = isAlertMessageComplete(subject, bodyHtml);
  const normalizedClickThroughUrl = sanitizeAlertClickUrl(clickThroughUrl);
  const summaryTokens = [
    (sender.trim() || recipient.trim()) && 'Routing configured',
    normalizedClickThroughUrl && 'Link ready',
    (updateNumber > 0 || eventTimeStart || eventTimeEnd) && 'Timing configured',
    (logoDataUrl || footerLogoDataUrl) && 'Branding customized',
  ].filter((token): token is string => Boolean(token));

  useEffect(() => {
    if (!attentionRequest || lastAttentionRequestIdRef.current === attentionRequest.requestId) {
      return;
    }

    lastAttentionRequestIdRef.current = attentionRequest.requestId;
    if (attentionRequest.field !== 'clickThroughUrl') return;

    setDeliveryExpanded(true);
    const focusFrame = requestAnimationFrame(() => {
      document.getElementById('alerts-click-through-url')?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [attentionRequest]);

  return (
    <div className="alerts-composer">
      <div className="alerts-form-section">
        <section className="alerts-step-section" aria-labelledby="alerts-step-posture-title">
          <div className="alerts-step-header">
            <span className="alerts-step-index" aria-hidden="true">
              1
            </span>
            <div className="alerts-step-copy">
              <h2 className="alerts-step-title" id="alerts-step-posture-title">
                Set alert posture
              </h2>
              <p className="alerts-step-description">Card tone and icon.</p>
            </div>
            <span className="alerts-step-status alerts-step-status-done">DONE</span>
          </div>
          <div className="alerts-step-content">
            <AlertSeveritySelector
              severity={severity}
              setSeverity={(value) => setField('severity', value)}
            />
          </div>
        </section>

        <section className="alerts-step-section" aria-labelledby="alerts-step-message-title">
          <div className="alerts-step-header">
            <span className="alerts-step-index" aria-hidden="true">
              2
            </span>
            <div className="alerts-step-copy">
              <h2 className="alerts-step-title" id="alerts-step-message-title">
                Write the message
              </h2>
              <p className="alerts-step-description">Subject and body.</p>
            </div>
            <span
              className={`alerts-step-status${messageComplete ? ' alerts-step-status-done' : ''}`}
            >
              {messageComplete ? 'DONE' : 'ACTIVE'}
            </span>
          </div>
          <div className="alerts-step-content">
            <div className="alerts-field">
              <label className="alerts-field-label" htmlFor="alerts-subject">
                Subject{' '}
                <span className={`alerts-char-count${subject.length > 80 ? ' warn' : ''}`}>
                  {subject.length}
                </span>
              </label>
              <input
                id="alerts-subject"
                type="text"
                className="alerts-input"
                placeholder="e.g. Planned Maintenance — POS Systems Saturday 2AM–4AM CT"
                spellCheck
                maxLength={10000}
                value={subject}
                onChange={(event) => setField('subject', event.target.value)}
              />
            </div>

            <AlertBodyEditor value={bodyHtml} onChange={(value) => setField('bodyHtml', value)} />
          </div>
        </section>

        <details
          className="alerts-step-section alerts-optional-delivery"
          aria-label="Optional delivery details"
          open={deliveryExpanded}
          onToggle={(event) => setDeliveryExpanded(event.currentTarget.open)}
        >
          <summary className="alerts-step-header alerts-optional-delivery-summary">
            <span className="alerts-step-index" aria-hidden="true">
              3
            </span>
            <div className="alerts-step-copy">
              <h2 className="alerts-step-title" id="alerts-step-delivery-title">
                Add delivery details
              </h2>
              <p className="alerts-step-description">Routing, timing, and updates.</p>
            </div>
            <span className="alerts-optional-summary-state">
              {summaryTokens.map((token) => (
                <span key={token}>{token}</span>
              ))}
            </span>
            <span className="alerts-step-status">OPTIONAL</span>
          </summary>
          <div className="alerts-step-content">
            <AlertDeliveryFields
              logoDataUrl={logoDataUrl}
              onSetLogo={onSetLogo}
              onRemoveLogo={onRemoveLogo}
              footerLogoDataUrl={footerLogoDataUrl}
              onSetFooterLogo={onSetFooterLogo}
              onRemoveFooterLogo={onRemoveFooterLogo}
            />
          </div>
        </details>
      </div>
    </div>
  );
};
