export const HIGHLIGHT_TYPES = ['deadline', 'warning', 'success', 'number', 'service'] as const;
export type HighlightType = (typeof HIGHLIGHT_TYPES)[number];

interface HighlightDef {
  type: HighlightType;
  label: string;
  /** Background color for the pill used in the email preview body. */
  bg: string;
  /** Text color for the pill */
  text: string;
  /** Keyboard shortcut suffix (Cmd+N) */
  shortcutKey: string;
}

/* Single source for highlight pill colours. These are exported-email content colours, not app
   chrome; the card and editor receive them as custom properties (HIGHLIGHT_STYLE_VARS) that the
   [data-hl] rules in alerts-email-card.css read, and the popover swatches use `bg` directly. */
export const HIGHLIGHTS: HighlightDef[] = [
  { type: 'deadline', label: 'Deadline', bg: '#fff3cd', text: '#856404', shortcutKey: '1' },
  { type: 'warning', label: 'Warning', bg: '#fee2e2', text: '#991b1b', shortcutKey: '2' },
  { type: 'success', label: 'Success', bg: '#d1fae5', text: '#065f46', shortcutKey: '3' },
  { type: 'number', label: 'Number', bg: '#dbeafe', text: '#1565c0', shortcutKey: '4' },
  { type: 'service', label: 'Service', bg: '#f0f0f5', text: '#333333', shortcutKey: '5' },
];

/** `--alerts-hl-<type>-bg` / `--alerts-hl-<type>-text` for every highlight type. */
export const HIGHLIGHT_STYLE_VARS: Record<string, string> = Object.fromEntries(
  HIGHLIGHTS.flatMap((h) => [
    ['--alerts-hl-' + h.type + '-bg', h.bg],
    ['--alerts-hl-' + h.type + '-text', h.text],
  ]),
);
