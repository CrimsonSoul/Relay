export const HIGHLIGHT_TYPES = ['deadline', 'warning', 'success', 'number', 'service'] as const;
export type HighlightType = (typeof HIGHLIGHT_TYPES)[number];

export interface HighlightDef {
  type: HighlightType;
  label: string;
  /** Background color for the pill (used in card body — light theme) */
  bg: string;
  /** Text color for the pill */
  text: string;
  /** Keyboard shortcut suffix (Cmd+N) */
  shortcutKey: string;
}

export const HIGHLIGHTS: HighlightDef[] = [
  { type: 'deadline', label: 'Deadline', bg: '#fff3cd', text: '#856404', shortcutKey: '1' },
  { type: 'warning', label: 'Warning', bg: '#fee2e2', text: '#991b1b', shortcutKey: '2' },
  { type: 'success', label: 'Success', bg: '#d1fae5', text: '#065f46', shortcutKey: '3' },
  { type: 'number', label: 'Number', bg: '#dbeafe', text: '#1e40af', shortcutKey: '4' },
  { type: 'service', label: 'Service', bg: '#f0f0f5', text: '#333333', shortcutKey: '5' },
];

/** Get a highlight definition by type, or undefined if not a known type. */
export function getHighlight(type: string): HighlightDef | undefined {
  return HIGHLIGHTS.find((h) => h.type === type);
}
