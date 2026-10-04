import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_ALERT_RECIPIENT, isAlertMessageComplete } from './alertUtils';
import { sanitizeAlertClickUrl } from './alertLinks';
import { AlertSeveritySelector } from './alerts/AlertSeveritySelector';
import { AlertBodyEditor } from './alerts/AlertBodyEditor';
import { AlertDeliveryFields } from './alerts/AlertDeliveryFields';
import { useAlertDraft } from './alerts/AlertDraftContext';

export type AlertAttentionField = 'severity' | 'subject' | 'body' | 'clickThroughUrl';

export type AlertAttentionRequest = {
  requestId: number;
  field: AlertAttentionField;
};

const ATTENTION_TARGET_IDS: Record<AlertAttentionField, string> = {
  severity: 'alerts-severity',
  subject: 'alerts-subject',
  body: 'alerts-body',
  clickThroughUrl: 'alerts-click-through-url',
};

/** Inbox previews commonly truncate subjects past this length. */
const SUBJECT_PREVIEW_LIMIT = 80;

/**
 * On tall two-pane windows collapsed step 3 is docked to the bottom of the composer; once opened
 * it returns to its place below steps 1–2, so bring its heading to the top instead of letting it
 * drop out of view.
 */
function revealOpenedDelivery(details: HTMLDetailsElement): void {
  if (!details.open) return;
  const summary = details.querySelector('summary');
  const scroller = details.closest('.alerts-composer');
  if (!summary || !scroller) return;
  if (summary.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom) {
    summary.scrollIntoView({ block: 'start' });
  }
}

export interface AlertFormProps {
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
  footerLogoDataUrl: string | null;
  onSetFooterLogo: () => void;
  onRemoveFooterLogo: () => void;
  attentionRequest?: AlertAttentionRequest | null;
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
    severityConfirmed,
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
  const subjectIsLong = subject.length > SUBJECT_PREVIEW_LIMIT;
  const normalizedClickThroughUrl = sanitizeAlertClickUrl(clickThroughUrl);
  const audience = recipient.trim();
  const summaryTokens = [
    (sender.trim() || audience) && 'Routing configured',
    normalizedClickThroughUrl && 'Link ready',
    (updateNumber > 0 || eventTimeStart || eventTimeEnd) && 'Timing configured',
    (logoDataUrl || footerLogoDataUrl) && 'Branding customized',
  ].filter((token): token is string => Boolean(token));

  useEffect(() => {
    if (!attentionRequest || lastAttentionRequestIdRef.current === attentionRequest.requestId) {
      return;
    }

    lastAttentionRequestIdRef.current = attentionRequest.requestId;
    if (attentionRequest.field === 'clickThroughUrl') setDeliveryExpanded(true);
    const targetId = ATTENTION_TARGET_IDS[attentionRequest.field];
    const focusFrame = requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus();
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
                Choose severity
              </h2>
              <p className="alerts-step-description">Sets the card color and icon.</p>
            </div>
            {/* Only completion earns a chip: an incomplete step is named when an export is
                attempted, so a "Required" chip would only nag before then. */}
            {severityConfirmed && (
              <span className="alerts-step-status alerts-step-status-done">Done</span>
            )}
          </div>
          <div className="alerts-step-content">
            <AlertSeveritySelector
              severity={severity}
              confirmed={severityConfirmed}
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
            </div>
            {messageComplete && (
              <span className="alerts-step-status alerts-step-status-done">Done</span>
            )}
          </div>
          <div className="alerts-step-content">
            <div className="alerts-field">
              <div className="alerts-field-label-row">
                <label className="alerts-field-label" htmlFor="alerts-subject">
                  Subject
                </label>
                <span
                  id="alerts-subject-count"
                  className={`alerts-char-count${subjectIsLong ? ' warn' : ''}`}
                >
                  {subject.length}
                  <span className="sr-only"> characters</span>
                </span>
              </div>
              <input
                id="alerts-subject"
                type="text"
                className="alerts-input"
                placeholder="e.g. POS maintenance Sat 2–4 AM"
                spellCheck
                aria-required="true"
                aria-describedby={
                  subjectIsLong
                    ? 'alerts-subject-count alerts-subject-guidance'
                    : 'alerts-subject-count'
                }
                maxLength={10000}
                value={subject}
                onChange={(event) => setField('subject', event.target.value)}
              />
              {subjectIsLong && (
                <p id="alerts-subject-guidance" className="alerts-subject-guidance">
                  Long for inbox previews: subjects over {SUBJECT_PREVIEW_LIMIT} characters may be
                  cut off.
                </p>
              )}
            </div>

            <AlertBodyEditor value={bodyHtml} onChange={(value) => setField('bodyHtml', value)} />
          </div>
        </section>

        <details
          className="alerts-step-section alerts-optional-delivery"
          aria-label="Optional delivery details"
          open={deliveryExpanded}
          onToggle={(event) => {
            setDeliveryExpanded(event.currentTarget.open);
            revealOpenedDelivery(event.currentTarget);
          }}
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
              <p className="alerts-step-audience">
                To: <strong>{audience || DEFAULT_ALERT_RECIPIENT}</strong>
                {audience ? null : ' (default)'}
              </p>
            </div>
            <span className="alerts-optional-summary-state">
              {summaryTokens.map((token) => (
                <span key={token}>{token}</span>
              ))}
            </span>
            <span className="alerts-step-status">Optional</span>
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
