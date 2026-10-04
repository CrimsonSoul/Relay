import { TactileButton } from '../../components/TactileButton';
import { ALERT_CLICK_URL_MAX_LENGTH, sanitizeAlertClickUrl } from '../alertLinks';
import { DEFAULT_ALERT_RECIPIENT } from '../alertUtils';
import { AlertLogoUpload } from './AlertLogoUpload';
import { useAlertDraft } from './AlertDraftContext';

type AlertDeliveryFieldsProps = Readonly<{
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
  footerLogoDataUrl: string | null;
  onSetFooterLogo: () => void;
  onRemoveFooterLogo: () => void;
}>;

export function AlertDeliveryFields({
  logoDataUrl,
  onSetLogo,
  onRemoveLogo,
  footerLogoDataUrl,
  onSetFooterLogo,
  onRemoveFooterLogo,
}: AlertDeliveryFieldsProps) {
  const { state, setField } = useAlertDraft();
  const {
    sender,
    recipient,
    clickThroughUrl,
    updateNumber,
    eventTimeStart,
    eventTimeEnd,
    eventTimeSourceTz,
  } = state;
  const normalizedClickThroughUrl = sanitizeAlertClickUrl(clickThroughUrl);
  const hasClickThroughUrl = clickThroughUrl.trim().length > 0;
  const clickThroughUrlInvalid = hasClickThroughUrl && !normalizedClickThroughUrl;

  return (
    <>
      <div className="alerts-delivery-group">
        <span className="alerts-delivery-group-title">Routing</span>
        <div className="alerts-delivery-grid">
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-sender">
              Sender / From name
            </label>
            <input
              id="alerts-sender"
              type="text"
              className="alerts-input"
              placeholder="Defaults to IT"
              maxLength={10000}
              value={sender}
              onChange={(event) => setField('sender', event.target.value)}
            />
          </div>

          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-recipient">
              To / Recipient
            </label>
            <input
              id="alerts-recipient"
              type="text"
              className="alerts-input"
              placeholder={`Defaults to ${DEFAULT_ALERT_RECIPIENT}`}
              maxLength={10000}
              value={recipient}
              onChange={(event) => setField('recipient', event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="alerts-delivery-group alerts-click-through-group">
        <div className="alerts-click-through-heading">
          <span className="alerts-delivery-group-title">Outlook action</span>
          {normalizedClickThroughUrl && <span className="alerts-click-through-state">Ready</span>}
        </div>
        <p className="alerts-click-through-copy">
          Optional. Make the entire alert image open one URL in the Outlook draft. Copied PNGs
          remain image-only.
        </p>
        <div className="alerts-field">
          <label className="alerts-field-label" htmlFor="alerts-click-through-url">
            Clickable image URL
          </label>
          <input
            id="alerts-click-through-url"
            type="url"
            className={`alerts-input${clickThroughUrlInvalid ? ' alerts-input-invalid' : ''}`}
            placeholder="https://status.example.com/incident"
            maxLength={ALERT_CLICK_URL_MAX_LENGTH}
            value={clickThroughUrl}
            aria-invalid={clickThroughUrlInvalid}
            aria-describedby={
              clickThroughUrlInvalid ? 'alerts-click-through-error' : 'alerts-click-through-help'
            }
            onChange={(event) => setField('clickThroughUrl', event.target.value)}
            onBlur={() => {
              if (normalizedClickThroughUrl) {
                setField('clickThroughUrl', normalizedClickThroughUrl);
              }
            }}
          />
          {clickThroughUrlInvalid ? (
            <p id="alerts-click-through-error" className="field-error" role="alert">
              Enter a valid HTTP or HTTPS address.
            </p>
          ) : (
            <span id="alerts-click-through-help" className="alerts-click-through-help">
              For LAN destinations without a certificate, include http:// explicitly.
            </span>
          )}
        </div>
      </div>

      <div className="alerts-delivery-group">
        <span className="alerts-delivery-group-title">Timing</span>
        <div className="alerts-field">
          <div className="alerts-update-controls">
            {/* The switch's visible text is its name (WCAG 2.5.3); the On/Off word is the state,
                which aria-checked already announces. */}
            <button
              type="button"
              role="switch"
              aria-checked={updateNumber > 0}
              className={`alerts-update-toggle${updateNumber > 0 ? ' active' : ''}`}
              onClick={() => setField('updateNumber', updateNumber > 0 ? 0 : 1)}
            >
              Update prefix{' '}
              <span className="alerts-update-toggle-state" aria-hidden="true">
                {updateNumber > 0 ? 'On' : 'Off'}
              </span>
            </button>
            {updateNumber > 0 && (
              <div className="alerts-update-stepper">
                {/* Update numbers start at 1: '−' rests disabled there, as the board font-size
                    stepper does at its minimum. Switching the prefix off is the way to zero. */}
                <button
                  type="button"
                  className="alerts-stepper-btn"
                  aria-label="Previous update number"
                  disabled={updateNumber <= 1}
                  onClick={() => setField('updateNumber', Math.max(1, updateNumber - 1))}
                >
                  −
                </button>
                {/* Atomic, with its own context, so a step is heard whole as "Update #3". */}
                <span className="alerts-stepper-value" aria-live="polite" aria-atomic="true">
                  <span className="sr-only">Update </span>#{updateNumber}
                </span>
                <button
                  type="button"
                  className="alerts-stepper-btn"
                  aria-label="Next update number"
                  onClick={() => setField('updateNumber', updateNumber + 1)}
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        <div // NOSONAR - labelled ARIA group; <fieldset> would add form-control semantics.
          className="alerts-field"
          role="group"
          aria-labelledby="alerts-event-time-label"
        >
          <span className="alerts-field-label" id="alerts-event-time-label">
            Event time
          </span>
          <div className="alerts-event-time-inputs">
            <div className="alerts-event-time-input-group">
              <label className="alerts-event-time-sublabel" htmlFor="alerts-event-time-start">
                Start
              </label>
              <input
                id="alerts-event-time-start"
                type="datetime-local"
                className="alerts-input alerts-input-datetime"
                value={eventTimeStart}
                onChange={(event) => setField('eventTimeStart', event.target.value)}
              />
            </div>
            <div className="alerts-event-time-input-group">
              <label className="alerts-event-time-sublabel" htmlFor="alerts-event-time-end">
                End
              </label>
              <input
                id="alerts-event-time-end"
                type="datetime-local"
                className="alerts-input alerts-input-datetime"
                value={eventTimeEnd}
                onChange={(event) => setField('eventTimeEnd', event.target.value)}
              />
            </div>
            <div className="alerts-event-time-input-group">
              <label className="alerts-event-time-sublabel" htmlFor="alerts-event-time-tz">
                Source TZ
              </label>
              <select
                id="alerts-event-time-tz"
                className="alerts-input alerts-event-time-tz"
                value={eventTimeSourceTz}
                onChange={(event) => setField('eventTimeSourceTz', event.target.value)}
              >
                <option value="America/Chicago">CT (CST/CDT)</option>
                <option value="America/New_York">ET (EST/EDT)</option>
                <option value="America/Denver">MT (MST/MDT)</option>
                <option value="America/Los_Angeles">PT (PST/PDT)</option>
                <option value="UTC">UTC</option>
                <option value="Europe/London">GMT/BST</option>
                <option value="Europe/Berlin">CET/CEST</option>
                <option value="Asia/Tokyo">JST</option>
                <option value="Asia/Kolkata">IST</option>
                <option value="Australia/Sydney">AEST/AEDT</option>
              </select>
            </div>
            {(eventTimeStart || eventTimeEnd) && (
              <TactileButton
                size="xs"
                className="alerts-event-time-clear"
                onClick={() => {
                  setField('eventTimeStart', '');
                  setField('eventTimeEnd', '');
                }}
              >
                Clear
              </TactileButton>
            )}
          </div>
          <span className="alerts-event-time-hint">
            Enter times in the source time zone; the card shows them in Central Time.
          </span>
        </div>
      </div>

      <details className="alerts-delivery-group alerts-branding-details">
        <summary className="alerts-branding-summary">
          <span className="alerts-delivery-group-title">Branding options</span>
          <span className="alerts-branding-summary-hint">Header/footer logos</span>
        </summary>
        <div className="alerts-branding-grid">
          <AlertLogoUpload
            label="Company logo"
            logoDataUrl={logoDataUrl}
            onSetLogo={onSetLogo}
            onRemoveLogo={onRemoveLogo}
          />

          <AlertLogoUpload
            label="Footer logo"
            logoDataUrl={footerLogoDataUrl}
            onSetLogo={onSetFooterLogo}
            onRemoveLogo={onRemoveFooterLogo}
          />
        </div>
      </details>
    </>
  );
}
