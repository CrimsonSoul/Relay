import { renderToStaticMarkup } from 'react-dom/server';
import { SEVERITY_COLORS, SEVERITY_ICONS, type Severity } from '../tabs/alertUtils';

/** Convert an image data URL to grayscale (preserving alpha). */
export function tintLogoGrayscale(dataUrl: string): Promise<string> {
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
      for (let i = 0; i + 3 < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];
        if (red === undefined || green === undefined || blue === undefined) break;
        const lum = 0.299 * red + 0.587 * green + 0.114 * blue;
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
export function tintLogoWhite(dataUrl: string): Promise<string> {
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

/** Shown size of the Outlook icon strip; it is drawn at 2× for sharp rendering. */
const STRIP_WIDTH = 636;
const STRIP_HEIGHT = 56;
const SCALE = 2;
/** The preview's 54 px circle with its 3 px severity ring and 30 px icon. */
const CIRCLE_DIAMETER = 54;
const RING_WIDTH = 3;
const ICON_SIZE = 30;

function loadSvgImage(markup: string): Promise<HTMLImageElement> {
  const svg = markup.includes('xmlns=')
    ? markup
    : markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Outlook cannot overlap elements or render SVG, so the card's circled severity icon, which
 * straddles the banner edge, ships as one PNG strip: banner colour above, white below.
 */
export async function renderAlertIconStrip(severity: Severity): Promise<string> {
  const width = STRIP_WIDTH * SCALE;
  const height = STRIP_HEIGHT * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image drawing is unavailable');
  const banner = SEVERITY_COLORS[severity].banner;
  const centerX = width / 2;
  const centerY = height / 2;

  ctx.fillStyle = banner;
  ctx.fillRect(0, 0, width, height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, height / 2, width, height / 2);

  const ringWidth = RING_WIDTH * SCALE;
  ctx.beginPath();
  ctx.arc(centerX, centerY, (CIRCLE_DIAMETER * SCALE - ringWidth) / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = banner;
  ctx.lineWidth = ringWidth;
  ctx.stroke();

  const icon = await loadSvgImage(renderToStaticMarkup(SEVERITY_ICONS[severity]));
  const iconSize = ICON_SIZE * SCALE;
  ctx.drawImage(icon, centerX - iconSize / 2, centerY - iconSize / 2, iconSize, iconSize);
  return canvas.toDataURL('image/png');
}
