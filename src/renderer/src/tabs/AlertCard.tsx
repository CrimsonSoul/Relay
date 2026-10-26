import React, { useMemo, useRef, useState, useEffect } from 'react';
import { HIGHLIGHT_STYLE_VARS } from './alerts/highlightColors';
import {
  SEVERITY_COLORS,
  SEVERITY_ICONS,
  UNCONFIRMED_SEVERITY_COLORS,
  UNCONFIRMED_SEVERITY_LABEL,
  hasVisibleText,
  renderableAlertBodyHtml,
} from './alertUtils';
import type { Severity } from './alertUtils';
import { EventTimeBanner } from './alerts/EventTimeBanner';
import { tintLogoGrayscale, tintLogoWhite } from '../utils/alertCardAssets';

/** Neutral placeholder mark while no severity is confirmed: an empty grey ring, no severity glyph. */
const UNCONFIRMED_SEVERITY_ICON = (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8" stroke="#5f6368" strokeWidth="2.5" />
  </svg>
);

export interface AlertCardProps {
  cardRef: React.RefObject<HTMLDivElement | null>;
  /** Null until the operator confirms one: the card then shows a neutral "Choose severity" state. */
  severity: Severity | null;
  displaySubject: string;
  /** Renders the subject as a preview-only placeholder (export refuses empty subjects). */
  subjectIsPlaceholder?: boolean;
  displaySender: string;
  displayRecipient: string;
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
  subjectIsPlaceholder = false,
  displaySender,
  displayRecipient,
  bodyHtml,
  logoDataUrl,
  footerLogoDataUrl,
  eventTimeStart,
  eventTimeEnd,
}) => {
  const colors = severity ? SEVERITY_COLORS[severity] : UNCONFIRMED_SEVERITY_COLORS;
  const hasContent = hasVisibleText(bodyHtml);

  const [whiteLogoUrl, setWhiteLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    if (!logoDataUrl) {
      setWhiteLogoUrl(null);
      return () => {
        cancelled = true;
      };
    }
    void tintLogoWhite(logoDataUrl)
      .then((url) => {
        if (!cancelled) setWhiteLogoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setWhiteLogoUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [logoDataUrl]);

  const [grayFooterLogoUrl, setGrayFooterLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    if (!footerLogoDataUrl) {
      setGrayFooterLogoUrl(null);
      return () => {
        cancelled = true;
      };
    }
    void tintLogoGrayscale(footerLogoDataUrl)
      .then((url) => {
        if (!cancelled) setGrayFooterLogoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setGrayFooterLogoUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [footerLogoDataUrl]);

  // Always sanitize HTML at the render boundary to prevent XSS
  const safeHtml = useMemo(
    () => (hasContent ? renderableAlertBodyHtml(bodyHtml) : 'Your message will appear here...'),
    [bodyHtml, hasContent],
  );

  // Body links are live only in the exported email; in the preview they must not navigate.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const preventLinkNavigation = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a')) event.preventDefault();
    };
    body.addEventListener('click', preventLinkNavigation);
    return () => body.removeEventListener('click', preventLinkNavigation);
  }, []);

  const metaRef = useRef<HTMLDivElement>(null);
  const [metaFontSize, setMetaFontSize] = useState(13);
  const [metaWrap, setMetaWrap] = useState(false);
  const [metaWidth, setMetaWidth] = useState(0);

  useEffect(() => {
    if (!metaRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setMetaWidth(entry.contentRect.width);
    });
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
        probe.remove();
        setMetaFontSize(size);
        setMetaWrap(false);
        return;
      }
    }
    probe.remove();
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
              <span className="alerts-email-severity-prefix">{severity ? 'ALERT' : 'PREVIEW'}</span>
              <span className={`alerts-email-severity-label${severity ? '' : ' is-unconfirmed'}`}>
                {severity ?? UNCONFIRMED_SEVERITY_LABEL}
              </span>
            </div>
            {whiteLogoUrl && <img src={whiteLogoUrl} alt="" className="alerts-email-header-logo" />}
          </div>
          <div className="alerts-email-icon-wrapper">
            <div className="alerts-email-icon">
              {severity ? SEVERITY_ICONS[severity] : UNCONFIRMED_SEVERITY_ICON}
            </div>
          </div>
          <div className="alerts-email-header">
            <div className={`alerts-email-subject${subjectIsPlaceholder ? ' empty' : ''}`}>
              {displaySubject}
            </div>
          </div>
          {/* "When" is the severity-neutral event-time wording. */}
          <EventTimeBanner
            severity={severity ?? 'INFO'}
            startTime={eventTimeStart}
            endTime={eventTimeEnd}
          />
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
            ref={bodyRef}
            className={`alerts-email-body${hasContent ? '' : ' empty'}`}
            style={HIGHLIGHT_STYLE_VARS as React.CSSProperties}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
          <div className="alerts-email-footer">
            {grayFooterLogoUrl ? (
              <img src={grayFooterLogoUrl} alt="" className="alerts-email-footer-logo" />
            ) : (
              <div className="alerts-email-footer-spacer" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
