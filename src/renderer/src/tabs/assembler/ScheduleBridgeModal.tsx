import React, { useState, useEffect, useId } from 'react';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { useToast } from '../../components/Toast';
import { buildBridgeIcs, IcsAttendee } from '../../utils/ics';
import { getOrganizerEmail, setOrganizerEmail } from '../../utils/organizerEmail';

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

type ScheduleBridgeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  attendees: IcsAttendee[];
};

export const ScheduleBridgeModal: React.FC<ScheduleBridgeModalProps> = ({
  isOpen,
  onClose,
  attendees,
}) => {
  const { showToast } = useToast();
  const fieldId = useId();
  const [startValue, setStartValue] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [subject, setSubject] = useState('');
  const [organizerEmail, setOrganizerEmailValue] = useState('');
  const [emailError, setEmailError] = useState('');
  const [subjectError, setSubjectError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form to defaults each time the modal opens
  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      setStartValue(toDateTimeLocalValue(nextHalfHour()));
      setDurationMinutes(60);
      setSubject(`${now.getMonth() + 1}/${now.getDate()} – Bridge`);
      setOrganizerEmailValue(getOrganizerEmail());
      setEmailError('');
      setSubjectError('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(organizerEmail)) {
      setEmailError('Enter a valid email address');
      return;
    }
    setEmailError('');
    if (subject.trim().length === 0) {
      setSubjectError('Enter a subject');
      return;
    }
    setSubjectError('');
    setIsSubmitting(true);
    try {
      setOrganizerEmail(organizerEmail);
      const ics = buildBridgeIcs({
        subject,
        start: new Date(startValue),
        durationMinutes,
        organizerEmail,
        attendees,
      });
      const success = await globalThis.api?.saveAndOpenIcs(ics);
      if (success) {
        showToast('Invite created — review and send in your calendar', 'success');
        onClose();
      } else {
        showToast('Failed to create invite', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Schedule Bridge" width="440px">
      <form onSubmit={handleSubmit}>
        <div className="schedule-bridge-field">
          <label htmlFor={`${fieldId}-start`} className="schedule-bridge-label">
            Date &amp; Time
          </label>
          <input
            id={`${fieldId}-start`}
            type="datetime-local"
            className="tactile-input"
            value={startValue}
            onChange={(e) => setStartValue(e.target.value)}
            required
          />
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
          />
          {subjectError && <div className="schedule-bridge-error">{subjectError}</div>}
        </div>

        <div className="schedule-bridge-field">
          <label htmlFor={`${fieldId}-email`} className="schedule-bridge-label">
            Your Email (Organizer)
          </label>
          <input
            id={`${fieldId}-email`}
            type="text"
            className="tactile-input"
            value={organizerEmail}
            onChange={(e) => setOrganizerEmailValue(e.target.value)}
            placeholder="you@example.com"
          />
          {emailError && <div className="schedule-bridge-error">{emailError}</div>}
        </div>

        <div className="schedule-bridge-actions">
          <TactileButton type="button" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton type="submit" disabled={isSubmitting} variant="primary">
            {isSubmitting ? 'Creating...' : 'Create Invite'}
          </TactileButton>
        </div>
      </form>
    </Modal>
  );
};
