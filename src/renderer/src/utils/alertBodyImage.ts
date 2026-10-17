/**
 * Pasted and dropped alert body images take the same shape as Insert Image, whose main-process
 * picker scales to this width and re-encodes non-PNG images as JPEG at quality 82. Without it a
 * full-resolution screenshot encodes past the sanitizer's data-image bound and is refused.
 */
export const ALERT_BODY_IMAGE_MAX_WIDTH = 516;
const ALERT_BODY_IMAGE_JPEG_QUALITY = 0.82;

/** Decodes an image file and returns it as a data URL no wider than the alert body. */
export async function prepareAlertBodyImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, ALERT_BODY_IMAGE_MAX_WIDTH / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image drawing is unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return file.type === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', ALERT_BODY_IMAGE_JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}
