import { useCallback, useMemo, useState, type RefObject } from 'react';
import { MAX_IMAGE_DATA_URL_LENGTH, type AlertHistoryEntry } from '@shared/ipc';
import {
  DEFAULT_ALERT_RECIPIENT,
  describeMissingAlertFields,
  missingAlertExportFields,
  type AlertExportField,
  type AlertMessageField,
  type Severity,
} from '../alertUtils';
import { AlertEmlTooLargeError, buildAlertGuideEml, sanitizeAlertClickUrl } from '../alertLinks';
import { alertCalloutTonesIn, buildAlertEmailHtml, buildAlertEmailText } from './alertEmailHtml';
import type { AlertCalloutTone } from './alertBlocks';
import {
  renderAlertIconStrip,
  renderAlertToneIcon,
  tintLogoGrayscale,
  tintLogoWhite,
} from '../../utils/alertCardAssets';
import { formatFailure } from '../../utils/failureMessage';

export const ALERT_EXPORT_WIDTH_PX = 640;
const ALERT_CAPTURE_SCALE = 2;
const ALERT_OUTLOOK_CAPTURE_SCALE = 2;
const ALERT_OUTLOOK_FALLBACK_SCALE = 1;

type AlertHistoryDraft = Omit<AlertHistoryEntry, 'id' | 'timestamp'>;

