import React, { useState, useEffect, useId } from 'react';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { useToast } from '../../components/Toast';
import { formatFailure } from '../../utils/failureMessage';
import { buildBridgeIcs, IcsAttendee } from '../../utils/ics';
import {
  getOrganizerEmail,
  setOrganizerEmail as persistOrganizerEmail,
} from '../../utils/organizerEmail';
import { getRelayRuntime } from '../../runtime/relayRuntime';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const DURATION_OPTIONS = [30, 60, 90, 120];

/** Next half-hour boundary after now, e.g. 10:12 -> 10:30, 10:42 -> 11:00. */
function nextHalfHour(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60);
  return date;
}

/** Formats a date as a datetime-local input value (local time, minute precision). */
function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Failure copy for an invite the OS calendar (desktop) or browser download (web) didn't take. */
function inviteFailure(isWebRuntime: boolean, error?: unknown): string {
  if (isWebRuntime) {
    return formatFailure({
      what: "Couldn't download the bridge invite",
      error,
      outcome: 'Your entries are still in the form.',
      next: 'Allow downloads from Relay in your browser, then select Create Invite again.',
    });
  }
  return formatFailure({
    what: "Couldn't open the bridge invite in your calendar",
    error,
    outcome: 'Your entries are still in the form.',
    next: 'Check that a calendar app is set to open .ics files, then select Create Invite again.',
  });
}

type ScheduleBridgeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  attendees: IcsAttendee[];
  /** Ticket-derived subject; falls back to a dated "Bridge" subject when absent. */
  defaultSubject?: string;
};

export const ScheduleBridgeModal: React.FC<ScheduleBridgeModalProps> = ({
  isOpen,
  onClose,
  attendees,
  defaultSubject,
}) => {
  const { showToast } = useToast();
  const isWebRuntime = getRelayRuntime().kind === 'web';
  const fieldId = useId();
  const [startValue, setStartValue] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [subject, setSubject] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');
  const [startError, setStartError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [subjectError, setSubjectError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form to defaults each time the modal opens
  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      setStartValue(toDateTimeLocalValue(nextHalfHour()));
      setDurationMinutes(60);
      setSubject(defaultSubject?.trim() || `${now.getMonth() + 1}/${now.getDate()} – Bridge`);
      setOrganizerEmail(getOrganizerEmail());
      setStartError('');
      setEmailError('');
      setSubjectError('');
      setIsSubmitting(false);
    }
  }, [isOpen, defaultSubject]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    // Validate every field in form order, show each message on its field, and focus the first
    // invalid one.
    const nextStartError =
      !startValue || Number.isNaN(new Date(startValue).getTime()) ? 'Choose a date and time' : '';
    const nextSubjectError = subject.trim().length === 0 ? 'Enter a subject' : '';
    const nextEmailError = EMAIL_PATTERN.test(organizerEmail) ? '' : 'Enter a valid email address';
    setStartError(nextStartError);
    setSubjectError(nextSubjectError);
    setEmailError(nextEmailError);
    const firstInvalid = [
      [nextStartError, 'start'],
      [nextSubjectError, 'subject'],
      [nextEmailError, 'email'],
    ].find(([message]) => message)?.[1];
    if (firstInvalid) {
      document.getElementById(`${fieldId}-${firstInvalid}`)?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      persistOrganizerEmail(organizerEmail);
      const ics = buildBridgeIcs({
        subject,
        start: new Date(startValue),
        durationMinutes,
        organizerEmail,
        attendees,
      });
      const success = await globalThis.api?.saveAndOpenIcs(ics);
      if (success) {
        showToast(
          isWebRuntime
            ? 'relay-schedule.ics download started — open it in your calendar, review attendees, and send.'
            : 'Invite created — review and send in your calendar',
          'success',
        );
        onClose();
      } else {
        showToast(inviteFailure(isWebRuntime), 'error');
      }
    } catch (error) {
      // A rejected saveAndOpenIcs (denied file write, no calendar handler) otherwise
      // becomes an unhandled rejection: the spinner clears and the operator sees
      // nothing. Report it the same way the falsy-result branch above does.
      showToast(inviteFailure(isWebRuntime, error), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule bridge"
      variant="standard"
      footer={
        <>
          <TactileButton type="button" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton
            type="submit"
            form={`${fieldId}-form`}
            loading={isSubmitting}
            variant="primary"
          >
            {isSubmitting ? 'Creating…' : 'Create Invite'}
          </TactileButton>
        </>
      }
    >
      <form
        id={`${fieldId}-form`}
        className="schedule-bridge-form"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="schedule-bridge-field">
          <label htmlFor={`${fieldId}-start`} className="schedule-bridge-label">
            Date &amp; time
          </label>
          <input
            id={`${fieldId}-start`}
            type="datetime-local"
            className="tactile-input"
            value={startValue}
            onChange={(e) => setStartValue(e.target.value)}
            required
            aria-invalid={startError ? true : undefined}
            aria-describedby={startError ? `${fieldId}-start-error` : undefined}
          />
          {startError && (
            <div
              id={`${fieldId}-start-error`}
              className="schedule-bridge-error field-error"
              role="alert"
            >
              {startError}
            </div>
          )}
        </div>

        <div className="schedule-bridge-field">
          <label htmlFor={`${fieldId}-duration`} className="schedule-bridge-label">
            Duration
          </label>
          <select
            id={`${fieldId}-duration`}
            className="schedule-bridge-select"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
          >
            {DURATION_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </select>
        </div>

        <div className="schedule-bridge-field">
          <label htmlFor={`${fieldId}-subject`} className="schedule-bridge-label">
            Subject
          </label>
          <input
            id={`${fieldId}-subject`}
            type="text"
            className="tactile-input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-required="true"
            aria-invalid={subjectError ? true : undefined}
            aria-describedby={subjectError ? `${fieldId}-subject-error` : undefined}
          />
          {subjectError && (
            <div
              id={`${fieldId}-subject-error`}
              className="schedule-bridge-error field-error"
              role="alert"
            >
              {subjectError}
            </div>
          )}
        </div>

        <div className="schedule-bridge-field">
          <label htmlFor={`${fieldId}-email`} className="schedule-bridge-label">
            Your email (organizer)
          </label>
          <input
            id={`${fieldId}-email`}
            type="email"
            autoComplete="email"
            className="tactile-input"
            value={organizerEmail}
            onChange={(e) => setOrganizerEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${fieldId}-email-error` : undefined}
          />
          {emailError && (
            <div
              id={`${fieldId}-email-error`}
              className="schedule-bridge-error field-error"
              role="alert"
            >
              {emailError}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
};
