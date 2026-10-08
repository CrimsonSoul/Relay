const paths = {
  attachment:
    'M21 11.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5',
  download: 'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M5 16v5h14v-5',
  check: 'm5 12 5 5L20 7',
  chevron: 'm6 9 6 6 6-6',
  collapse: 'M4 14h6v6m10-10h-6V4m0 6 7-7M3 21l7-7',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  mail: 'M3 5h18v14H3zm0 1 9 7 9-7',
  note: 'M6 3h9l4 4v14H6zm8 0v5h5M9 13h7m-7 4h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm10 3-5.2-5.2',
} as const;

export function SdpIcon({ name }: Readonly<{ name: keyof typeof paths }>) {
  return (
    <svg
      className="sdp-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const commandGlyphs = {
  account: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
    </>
  ),
  queues: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  clear: <path d="M18 6 6 18M6 6l12 12" />,
} as const;

/** Command-bar glyphs, drawn like the other tabs' utility icons (20 px, 2 px stroke). */
export function SdpCommandIcon({ name }: Readonly<{ name: keyof typeof commandGlyphs }>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {commandGlyphs[name]}
    </svg>
  );
}

/** The overflow glyph, as on Compose's More Compose Actions. */
export function SdpMoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}