type UseAlertExportOptions = {
  cardRef: RefObject<HTMLDivElement | null>;
  clickThroughUrl: string;
  displaySubject: string;
  isWebRuntime: boolean;
  /** Header logo as the operator uploaded it; the export tints it white like the card. */
  logoDataUrl?: string | null;
  /** Footer logo as uploaded; the export renders it grayscale like the card. */
  footerLogoDataUrl?: string | null;
  historyDraft: {
    severity: Severity;
    subject: string;
    bodyHtml: string;
    sender: string;
    recipient: string;
  };
  /** False while severity is still the untouched INFO default; export needs a deliberate choice. */
  severityConfirmed: boolean;
  updateNumber?: number;
  eventTimeStart?: string;
  eventTimeEnd?: string;
  addHistory: (entry: AlertHistoryDraft) => unknown;
  requestFieldAttention: (field: AlertExportField | 'clickThroughUrl') => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

/** "Choose a severity and add a subject before exporting", naming only what is missing. */
function describeExportRefusal(missing: readonly AlertExportField[]): string {
  const messageFields = missing.filter((field): field is AlertMessageField => field !== 'severity');
  const steps: string[] = [];
  if (missing.includes('severity')) steps.push('choose a severity');
  if (messageFields.length > 0) steps.push(`add a ${describeMissingAlertFields(messageFields)}`);
  const action = steps.join(' and ');
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} before exporting`;
}

const GUIDE_TOO_LARGE_MESSAGE =
  'This guide is too large for one email — remove or shrink some images.';

function draftOpenedMessage(isWebRuntime: boolean, backupIncluded: boolean): string {
  if (isWebRuntime) {
    const base =
      'relay-alert.eml download started — open it in Outlook, review recipients, and send.';
    return backupIncluded ? base : `${base} The backup card image was left out.`;
  }
  return backupIncluded
    ? 'Outlook draft opened'
    : 'Outlook draft opened — the backup card image was left out.';
}

function readCssValue(element: HTMLElement, property: string): string {
  return (
    element.style.getPropertyValue(property).trim() ||
    getComputedStyle(element).getPropertyValue(property).trim()
  );
}

function applySolidColor(element: HTMLElement | null, color: string): void {
  if (!element || !color) return;
  element.style.background = color;
  element.style.backgroundColor = color;
}

function preserveIconOverlapBackground(wrapper: HTMLElement | null): void {
  if (!wrapper) return;
  wrapper.style.background = 'transparent';
  wrapper.style.backgroundColor = '';
  const fill = document.createElement('div');
  fill.className = 'alerts-email-icon-wrapper-fill';
  fill.style.position = 'absolute';
  fill.style.left = '0';
  fill.style.right = '0';
  fill.style.top = '26px';
  fill.style.bottom = '0';
  fill.style.background = '#ffffff';
  fill.style.backgroundColor = '#ffffff';
  fill.style.pointerEvents = 'none';
  fill.style.zIndex = '0';
  wrapper.prepend(fill);
}

function addWhiteIconFill(icon: HTMLElement): void {
  const fill = document.createElement('div');
  fill.className = 'alerts-email-icon-fill';
  fill.style.position = 'absolute';
  fill.style.inset = '0';
  fill.style.borderRadius = '50%';
  fill.style.background = '#ffffff';
  fill.style.backgroundColor = '#ffffff';
  fill.style.pointerEvents = 'none';
  fill.style.zIndex = '0';
  icon.prepend(fill);

  icon.querySelectorAll<HTMLElement>('svg').forEach((svg) => {
    svg.style.position = 'relative';
    svg.style.zIndex = '1';
  });
}

function prepareAlertCaptureClone(clone: HTMLDivElement, source: HTMLDivElement): void {
  clone.style.position = 'fixed';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = `${ALERT_EXPORT_WIDTH_PX}px`;
  clone.style.minWidth = `${ALERT_EXPORT_WIDTH_PX}px`;
  clone.style.maxWidth = `${ALERT_EXPORT_WIDTH_PX}px`;
  clone.style.zIndex = '-1';
  clone.style.backgroundColor = '#ffffff';

  const bannerColor = readCssValue(source, '--email-banner');
  if (!bannerColor) return;

  clone.style.setProperty('--email-banner', bannerColor);
  clone.style.borderColor = bannerColor;
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-severity-header'), bannerColor);
  preserveIconOverlapBackground(clone.querySelector<HTMLElement>('.alerts-email-icon-wrapper'));
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-header'), '#ffffff');
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-body'), '#ffffff');
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-meta'), '#fafafa');
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-footer'), '#fafafa');
  const icon = clone.querySelector<HTMLElement>('.alerts-email-icon');
  if (icon) {
    icon.style.position = 'relative';
    icon.style.zIndex = '1';
    icon.style.background = '#ffffff';
    icon.style.backgroundColor = '#ffffff';
    icon.style.borderColor = bannerColor;
    addWhiteIconFill(icon);
  }
}

export function useAlertExport({
  cardRef,
  clickThroughUrl,
  displaySubject,
  isWebRuntime,
  logoDataUrl = null,
  footerLogoDataUrl = null,
  historyDraft,
  severityConfirmed,
  updateNumber,
  eventTimeStart,
  eventTimeEnd,
  addHistory,
  requestFieldAttention,
  showToast,
}: UseAlertExportOptions) {
  const [isCapturing, setIsCapturing] = useState(false);

  // Export ships whatever the card shows, so an empty subject or body would go out as
  // the "Alert Subject" placeholder and an unchosen severity as INFO. Refuse and send focus
  // to the first missing field.
  const refuseIncompleteMessage = useCallback((): boolean => {
    const missing = missingAlertExportFields(
      severityConfirmed,
      historyDraft.subject,
      historyDraft.bodyHtml,
    );
    if (missing.length === 0) return false;
    requestFieldAttention(missing[0]!);
    showToast(describeExportRefusal(missing), 'error');
    return true;
  }, [
    historyDraft.bodyHtml,
    historyDraft.subject,
    requestFieldAttention,
    severityConfirmed,
    showToast,
  ]);

  const alertClickHref = useMemo(
    () => sanitizeAlertClickUrl(clickThroughUrl) ?? undefined,
    [clickThroughUrl],
  );

  const captureCard = useCallback(
    async (scale = ALERT_CAPTURE_SCALE): Promise<HTMLCanvasElement> => {
      if (!cardRef.current) throw new Error('Card ref not available');
      const source = cardRef.current;
      const clone = source.cloneNode(true) as HTMLDivElement;
      prepareAlertCaptureClone(clone, source);
      document.body.appendChild(clone);
      try {
        const { default: html2canvas } = await import('html2canvas');
        return await html2canvas(clone, {
          scale,
          useCORS: true,
          backgroundColor: null,
          logging: false,
        });
      } finally {
        clone.remove();
      }
    },
    [cardRef],
  );

  const saveImage = useCallback(async () => {
    if (refuseIncompleteMessage()) return;
    setIsCapturing(true);
    try {
      const canvas = await captureCard();
      const dataUrl = canvas.toDataURL('image/png');
      const slug =
        historyDraft.subject
          .trim()
          .replaceAll(/[^a-z0-9]/gi, '_')
          .toLowerCase()
          .slice(0, 40) || 'alert';
      const result = await globalThis.api?.saveAlertImage(dataUrl, `alert_${slug}.png`);
      if (result?.success) {
        showToast('Saved the alert image', 'success');
        void addHistory(historyDraft);
      } else if (result?.error !== 'Cancelled') {
        showToast(
          formatFailure({
            what: "Couldn't save the alert image",
            error: result?.error,
            outcome: 'Your alert is unchanged.',
            next: 'Choose another folder and try again.',
          }),
          'error',
        );
      }
    } catch (error) {
      showToast(
        formatFailure({
          what: "Couldn't capture the alert card as an image",
          error,
          outcome: 'Your alert is unchanged.',
        }),
        'error',
      );
    } finally {
      setIsCapturing(false);
    }
  }, [addHistory, captureCard, historyDraft, refuseIncompleteMessage, showToast]);

  /** The full-card PNG attached as a backup, or null when it cannot be captured within limits. */
  const prepareBackupCardImage = useCallback(async (): Promise<string | null> => {
    try {
      let dataUrl = (await captureCard(ALERT_OUTLOOK_CAPTURE_SCALE)).toDataURL('image/png');
      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        dataUrl = (await captureCard(ALERT_OUTLOOK_FALLBACK_SCALE)).toDataURL('image/png');
      }
      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return null;
      const optimized = await globalThis.api?.optimizeAlertImage?.(dataUrl).catch(() => null);
      return optimized?.success && optimized.data ? optimized.data : dataUrl;
    } catch {
      return null;
    }
  }, [captureCard]);

  const prepareCardAssets = useCallback(async () => {
    const tones = alertCalloutTonesIn(historyDraft.bodyHtml);
    const [iconStripDataUrl, tintedLogo, tintedFooterLogo] = await Promise.all([
      renderAlertIconStrip(historyDraft.severity),
      logoDataUrl ? tintLogoWhite(logoDataUrl) : null,
      footerLogoDataUrl ? tintLogoGrayscale(footerLogoDataUrl) : null,
    ]);
    const toneIconUrls = tones.map((tone) => renderAlertToneIcon(tone));
    const toneIcons: Partial<Record<AlertCalloutTone, string>> = Object.fromEntries(
      tones.map((tone, index) => [tone, toneIconUrls[index]]),
    );
    return {
      iconStripDataUrl,
      logoDataUrl: tintedLogo,
      footerLogoDataUrl: tintedFooterLogo,
      toneIcons,
    };
  }, [footerLogoDataUrl, historyDraft.bodyHtml, historyDraft.severity, logoDataUrl]);

  /** The EML for the current draft, or null when it would exceed the handoff size cap. */
  const buildDraft = useCallback(async () => {
    const [assets, backupPngDataUrl] = await Promise.all([
      prepareCardAssets(),
      prepareBackupCardImage(),
    ]);
    const card = {
      severity: historyDraft.severity,
      sender: historyDraft.sender.trim() || 'IT',
      recipient: historyDraft.recipient.trim() || DEFAULT_ALERT_RECIPIENT,
      bodyHtml: historyDraft.bodyHtml,
      clickHref: alertClickHref,
      updateNumber,
      eventTimeStart,
      eventTimeEnd,
    };
    const { html, inlineImages } = buildAlertEmailHtml({
      ...card,
      subject: displaySubject,
      assets,
    });
    const text = buildAlertEmailText({ ...card, subject: historyDraft.subject.trim() });
    try {
      const content = buildAlertGuideEml({
        subject: displaySubject,
        html,
        text,
        inlineImages,
        backupPngDataUrl,
      });
      return { content, backupIncluded: Boolean(backupPngDataUrl) };
    } catch (error) {
      if (error instanceof AlertEmlTooLargeError) return null;
      throw error;
    }
  }, [
    alertClickHref,
    displaySubject,
    eventTimeEnd,
    eventTimeStart,
    historyDraft,
    prepareBackupCardImage,
    prepareCardAssets,
    updateNumber,
  ]);

  const openOutlookDraft = useCallback(async () => {
    if (refuseIncompleteMessage()) return false;
    if (clickThroughUrl.trim() && !alertClickHref) {
      requestFieldAttention('clickThroughUrl');
      showToast('Enter a valid HTTP or HTTPS click-through URL', 'error');
      return false;
    }

    setIsCapturing(true);
    try {
      const draft = await buildDraft();
      if (!draft) {
        showToast(GUIDE_TOO_LARGE_MESSAGE, 'error');
        return false;
      }
      const success = await globalThis.api?.saveAndOpenAlertDraft?.(draft.content);
      if (success) {
        showToast(draftOpenedMessage(isWebRuntime, draft.backupIncluded), 'success');
        void addHistory(historyDraft);
        return true;
      }
      showToast(
        formatFailure({
          what: isWebRuntime
            ? "Couldn't download the alert draft"
            : "Couldn't open the Outlook draft",
          outcome: 'Your alert is unchanged.',
          next: isWebRuntime
            ? 'Allow downloads from Relay in your browser, then try again.'
            : 'Check that Outlook is installed and set as the mail app, then try again.',
        }),
        'error',
      );
      return false;
    } catch (error) {
      showToast(
        formatFailure({
          what: "Couldn't prepare the Outlook draft",
          error,
          outcome: 'Your alert is unchanged.',
        }),
        'error',
      );
      return false;
    } finally {
      setIsCapturing(false);
    }
  }, [
    addHistory,
    alertClickHref,
    buildDraft,
    clickThroughUrl,
    historyDraft,
    isWebRuntime,
    refuseIncompleteMessage,
    requestFieldAttention,
    showToast,
  ]);

  return { isCapturing, saveImage, openOutlookDraft };
}
