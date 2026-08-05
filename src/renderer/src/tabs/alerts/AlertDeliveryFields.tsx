import { ALERT_CLICK_URL_MAX_LENGTH, sanitizeAlertClickUrl } from '../alertLinks';
import { AlertLogoUpload } from './AlertLogoUpload';
import { useAlertDraft } from './AlertDraftContext';

export type AlertDeliveryFieldsProps = Readonly<{
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
              Sender / From Name
            </label>
            <input
              id="alerts-sender"
              type="text"
              className="alerts-input"
              placeholder="e.g. IT"
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
              placeholder="e.g. All Employees"
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
          {normalizedClickThroughUrl && (
            <span className="alerts-click-through-state">LINK READY</span>
          )}
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
            aria-describedby="alerts-click-through-help"
            onChange={(event) => setField('clickThroughUrl', event.target.value)}
            onBlur={() => {
              if (normalizedClickThroughUrl) {
                setField('clickThroughUrl', normalizedClickThroughUrl);
              }
            }}
          />
          <span
            id="alerts-click-through-help"
            className={`alerts-click-through-help${clickThroughUrlInvalid ? ' alerts-click-through-help-error' : ''}`}
          >
            {clickThroughUrlInvalid
              ? 'Enter a valid HTTP or HTTPS address.'
              : 'For LAN destinations without a certificate, include http:// explicitly.'}
          </span>
        </div>
      </div>

      <div className="alerts-delivery-group">
        <span className="alerts-delivery-group-title">Timing</span>
        <div className="alerts-field">
          <span className="alerts-field-label">Update Prefix</span>
          <div className="alerts-update-controls">
            <button
              type="button"
              className={`alerts-update-toggle${updateNumber > 0 ? ' active' : ''}`}
              onClick={() => setField('updateNumber', updateNumber > 0 ? 0 : 1)}
            >
              {updateNumber > 0 ? 'ON' : 'OFF'}
            </button>
            {updateNumber > 0 && (
              <div className="alerts-update-stepper">
                <button
                  type="button"
                  className="alerts-stepper-btn"
                  onClick={() => setField('updateNumber', Math.max(1, updateNumber - 1))}
                >
                  −
                </button>
                <span className="alerts-stepper-value">#{updateNumber}</span>
                <button
                  type="button"
                  className="alerts-stepper-btn"
                  onClick={() => setField('updateNumber', updateNumber + 1)}
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="alerts-field">
          <span className="alerts-field-label">Event Time</span>
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
              <button
                type="button"
                className="alerts-event-time-clear"
                onClick={() => {
                  setField('eventTimeStart', '');
                  setField('eventTimeEnd', '');
                }}
              >
                Clear
              </button>
            )}
          </div>
          <span className="alerts-event-time-hint">Displays as Central Time on card</span>
        </div>
      </div>

      <details className="alerts-delivery-group alerts-branding-details">
        <summary className="alerts-branding-summary">
          <span className="alerts-delivery-group-title">Branding options</span>
          <span className="alerts-branding-summary-hint">Header/footer logos</span>
        </summary>
        <div className="alerts-branding-grid">
          <AlertLogoUpload
            logoDataUrl={logoDataUrl}
            onSetLogo={onSetLogo}
            onRemoveLogo={onRemoveLogo}
          />

          <div className="alerts-field">
            <span className="alerts-field-label">Footer Logo</span>
            <div className="alerts-logo-controls">
              {footerLogoDataUrl ? (
                <>
                  <img
                    src={footerLogoDataUrl}
                    alt="Footer logo"
                    className="alerts-logo-thumbnail"
                  />
                  <button type="button" className="alerts-logo-action" onClick={onRemoveFooterLogo}>
                    REMOVE
                  </button>
                </>
              ) : (
                <button type="button" className="alerts-logo-action" onClick={onSetFooterLogo}>
                  UPLOAD
                </button>
              )}
            </div>
          </div>
        </div>
      </details>
    </>
  );
}
