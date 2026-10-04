import type { ReactNode } from 'react';
import './tickets.css';

/** A ticket workflow message. Errors include uncertain live-write results. */
export type SdpNotice = Readonly<{ tone: 'error' | 'info'; text: string }>;

export const sdpInfo = (text: string): SdpNotice => ({ tone: 'info', text });
export const sdpError = (text: string): SdpNotice => ({ tone: 'error', text });

/**
 * One shape for every ticket workflow message so the sites cannot drift. An error (including an
 * uncertain result) mounts with the problem as `role="alert"`: `.field-error` beside a control, or
 * the alarm-rail `.panel-error` at dialog or panel level, followed by an optional `action`
 * (Try Again). Info copy goes through a persistent `<output>` that stays mounted (empty when
 * idle) so a changed message is announced.
 */
export function SdpMessage({
  message,
  placement = 'panel',
  action,
}: Readonly<{ message?: SdpNotice; placement?: 'panel' | 'field'; action?: ReactNode }>) {
  const error = message?.tone === 'error' ? message.text : '';
  const info = message?.tone === 'info' ? message.text : '';
  const errorClass = placement === 'field' ? 'field-error' : 'panel-error ink-rail ink-rail--alarm';
  return (
    <>
      {error && (
        <div className={errorClass} role="alert">
          <span>{error}</span>
          {action}
        </div>
      )}
      <p className="ticket-mode-note sdp-message">
        <output>{info}</output>
      </p>
    </>
  );
}
