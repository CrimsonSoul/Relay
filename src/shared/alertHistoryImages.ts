/** Limits for the protected `alert_history.images` file field that holds saved guide images. */
export const ALERT_HISTORY_MAX_IMAGES = 30;
export const ALERT_HISTORY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const ALERT_HISTORY_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
