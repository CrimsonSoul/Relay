import React, { useMemo } from 'react';
import { SEVERITY_COLORS, SEVERITY_ICONS, hasVisibleText, sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';

export interface AlertCardProps {
  cardRef: React.RefObject<HTMLDivElement | null>;
  severity: Severity;
  displaySubject: string;
  displaySender: string;
  displayRecipient: string;
  formattedDate: string;
  bodyHtml: string;
  logoDataUrl: string | null;
}

export const AlertCard: React.FC<AlertCardProps> = ({
  cardRef,
  severity,
  displaySubject,
  displaySender,
  displayRecipient,
  formattedDate,
  bodyHtml,
  logoDataUrl,
}) => {
  const colors = SEVERITY_COLORS[severity];
  const hasContent = hasVisibleText(bodyHtml);
  // Always sanitize HTML at the render boundary to prevent XSS
  const safeHtml = useMemo(
    () => (hasContent ? sanitizeHtml(bodyHtml) : 'Your message will appear here...'),
    [bodyHtml, hasContent],
  );

  return (
    <div className="alerts-preview">
      <div className="alerts-preview-scroll">
        {/* Email Card — captured to PNG */}
        <div
          className="alerts-email-card"
          ref={cardRef}
          style={
            {
              '--email-banner': colors.banner,
              '--email-badge-bg': colors.badgeBg,
              '--email-badge-text': colors.badgeText,
            } as React.CSSProperties
          }
        >
          <div className="alerts-email-severity-header">
            <span className="alerts-email-severity-label">{severity}</span>
          </div>
          <div className="alerts-email-icon-wrapper">
            <div className="alerts-email-icon">{SEVERITY_ICONS[severity]}</div>
          </div>
          <div className="alerts-email-header">
            <div className="alerts-email-subject">{displaySubject}</div>
          </div>
          <div className="alerts-email-meta">
            <div className="alerts-email-meta-item">
              FROM <span>{displaySender}</span>
            </div>
            <div className="alerts-email-meta-item">
              DATE <span>{formattedDate}</span>
            </div>
            <div className="alerts-email-meta-item">
              TO <span>{displayRecipient}</span>
            </div>
          </div>
          <div
            className={`alerts-email-body${hasContent ? '' : ' empty'}`}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
          <div className="alerts-email-footer">
            <span className="alerts-email-footer-severity">{severity}</span>
            {logoDataUrl && <img src={logoDataUrl} alt="" className="alerts-email-logo" />}
          </div>
        </div>
      </div>
    </div>
  );
};
