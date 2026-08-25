export const CLOUD_STATUS_PORTAL_ORDER = ['equinix'] as const;

export type CloudStatusPortalProvider = (typeof CLOUD_STATUS_PORTAL_ORDER)[number];

export const EQUINIX_STATUS_HOST = 'status.equinix.com';

export const CLOUD_STATUS_PORTALS: Record<
  CloudStatusPortalProvider,
  { label: string; statusUrl: string; accessLabel: string }
> = {
  equinix: {
    label: 'Equinix',
    statusUrl: `https://${EQUINIX_STATUS_HOST}/`,
    accessLabel: 'Sign-in required',
  },
};
