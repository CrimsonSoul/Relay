import React, { useMemo, useRef, useState, useEffect } from 'react';
import { SEVERITY_COLORS, SEVERITY_ICONS, hasVisibleText, sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';

/** Convert an image data URL to an all-white version (preserving alpha). */
function makeWhite(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;
      for (let i = 0; i < data.length; i += 4) {
        // Set RGB to white, keep alpha unchanged
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export interface AlertCardProps {
  cardRef: React.RefObject<HTMLDivElement | null>;
  severity: Severity;
  displaySubject: string;
  displaySender: string;
  displayRecipient: string;
  formattedDate: string;
  bodyHtml: string;
  logoDataUrl: string | null;
  /** When true, bodyHtml has been processed by compact+enhance pipeline */
  enhancedBodyHtml?: string;
  isEnhanced?: boolean;
  isCompact?: boolean;
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
  enhancedBodyHtml,
  isEnhanced,
  isCompact,
}) => {
  const colors = SEVERITY_COLORS[severity];
  const hasContent = hasVisibleText(bodyHtml);

  const [whiteLogoUrl, setWhiteLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logoDataUrl) {
      setWhiteLogoUrl(null);
      return;
    }
    void makeWhite(logoDataUrl)
      .then(setWhiteLogoUrl)
      .catch(() => setWhiteLogoUrl(null));
  }, [logoDataUrl]);

  // Always sanitize HTML at the render boundary to prevent XSS
  const safeHtml = useMemo(
    () => (hasContent ? sanitizeHtml(bodyHtml) : 'Your message will appear here...'),
    [bodyHtml, hasContent],
  );

  const metaRef = useRef<HTMLDivElement>(null);
  const [metaFontSize, setMetaFontSize] = useState(13);

  useEffect(() => {
    if (!metaRef.current) return;
    const el = metaRef.current;
    // Reset to base size to measure natural width
    el.style.fontSize = '13px';
    const overflow = el.scrollWidth > el.clientWidth;
    if (!overflow) {
      setMetaFontSize(13);
      return;
    }
    // Try smaller sizes
    for (const size of [11, 9.5]) {
      el.style.fontSize = `${size}px`;
      if (el.scrollWidth <= el.clientWidth) {
        setMetaFontSize(size);
        return;
      }
    }
    setMetaFontSize(9.5);
  }, [displaySender, displayRecipient]);

  const renderedBody = (isEnhanced || isCompact) && enhancedBodyHtml ? enhancedBodyHtml : safeHtml;

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
          <div className="alerts-email-severity-header" style={{ background: colors.banner }}>
            <div className="alerts-email-severity-block">
              <span className="alerts-email-severity-prefix">ALERT</span>
              <span className="alerts-email-severity-label">{severity}</span>
            </div>
            {whiteLogoUrl && <img src={whiteLogoUrl} alt="" className="alerts-email-header-logo" />}
          </div>
          <div className="alerts-email-icon-wrapper">
            <div className="alerts-email-icon">{SEVERITY_ICONS[severity]}</div>
          </div>
          <div className="alerts-email-header">
            <div className="alerts-email-subject">{displaySubject}</div>
          </div>
          <div
            className="alerts-email-meta"
            ref={metaRef}
            style={{ fontSize: `${metaFontSize}px` }}
          >
            <div className="alerts-email-meta-center">
              <div className="alerts-email-meta-item">
                FROM <span>{displaySender}</span>
              </div>
              <span className="alerts-email-meta-dot" />
              <div className="alerts-email-meta-item">
                TO <span>{displayRecipient}</span>
              </div>
            </div>
          </div>
          <div
            className={`alerts-email-body${hasContent ? '' : ' empty'}`}
            dangerouslySetInnerHTML={{ __html: renderedBody }}
          />
          <div className="alerts-email-footer">
            {/* Footer logo added in Task 10 — spacer placeholder for now */}
            <div className="alerts-email-footer-spacer" />
            <div className="alerts-email-footer-timestamp">{formattedDate}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
