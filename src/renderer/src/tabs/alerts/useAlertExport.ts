import { useCallback, useMemo, useState, type RefObject } from 'react';
import { MAX_IMAGE_DATA_URL_LENGTH, type AlertHistoryEntry } from '@shared/ipc';
import type { Severity } from '../alertUtils';
import { buildAlertOutlookEml, sanitizeAlertClickUrl } from '../alertLinks';

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
  historyDraft: {
    severity: Severity;
    subject: string;
    bodyHtml: string;
    sender: string;
    recipient: string;
  };
  addHistory: (entry: AlertHistoryDraft) => unknown;
  requestOptionalFieldAttention: (field: 'clickThroughUrl') => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

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

export function prepareAlertCaptureClone(clone: HTMLDivElement, source: HTMLDivElement): void {
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
  historyDraft,
  addHistory,
  requestOptionalFieldAttention,
  showToast,
}: UseAlertExportOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
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
        showToast('Saved!', 'success');
        void addHistory(historyDraft);
      } else if (result?.error !== 'Cancelled') {
        showToast(result?.error || 'Save failed', 'error');
      }
    } catch {
      showToast('Capture failed', 'error');
    } finally {
      setIsCapturing(false);
    }
  }, [addHistory, captureCard, historyDraft, showToast]);

  const prepareOutlookDraftImage = useCallback(async () => {
    let canvas = await captureCard(ALERT_OUTLOOK_CAPTURE_SCALE);
    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      canvas = await captureCard(ALERT_OUTLOOK_FALLBACK_SCALE);
      dataUrl = canvas.toDataURL('image/png');
    }
    const optimized = await globalThis.api?.optimizeAlertImage?.(dataUrl).catch(() => null);
    return {
      dataUrl: optimized?.success && optimized.data ? optimized.data : dataUrl,
      width: canvas.width,
      height: canvas.height,
    };
  }, [captureCard]);

  const openOutlookDraft = useCallback(async () => {
    if (clickThroughUrl.trim() && !alertClickHref) {
      requestOptionalFieldAttention('clickThroughUrl');
      showToast('Enter a valid HTTP or HTTPS click-through URL', 'error');
      return false;
    }

    setIsCapturing(true);
    try {
      const image = await prepareOutlookDraftImage();
      const content = buildAlertOutlookEml({
        subject: displaySubject,
        imageDataUrl: image.dataUrl,
        imageHref: alertClickHref,
        width: image.width,
        height: image.height,
      });
      const success = await globalThis.api?.saveAndOpenAlertDraft?.(content);
      if (success) {
        showToast(isWebRuntime ? 'Alert draft downloaded' : 'Outlook draft opened', 'success');
        void addHistory(historyDraft);
        return true;
      }
      showToast(
        isWebRuntime ? 'Failed to download alert draft' : 'Failed to open Outlook draft',
        'error',
      );
      return false;
    } catch {
      showToast('Failed to prepare Outlook draft', 'error');
      return false;
    } finally {
      setIsCapturing(false);
    }
  }, [
    addHistory,
    alertClickHref,
    clickThroughUrl,
    displaySubject,
    historyDraft,
    isWebRuntime,
    prepareOutlookDraftImage,
    requestOptionalFieldAttention,
    showToast,
  ]);

  return { isCapturing, saveImage, openOutlookDraft };
}
