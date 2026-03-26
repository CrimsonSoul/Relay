import React, { useMemo, useRef, useState, useEffect } from 'react';
import { SEVERITY_COLORS, SEVERITY_ICONS, hasVisibleText, sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';
import { EventTimeBanner } from './alerts/EventTimeBanner';

/** Convert an image data URL to grayscale (preserving alpha). */
function makeGrayscale(dataUrl: string): Promise<string> {
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
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i + 1] = data[i + 2] = lum;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

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
  footerLogoDataUrl?: string | null;
  eventTimeStart?: string;
  eventTimeEnd?: string;
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
  footerLogoDataUrl,
  eventTimeStart,
  eventTimeEnd,
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

  const [grayFooterLogoUrl, setGrayFooterLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!footerLogoDataUrl) {
      setGrayFooterLogoUrl(null);
      return;
    }
    void makeGrayscale(footerLogoDataUrl)
      .then(setGrayFooterLogoUrl)
      .catch(() => setGrayFooterLogoUrl(null));
  }, [footerLogoDataUrl]);

  // Always sanitize HTML at the render boundary to prevent XSS
  const safeHtml = useMemo(
    () => (hasContent ? sanitizeHtml(bodyHtml) : 'Your message will appear here...'),
    [bodyHtml, hasContent],
  );

  const metaRef = useRef<HTMLDivElement>(null);
  const [metaFontSize, setMetaFontSize] = useState(13);
  const [metaWrap, setMetaWrap] = useState(false);
  const [metaWidth, setMetaWidth] = useState(0);

  useEffect(() => {
    if (!metaRef.current) return;
    const ro = new ResizeObserver(([entry]) => setMetaWidth(entry.contentRect.width));
    ro.observe(metaRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!metaRef.current || metaWidth === 0) return;
    const el = metaRef.current;
    // Measure off-screen to avoid rendering intermediate sizes
    const probe = el.cloneNode(true) as HTMLDivElement;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.width = `${metaWidth}px`;
    probe.style.pointerEvents = 'none';
    // Force nowrap on probe so scrollWidth detects single-line overflow
    const inner = probe.querySelector('.alerts-email-meta-center') as HTMLDivElement | null;
    if (inner) inner.style.whiteSpace = 'nowrap';
    el.parentElement!.appendChild(probe);
    for (const size of [13, 11, 9.5]) {
      probe.style.fontSize = `${size}px`;
      if (probe.scrollWidth <= probe.clientWidth) {
        el.parentElement!.removeChild(probe);
        setMetaFontSize(size);
        setMetaWrap(false);
        return;
      }
    }
    el.parentElement!.removeChild(probe);
    setMetaFontSize(9.5);
    setMetaWrap(true);
  }, [displaySender, displayRecipient, metaWidth]);

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
          <EventTimeBanner severity={severity} startTime={eventTimeStart} endTime={eventTimeEnd} />
          <div
            className="alerts-email-meta"
            ref={metaRef}
            style={{ fontSize: `${metaFontSize}px`, overflow: metaWrap ? 'visible' : undefined }}
          >
            <div
              className="alerts-email-meta-center"
              style={
                metaWrap
                  ? { whiteSpace: 'normal', flexWrap: 'wrap', justifyContent: 'center' }
                  : undefined
              }
            >
              <div className="alerts-email-meta-item">
                FROM <span>{displaySender}</span>
              </div>
              {!metaWrap && <span className="alerts-email-meta-dot" />}
              <div className="alerts-email-meta-item">
                TO <span>{displayRecipient}</span>
              </div>
            </div>
          </div>
          <div
            className={`alerts-email-body${hasContent ? '' : ' empty'}`}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
          <div className="alerts-email-footer">
            {grayFooterLogoUrl ? (
              <img src={grayFooterLogoUrl} alt="" className="alerts-email-footer-logo" />
            ) : (
              <div className="alerts-email-footer-spacer" />
            )}
            <div className="alerts-email-footer-timestamp">{formattedDate}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
