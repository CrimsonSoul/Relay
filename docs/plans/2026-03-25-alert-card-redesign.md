# Alert Card Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the alert card layout (meta row, footer, toolbar), add smart text processing (compact, enhance, manual highlights), an Event Time field with amber banner display, and a separate footer logo upload.

**Architecture:** Six independent features layered on the existing alert system: (1) card layout changes to meta/footer, (2) a rule-based compact engine, (3) a rule-based enhance engine, (4) manual highlight swatches via dropdown popover, (5) an Event Time field displayed as an amber banner below the subject line (replaces the old timestamp override), (6) a separate footer logo upload distinct from the header logo. The compact and enhance engines are pure functions that transform HTML strings. They compose as a pipeline: `original → compact(if on) → enhance(if on) → render`. Manual highlights are stored in the body HTML and persist across toggle state changes.

**Tech Stack:** React 19, TypeScript, plain CSS (`.alerts-*` BEM), Vitest + @testing-library/react, contentEditable with execCommand.

---

## Open Decisions (ask user if encountered)

- Should the FROM/TO font scaling have discrete steps (13px → 11px → 9.5px) or use a continuous `clamp()`/container-query approach?
- Should Compact/Enhance state persist across sessions (localStorage) or reset on app launch?
- Should the highlight keyboard shortcuts be Cmd+1–5 or Cmd+Shift+1–5 (to avoid conflicts)?

---

## File Map

### New Files

| File                                                       | Responsibility                                           |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `src/renderer/src/tabs/alerts/compactEngine.ts`            | Pure function: strip filler phrases from plain text      |
| `src/renderer/src/tabs/alerts/enhanceEngine.ts`            | Pure function: apply semantic highlights to HTML         |
| `src/renderer/src/tabs/alerts/highlightColors.ts`          | Shared highlight color definitions + CSS class names     |
| `src/renderer/src/tabs/alerts/HighlightPopover.tsx`        | Dropdown popover component for manual highlight swatches |
| `src/renderer/src/tabs/__tests__/compactEngine.test.ts`    | Tests for compact engine                                 |
| `src/renderer/src/tabs/__tests__/enhanceEngine.test.ts`    | Tests for enhance engine                                 |
| `src/renderer/src/tabs/__tests__/AlertCard.test.tsx`       | Tests for card layout changes                            |
| `src/renderer/src/tabs/alerts/EventTimeBanner.tsx`         | Amber banner component for event time display            |
| `src/renderer/src/tabs/__tests__/EventTimeBanner.test.tsx` | Tests for event time banner                              |

### Modified Files

| File                                               | Changes                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/tabs/AlertCard.tsx`              | New footer with logo + timestamp; centered FROM/TO with dot separator; auto-scaling font; consume enhance/compact state                  |
| `src/renderer/src/tabs/alerts/AlertBodyEditor.tsx` | Add highlight popover button + keyboard shortcuts to toolbar                                                                             |
| `src/renderer/src/tabs/AlertsTab.tsx`              | Add `isCompact`/`isEnhanced` state; wire pipeline; add eventTime + footerLogo state + IPC handlers; pass to card + form                  |
| `src/renderer/src/tabs/alertUtils.tsx`             | Add `span[data-hl]` to sanitizer allowlist                                                                                               |
| `src/renderer/src/tabs/alerts.css`                 | New footer styles, centered meta, highlight pill styles, popover styles, toolbar additions, event time banner styles, footer logo upload |
| `src/renderer/src/tabs/AlertForm.tsx`              | Replace timestamp override with Event Time inputs; add footer logo upload section                                                        |
| `src/shared/ipc.ts`                                | Add IPC channels + API types for footer logo (save/get/remove)                                                                           |
| `src/preload/index.ts`                             | Expose footer logo IPC methods                                                                                                           |
| `src/main/handlers/windowHandlers.ts`              | Add footer logo handlers (mirror header logo pattern, file: `footer-logo.png`)                                                           |

---

## Task 1: Shared Highlight Color Definitions

**Files:**

- Create: `src/renderer/src/tabs/alerts/highlightColors.ts`

This is the shared constant used by the enhance engine, manual highlights, and CSS.

- [ ] **Step 1: Create highlight color definitions**

```ts
// src/renderer/src/tabs/alerts/highlightColors.ts

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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/tabs/alerts/highlightColors.ts
git commit -m "feat(alerts): add shared highlight color definitions"
```

---

## Task 2: Update Sanitizer to Allow Highlight Spans

**Files:**

- Modify: `src/renderer/src/tabs/alertUtils.tsx` (sanitizeHtml function)
- Modify: `src/renderer/src/tabs/__tests__/alertUtils.test.ts`

The sanitizer currently strips all `<span>` tags and all attributes. We need to allow `<span data-hl="...">` with known values only.

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/tabs/__tests__/alertUtils.test.ts` (create the `__tests__` directory if it doesn't exist):

```ts
describe('sanitizeHtml – highlight spans', () => {
  it('preserves span with known data-hl value', () => {
    const input = '<span data-hl="deadline">60 days</span>';
    expect(sanitizeHtml(input)).toBe('<span data-hl="deadline">60 days</span>');
  });

  it('strips span with unknown data-hl value', () => {
    const input = '<span data-hl="evil">text</span>';
    expect(sanitizeHtml(input)).toBe('text');
  });

  it('strips span with no data-hl attribute', () => {
    const input = '<span class="foo">text</span>';
    expect(sanitizeHtml(input)).toBe('text');
  });

  it('preserves nested content inside highlight span', () => {
    const input = '<span data-hl="warning"><b>critical</b> issue</span>';
    expect(sanitizeHtml(input)).toBe('<span data-hl="warning"><b>critical</b> issue</span>');
  });

  it('strips data-hl span that also has other attributes', () => {
    const input = '<span data-hl="deadline" onclick="alert(1)">text</span>';
    // Should keep data-hl but strip onclick
    expect(sanitizeHtml(input)).toBe('<span data-hl="deadline">text</span>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- alertUtils`
Expected: New tests FAIL (spans currently stripped)

- [ ] **Step 3: Update sanitizeHtml to allow highlight spans**

In `src/renderer/src/tabs/alertUtils.tsx`, modify the `walk` function inside `sanitizeHtml`:

```ts
import { HIGHLIGHT_TYPES } from './alerts/highlightColors';

// Inside sanitizeHtml, replace the existing walk function:
const walk = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(walk).join('');
  const allowed = ['b', 'i', 'u', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li'];
  if (allowed.includes(tag)) {
    if (tag === 'br') return '<br>';
    return `<${tag}>${children}</${tag}>`;
  }
  // Allow <span data-hl="knownType"> for highlight support
  if (tag === 'span') {
    const hlType = el.getAttribute('data-hl');
    if (hlType && (HIGHLIGHT_TYPES as readonly string[]).includes(hlType)) {
      return `<span data-hl="${escapeHtml(hlType)}">${children}</span>`;
    }
  }
  return children;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- alertUtils`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/alertUtils.tsx src/renderer/src/tabs/__tests__/alertUtils.test.ts
git commit -m "feat(alerts): allow data-hl highlight spans in sanitizer"
```

---

## Task 3: Compact Engine

**Files:**

- Create: `src/renderer/src/tabs/alerts/compactEngine.ts`
- Create: `src/renderer/src/tabs/__tests__/compactEngine.test.ts`

A pure function that takes plain text and returns shortened text by applying pattern-matched phrase replacements.

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/tabs/__tests__/compactEngine.test.ts`:

```ts
import { compactText } from '../alerts/compactEngine';

describe('compactText', () => {
  it('returns empty string for empty input', () => {
    expect(compactText('')).toBe('');
  });

  it('removes throat-clearing phrases', () => {
    expect(compactText('Please be advised that your password expires soon.')).toBe(
      'Your password expires soon.',
    );
  });

  it('removes "We wanted to make you aware that"', () => {
    expect(compactText('We wanted to make you aware that the server is down.')).toBe(
      'The server is down.',
    );
  });

  it('replaces "in order to" with "to"', () => {
    expect(compactText('Click the link in order to reset your password.')).toBe(
      'Click the link to reset your password.',
    );
  });

  it('replaces "approximately" with "~"', () => {
    expect(compactText('ETA is approximately 2 hours.')).toBe('ETA is ~2 hours.');
  });

  it('replaces "at this point in time" with "now"', () => {
    expect(compactText('At this point in time, the service is degraded.')).toBe(
      'Now, the service is degraded.',
    );
  });

  it('removes trailing update promises', () => {
    expect(
      compactText(
        'We are investigating. We will provide updates as more information becomes available.',
      ),
    ).toBe('We are investigating.');
  });

  it('removes "please don\'t hesitate to"', () => {
    expect(compactText("Please don't hesitate to contact IT.")).toBe('Contact IT.');
  });

  it('removes "We appreciate your patience and cooperation"', () => {
    const input = 'Service restored. We appreciate your patience and cooperation during this time.';
    expect(compactText(input)).toBe('Service restored.');
  });

  it('replaces "Failure to do so will result in" with "Otherwise:"', () => {
    expect(
      compactText('Update your password. Failure to do so will result in account lockout.'),
    ).toBe('Update your password. Otherwise: account lockout.');
  });

  it('applies multiple rules in one pass', () => {
    const input =
      'Please be advised that we are currently experiencing issues. We will provide updates as more information becomes available.';
    const result = compactText(input);
    // "Please be advised that" removed, "currently" removed, trailing update promise removed
    expect(result).toBe('We are experiencing issues.');
  });

  it('handles mixed case in patterns', () => {
    expect(compactText('PLEASE BE ADVISED THAT the server is down.')).toBe('The server is down.');
  });

  it('cleans up extra whitespace after removals', () => {
    const input = 'Please be advised that  your password  will expire.';
    expect(compactText(input)).not.toContain('  ');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- compactEngine`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement compact engine**

Create `src/renderer/src/tabs/alerts/compactEngine.ts`:

```ts
// src/renderer/src/tabs/alerts/compactEngine.ts

/** Phrase replacement rule: [pattern, replacement]. Replacement '' means remove. */
type Rule = [RegExp, string];

/**
 * Ordered list of compact rules. Applied sequentially — order matters.
 * Rules that remove sentence-level padding run first, then phrase-level.
 */
const RULES: Rule[] = [
  // --- Sentence-level removals (run first) ---
  [/\s*We will provide updates as more information becomes available\.?/gi, ''],
  [/\s*We appreciate your patience and cooperation[^.]*\.?/gi, ''],
  [/\s*We kindly ask that /gi, ' '],
  [/\s*Please note that /gi, ' '],

  // --- Throat-clearing openers (capitalize next word) ---
  [/Please be advised that\s*/gi, ''],
  [/We wanted to make you aware that\s*/gi, ''],
  [/We are pleased to inform you that\s*/gi, ''],
  [/We wanted to let you know that\s*/gi, ''],
  [/This is to inform you that\s*/gi, ''],
  [/As part of our ongoing efforts to [^,]*,\s*/gi, ''],

  // --- Filler phrases ---
  [/in order to\b/gi, 'to'],
  [/at this point in time/gi, 'now'],
  [/at this time/gi, 'now'],
  [/a number of/gi, 'several'],
  [/due to the fact that/gi, 'because'],
  [/in the event that/gi, 'if'],
  [/prior to\b/gi, 'before'],
  [/subsequent to\b/gi, 'after'],
  [/in the near future/gi, 'soon'],
  [/on a daily basis/gi, 'daily'],
  [/under any circumstances/gi, ''],

  // --- Wordy constructions ---
  [/Failure to do so will result in\s*/gi, 'Otherwise: '],
  [/please don't hesitate to\s*/gi, ''],
  [/please do not hesitate to\s*/gi, ''],
  [/If you require any assistance or have any questions,?\s*/gi, ''],
  [/If you have any questions or concerns[^,]*,?\s*/gi, ''],
  [/For any questions or concerns[^,]*,?\s*/gi, ''],
  [/Please remember that you should\s*/gi, ''],

  // --- Redundant qualifiers ---
  [/\bapproximately\b/gi, '~'],
  [/\beach and every\b/gi, 'every'],
  [/\bany and all\b/gi, 'all'],
  [/\bcurrently\b/gi, ''],

  // --- Passive to active ---
  [/you may experience/gi, 'expect'],
  [/will be migrating/gi, 'migrating'],
  [/are\s+affected/gi, 'affected'],

  // --- Contact block compression ---
  [/(?:please )?(?:reach out to|contact)\s+the\s+/gi, 'Contact: '],
  [/\bat extension\b/gi, 'at ext.'],
];

/**
 * Apply rule-based compaction to plain text.
 * Strips corporate filler phrases and redundant wording.
 * Does NOT modify HTML tags — operate on text content only.
 */
export function compactText(text: string): string {
  if (!text.trim()) return '';

  let result = text;
  for (const [pattern, replacement] of RULES) {
    result = result.replace(pattern, replacement);
  }

  // Capitalize first letter after removal left a lowercase start
  result = result.replace(/^\s*([a-z])/, (_, c: string) => c.toUpperCase());

  // Capitalize after period + space where removal lowered the case
  result = result.replace(/\.\s+([a-z])/g, (_, c: string) => `. ${c.toUpperCase()}`);

  // Collapse multiple spaces
  result = result.replace(/ {2,}/g, ' ');

  // Clean up orphaned punctuation and whitespace
  result = result.replace(/\s+\./g, '.').replace(/\s+,/g, ',');

  // Remove trailing whitespace
  result = result.trim();

  // Remove trailing period if the result ends with just punctuation after stripping
  result = result.replace(/\.\s*$/, (m) => (result.length > 2 ? m : ''));

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- compactEngine`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/alerts/compactEngine.ts src/renderer/src/tabs/__tests__/compactEngine.test.ts
git commit -m "feat(alerts): add rule-based compact engine for stripping filler text"
```

---

## Task 4: Enhance Engine

**Files:**

- Create: `src/renderer/src/tabs/alerts/enhanceEngine.ts`
- Create: `src/renderer/src/tabs/__tests__/enhanceEngine.test.ts`

A pure function that takes HTML and returns HTML with semantic highlights wrapped in `<span data-hl="type">`.

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/tabs/__tests__/enhanceEngine.test.ts`:

```ts
import { enhanceHtml } from '../alerts/enhanceEngine';

describe('enhanceHtml', () => {
  it('returns empty string for empty input', () => {
    expect(enhanceHtml('')).toBe('');
  });

  it('highlights time durations as deadline', () => {
    const result = enhanceHtml('Password expires in 60 days.');
    expect(result).toContain('data-hl="deadline"');
    expect(result).toContain('60 days');
  });

  it('highlights dates as deadline', () => {
    const result = enhanceHtml('Update before May 24, 2026.');
    expect(result).toContain('data-hl="deadline"');
    expect(result).toContain('May 24, 2026');
  });

  it('highlights UTC timestamps as deadline', () => {
    const result = enhanceHtml('Outage since 14:15 UTC.');
    expect(result).toContain('data-hl="deadline"');
  });

  it('highlights warning words', () => {
    const result = enhanceHtml('We are experiencing a complete outage.');
    expect(result).toContain('data-hl="warning"');
    expect(result).toContain('outage');
  });

  it('highlights success words', () => {
    const result = enhanceHtml('The issue has been fully resolved.');
    expect(result).toContain('data-hl="success"');
    expect(result).toContain('resolved');
  });

  it('highlights percentages as numbers', () => {
    const result = enhanceHtml('Error rate is 100%.');
    expect(result).toContain('data-hl="number"');
    expect(result).toContain('100%');
  });

  it('bolds action words', () => {
    const result = enhanceHtml('All employees must update their password.');
    expect(result).toContain('<b>must</b>');
  });

  it('bolds "do not" phrases', () => {
    const result = enhanceHtml('Do not share your password.');
    expect(result).toContain('<b>Do not</b>');
  });

  it('does not double-wrap existing data-hl spans', () => {
    const input = 'Deadline is <span data-hl="deadline">May 1</span> and expires in 30 days.';
    const result = enhanceHtml(input);
    // "May 1" should not be double-wrapped
    expect(result).not.toContain('data-hl="deadline"><span data-hl=');
    // "30 days" should be enhanced
    expect(result).toContain('30 days');
  });

  it('handles URLs', () => {
    const result = enhanceHtml('Visit password.company.com to reset.');
    expect(result).toContain('password.company.com');
  });

  it('highlights ext. numbers', () => {
    const result = enhanceHtml('Call ext. 4357 for help.');
    expect(result).toContain('data-hl="number"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- enhanceEngine`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement enhance engine**

Create `src/renderer/src/tabs/alerts/enhanceEngine.ts`:

```ts
// src/renderer/src/tabs/alerts/enhanceEngine.ts

type EnhanceRule = {
  pattern: RegExp;
  /** 'hl' wraps in data-hl span, 'bold' wraps in <b> */
  action: 'hl' | 'bold';
  type?: string; // for hl action
};

const RULES: EnhanceRule[] = [
  // --- Deadlines (yellow) ---
  {
    pattern: /\b\d+\s*(?:days?|hours?|minutes?|mins?|weeks?|months?)\b/gi,
    action: 'hl',
    type: 'deadline',
  },
  {
    pattern:
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}\b/gi,
    action: 'hl',
    type: 'deadline',
  },
  {
    pattern: /\b\d{1,2}:\d{2}\s*(?:UTC|EST|PST|CST|MST|AM|PM)\b/gi,
    action: 'hl',
    type: 'deadline',
  },
  {
    pattern: /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\w+\s+\d{1,2}\b/gi,
    action: 'hl',
    type: 'deadline',
  },

  // --- Warning (red) ---
  {
    pattern:
      /\b(?:complete |full |total )?(?:outage|failure|lockout|downtime|degradation|disruption)\b/gi,
    action: 'hl',
    type: 'warning',
  },
  { pattern: /\b(?:intermittent )?(?:connectivity )?failures?\b/gi, action: 'hl', type: 'warning' },

  // --- Success (green) ---
  {
    pattern: /\b(?:fully |has been )?(?:resolved|restored|operational|lifted)\b/gi,
    action: 'hl',
    type: 'success',
  },
  { pattern: /\boperating normally\b/gi, action: 'hl', type: 'success' },

  // --- Numbers (blue) ---
  { pattern: /\b\d+(?:\.\d+)?%/g, action: 'hl', type: 'number' },
  { pattern: /\bext\.?\s*\d+\b/gi, action: 'hl', type: 'number' },
  { pattern: /\b\d{1,3}(?:,\d{3})+\b/g, action: 'hl', type: 'number' },
  { pattern: /\b(?:>\s*)?\d+(?:\.\d+)?\s*(?:seconds?|sec|s)\b/gi, action: 'hl', type: 'number' },

  // --- Action words (bold) ---
  { pattern: /\b(?:Do not|do not|must|required|immediately|cannot)\b/g, action: 'bold' },
  { pattern: /\bAll deployments (?:are |have been )?frozen\b/gi, action: 'bold' },
];

/** Marker to track regions we've already wrapped so we don't double-wrap. */
const PLACEHOLDER_PREFIX = '\x00HL_';
const PLACEHOLDER_SUFFIX = '\x00';

/**
 * Apply semantic highlights to HTML string.
 * Skips text already inside data-hl spans (manual highlights).
 */
export function enhanceHtml(html: string): string {
  if (!html.trim()) return '';

  // Split HTML into segments: existing data-hl spans (protected) vs. everything else
  // This regex captures <span data-hl="...">...</span> as whole tokens
  const segments = html.split(/(<span data-hl="[^"]*">[\s\S]*?<\/span>)/g);

  const enhanced = segments.map((segment) => {
    // If this segment is an existing highlight span, leave it alone
    if (segment.startsWith('<span data-hl=')) return segment;

    // Split into HTML tags and text runs
    const parts = segment.split(/(<[^>]+>)/g);
    return parts
      .map((part) => {
        // Skip HTML tags
        if (part.startsWith('<')) return part;
        // Apply rules to text runs
        return applyRules(part);
      })
      .join('');
  });

  return enhanced.join('');
}

function applyRules(text: string): string {
  // Track which character positions are already wrapped
  const wrapped = new Array(text.length).fill(false);
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const rule of RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if any part of this range is already wrapped
      if (wrapped.slice(start, end).some(Boolean)) continue;

      // Mark as wrapped
      for (let i = start; i < end; i++) wrapped[i] = true;

      const content = match[0];
      let replacement: string;
      if (rule.action === 'hl' && rule.type) {
        replacement = `<span data-hl="${rule.type}">${content}</span>`;
      } else {
        replacement = `<b>${content}</b>`;
      }

      replacements.push({ start, end, replacement });
    }
  }

  // Apply replacements in reverse order to preserve indices
  replacements.sort((a, b) => b.start - a.start);
  let result = text;
  for (const { start, end, replacement } of replacements) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- enhanceEngine`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/alerts/enhanceEngine.ts src/renderer/src/tabs/__tests__/enhanceEngine.test.ts
git commit -m "feat(alerts): add rule-based enhance engine for semantic highlighting"
```

---

## Task 5: Card Layout Redesign — Meta Row & Footer

**Files:**

- Modify: `src/renderer/src/tabs/AlertCard.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

Changes: (1) Center FROM/TO with dot separator, auto-scale font for long text. (2) Replace thin color bar footer with logo (left) + timestamp (right).

- [ ] **Step 1: Update AlertCard imports and props**

In `AlertCard.tsx`, add `useRef` to the React import (line 1):

```ts
import React, { useMemo, useRef, useState, useEffect } from 'react';
```

Then add new props to the interface:

```ts
export interface AlertCardProps {
  cardRef: React.RefObject<HTMLDivElement | null>;
  severity: Severity;
  displaySubject: string;
  displaySender: string;
  displayRecipient: string;
  formattedDate: string;
  bodyHtml: string;
  logoDataUrl: string | null;
  /** When true, bodyHtml has been processed by compact+enhance pipeline */
  enhancedBodyHtml?: string;
  isEnhanced?: boolean;
  isCompact?: boolean;
}
```

- [ ] **Step 2: Rewrite meta row JSX**

Replace the existing `.alerts-email-meta` section with centered FROM/TO and dot separator. Add a ref to measure text width and compute font scaling:

```tsx
// Inside AlertCard component, add state for font scaling
const metaRef = useRef<HTMLDivElement>(null);
const [metaFontSize, setMetaFontSize] = useState(13);

useEffect(() => {
  if (!metaRef.current) return;
  const el = metaRef.current;
  // Reset to base size to measure natural width
  el.style.fontSize = '13px';
  const overflow = el.scrollWidth > el.clientWidth;
  if (!overflow) {
    setMetaFontSize(13);
    return;
  }
  // Try smaller sizes
  for (const size of [11, 9.5]) {
    el.style.fontSize = `${size}px`;
    if (el.scrollWidth <= el.clientWidth) {
      setMetaFontSize(size);
      return;
    }
  }
  setMetaFontSize(9.5);
}, [displaySender, displayRecipient]);
```

New JSX for meta row:

```tsx
<div className="alerts-email-meta" ref={metaRef} style={{ fontSize: `${metaFontSize}px` }}>
  <div className="alerts-email-meta-center">
    <div className="alerts-email-meta-item">
      FROM <span>{displaySender}</span>
    </div>
    <span className="alerts-email-meta-dot" />
    <div className="alerts-email-meta-item">
      TO <span>{displayRecipient}</span>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Rewrite footer JSX**

Replace the thin color bar footer. Use spacer only for now — Task 10 adds the `footerLogoDataUrl` prop and logo display:

```tsx
<div className="alerts-email-footer">
  {/* Footer logo added in Task 10 — spacer placeholder for now */}
  <div className="alerts-email-footer-spacer" />
  <div className="alerts-email-footer-timestamp">{formattedDate}</div>
</div>
```

- [ ] **Step 4: Use enhanced body when toggled on**

```tsx
const renderedBody = (isEnhanced || isCompact) && enhancedBodyHtml ? enhancedBodyHtml : safeHtml;

// In the JSX:
<div
  className={`alerts-email-body${hasContent ? '' : ' empty'}`}
  dangerouslySetInnerHTML={{ __html: renderedBody }}
/>;
```

- [ ] **Step 5: Add CSS for new layout**

Add to `alerts.css`:

```css
/* Centered meta row */
.alerts-email-meta {
  padding: 14px 36px;
  background: #fafafa;
  border-bottom: 1px solid #eaeaea;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.alerts-email-meta-center {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}

.alerts-email-meta-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #bbb;
  flex-shrink: 0;
}

/* Footer with logo + timestamp */
.alerts-email-footer {
  padding: 14px 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #eaeaea;
  background: #fafafa;
}

.alerts-email-footer-logo {
  height: 22px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
  opacity: 0.55;
}

.alerts-email-footer-spacer {
  width: 1px;
}

.alerts-email-footer-timestamp {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: #888;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* Highlight pill styles (used in card body) */
.alerts-email-body [data-hl='deadline'] {
  background: #fff3cd;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  color: #856404;
}

.alerts-email-body [data-hl='warning'] {
  background: #fee2e2;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  color: #991b1b;
}

.alerts-email-body [data-hl='success'] {
  background: #d1fae5;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  color: #065f46;
}

.alerts-email-body [data-hl='number'] {
  font-weight: 700;
  color: #1565c0;
}

.alerts-email-body [data-hl='service'] {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.9em;
  background: #f0f0f5;
  padding: 1px 6px;
  border-radius: 3px;
  color: #333;
}
```

- [ ] **Step 6: Remove old CSS that conflicts**

**Replace or remove** these old CSS blocks from `alerts.css` (replaced by the new ones added in Step 5):

- `.alerts-email-meta` (lines 572-579) — **replace entirely** with the new centered version above
- `.alerts-email-meta-left` (lines 581-585) — **delete** (no longer exists in JSX)
- `.alerts-email-meta-date` (lines 601-607) — **delete** (timestamp moved to footer)
- `.alerts-email-footer` (lines 635-639) — **replace entirely** with the new footer-with-logo version above

Keep `.alerts-email-meta-item` and `.alerts-email-meta-item span` unchanged — they're reused in the new layout.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/tabs/AlertCard.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat(alerts): redesign card layout — centered meta, footer with logo+timestamp"
```

---

## Task 6: Wire Compact + Enhance Toggles in AlertsTab

**Files:**

- Modify: `src/renderer/src/tabs/AlertsTab.tsx`

Add state for the two toggles and compute the enhanced body HTML through the pipeline.

- [ ] **Step 1: Add state and pipeline**

In `AlertsTab.tsx`, add:

```ts
import { compactText } from './alerts/compactEngine';
import { enhanceHtml } from './alerts/enhanceEngine';

// Inside AlertsTab component:
const [isCompact, setIsCompact] = useState(false);
const [isEnhanced, setIsEnhanced] = useState(false);

/**
 * Apply compact rules to HTML while preserving markup (including data-hl spans).
 * Strategy: split HTML into tags and text runs, only compact the text runs.
 * This preserves all <span data-hl>, <b>, <br>, etc.
 */
function compactHtml(html: string): string {
  // Split into HTML tags and text segments
  const parts = html.split(/(<[^>]+>)/g);
  return parts
    .map((part) => {
      // Skip HTML tags — pass through unchanged
      if (part.startsWith('<')) return part;
      // Apply compact rules to text content only
      return compactText(part);
    })
    .join('');
}

const enhancedBodyHtml = useMemo(() => {
  // Always sanitize first to prevent XSS, then apply processing
  let html = sanitizeHtml(bodyHtml);
  if (isCompact) {
    // Compact text runs within HTML, preserving all markup (including manual highlights)
    html = compactHtml(html);
  }
  if (isEnhanced) {
    html = enhanceHtml(html);
  }
  return html;
}, [bodyHtml, isCompact, isEnhanced]);
```

- [ ] **Step 2: Pass new props to AlertCard**

```tsx
<AlertCard
  cardRef={cardRef}
  severity={severity}
  displaySubject={displaySubject}
  displaySender={displaySender}
  displayRecipient={displayRecipient}
  formattedDate={formattedDate}
  bodyHtml={bodyHtml}
  logoDataUrl={logoDataUrl}
  enhancedBodyHtml={enhancedBodyHtml}
  isEnhanced={isEnhanced}
  isCompact={isCompact}
/>
```

- [ ] **Step 3: Pass toggle state setters to AlertForm**

Add props to AlertForm for the toggles (they'll be rendered in the toolbar):

```tsx
<AlertForm
  ref={formRef}
  // ... existing props ...
  isCompact={isCompact}
  setIsCompact={setIsCompact}
  isEnhanced={isEnhanced}
  setIsEnhanced={setIsEnhanced}
/>
```

- [ ] **Step 4: Update AlertForm props interface and destructure**

In `AlertForm.tsx`, add the new props to the interface and destructure them (they'll be threaded to AlertBodyEditor in Task 8):

```ts
interface AlertFormProps {
  // ... existing props ...
  isCompact: boolean;
  setIsCompact: (v: boolean) => void;
  isEnhanced: boolean;
  setIsEnhanced: (v: boolean) => void;
}
```

Add to the destructured props in the component (line 33-51):

```ts
// Add to existing destructuring:
isCompact,
setIsCompact,
isEnhanced,
setIsEnhanced,
```

And pass them to `AlertBodyEditor` (will be consumed in Task 8, but thread now to avoid TypeScript errors):

```tsx
<AlertBodyEditor
  ref={bodyEditorRef}
  setBodyHtml={setBodyHtml}
  isCompact={isCompact}
  setIsCompact={setIsCompact}
  isEnhanced={isEnhanced}
  setIsEnhanced={setIsEnhanced}
/>
```

**Note:** This means `AlertBodyEditor`'s props interface must also be updated in this step (not deferred to Task 8). Update `AlertBodyEditorProps` now:

```ts
interface AlertBodyEditorProps {
  setBodyHtml: (s: string) => void;
  isCompact: boolean;
  setIsCompact: (v: boolean) => void;
  isEnhanced: boolean;
  setIsEnhanced: (v: boolean) => void;
}
```

Add to AlertBodyEditor's destructured props (they'll be wired into UI in Task 8):

```ts
({ setBodyHtml, isCompact, setIsCompact, isEnhanced, setIsEnhanced }, ref) => {
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/AlertForm.tsx src/renderer/src/tabs/alerts/AlertBodyEditor.tsx
git commit -m "feat(alerts): wire compact+enhance toggle state and processing pipeline"
```

---

## Task 7: Highlight Popover Component

**Files:**

- Create: `src/renderer/src/tabs/alerts/HighlightPopover.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

A dropdown popover triggered by a toolbar button, showing 5 highlight swatches + clear + keyboard shortcuts.

- [ ] **Step 1: Create HighlightPopover component**

```tsx
// src/renderer/src/tabs/alerts/HighlightPopover.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { HIGHLIGHTS, type HighlightType } from './highlightColors';

interface HighlightPopoverProps {
  onApply: (type: HighlightType) => void;
  onClear: () => void;
}

export const HighlightPopover: React.FC<HighlightPopoverProps> = ({ onApply, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleApply = useCallback(
    (type: HighlightType) => {
      onApply(type);
      setIsOpen(false);
    },
    [onApply],
  );

  const handleClear = useCallback(() => {
    onClear();
    setIsOpen(false);
  }, [onClear]);

  return (
    <div className="alerts-hl-popover-wrapper" ref={popoverRef}>
      <button
        type="button"
        className={`alerts-fmt-btn alerts-hl-trigger${isOpen ? ' open' : ''}`}
        title="Highlight text"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsOpen((v) => !v);
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
        </svg>
        <span className="alerts-hl-dots">
          {HIGHLIGHTS.map((h) => (
            <span key={h.type} className="alerts-hl-dot" style={{ background: h.bg }} />
          ))}
        </span>
        <span className="alerts-hl-arrow">{isOpen ? '\u25B4' : '\u25BE'}</span>
      </button>

      {isOpen && (
        <div className="alerts-hl-popover">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.type}
              type="button"
              className="alerts-hl-popover-row"
              onMouseDown={(e) => {
                e.preventDefault();
                handleApply(h.type);
              }}
            >
              <span className="alerts-hl-popover-swatch" style={{ background: h.bg }} />
              <span className="alerts-hl-popover-label">{h.label}</span>
              <span className="alerts-hl-popover-key">
                {'\u2318'}
                {h.shortcutKey}
              </span>
            </button>
          ))}
          <div className="alerts-hl-popover-divider" />
          <button
            type="button"
            className="alerts-hl-popover-row"
            onMouseDown={(e) => {
              e.preventDefault();
              handleClear();
            }}
          >
            <span className="alerts-hl-popover-swatch alerts-hl-popover-clear-swatch">✕</span>
            <span className="alerts-hl-popover-label">Remove</span>
            <span className="alerts-hl-popover-key">{'\u2318'}0</span>
          </button>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Add popover CSS**

Add to `alerts.css`:

```css
/* Highlight Popover */
.alerts-hl-popover-wrapper {
  position: relative;
}

.alerts-hl-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  min-width: auto;
}

.alerts-hl-trigger.open {
  background: var(--color-bg-card-hover);
  color: var(--color-text-primary);
}

.alerts-hl-dots {
  display: flex;
  gap: 2px;
}

.alerts-hl-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: block;
}

.alerts-hl-arrow {
  font-size: 8px;
  color: var(--color-text-quaternary);
  margin-left: 1px;
}

.alerts-hl-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  z-index: 10;
  min-width: 170px;
}

.alerts-hl-popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  font-family: inherit;
  color: var(--color-text-secondary);
  transition: background 0.1s;
}

.alerts-hl-popover-row:hover {
  background: var(--color-bg-card-hover);
}

.alerts-hl-popover-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  flex-shrink: 0;
}

.alerts-hl-popover-clear-swatch {
  border: 2px dashed var(--color-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--color-text-quaternary);
  background: transparent;
}

.alerts-hl-popover-label {
  font-family: var(--font-family-mono);
  font-size: var(--text-2xs);
  font-weight: 500;
  letter-spacing: 0.04em;
  flex: 1;
}

.alerts-hl-popover-key {
  font-family: var(--font-family-mono);
  font-size: var(--text-2xs);
  color: var(--color-text-quaternary);
}

.alerts-hl-popover-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 4px 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/tabs/alerts/HighlightPopover.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat(alerts): add highlight popover component with 5 semantic colors"
```

---

## Task 8: Integrate Toolbar — Popover + Compact + Enhance Toggles

**Files:**

- Modify: `src/renderer/src/tabs/alerts/AlertBodyEditor.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

Add the highlight popover, compact toggle, and enhance toggle to the existing body editor toolbar.

- [ ] **Step 1: Add highlight apply/clear handlers**

AlertBodyEditor props were already updated in Task 6 Step 4. Now add the highlight handlers:

```ts
import { HighlightPopover } from './HighlightPopover';
import { HIGHLIGHTS, type HighlightType } from './highlightColors';

// Inside the component:
const applyHighlight = useCallback(
  (type: HighlightType) => {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.setAttribute('data-hl', type);
    try {
      range.surroundContents(span);
    } catch {
      // surroundContents throws if selection crosses element boundaries — silently ignore
      return;
    }
    handleBodyInput();
  },
  [handleBodyInput],
);

const clearHighlight = useCallback(() => {
  editorRef.current?.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const node = selection.anchorNode?.parentElement;
  if (node?.hasAttribute('data-hl')) {
    const parent = node.parentNode;
    while (node.firstChild) parent?.insertBefore(node.firstChild, node);
    parent?.removeChild(node);
    handleBodyInput();
  }
}, [handleBodyInput]);
```

- [ ] **Step 2: Add keyboard shortcuts**

```ts
// Inside the component, add a keydown handler:
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    const key = e.key;
    if (key >= '1' && key <= '5') {
      e.preventDefault();
      const idx = parseInt(key) - 1;
      if (HIGHLIGHTS[idx]) applyHighlight(HIGHLIGHTS[idx].type);
    } else if (key === '0') {
      e.preventDefault();
      clearHighlight();
    }
  },
  [applyHighlight, clearHighlight],
);

// Add onKeyDown={handleKeyDown} to the editable div
```

- [ ] **Step 3: Add popover and toggles to toolbar JSX**

After the existing list buttons and separator, add:

```tsx
<span className="alerts-fmt-separator" />
<HighlightPopover onApply={applyHighlight} onClear={clearHighlight} />
<span className="alerts-fmt-separator" />
<button
  type="button"
  className={`alerts-fmt-btn alerts-toggle-btn alerts-toggle-compact${isCompact ? ' active' : ''}`}
  title="Compact — strip filler phrases"
  onMouseDown={(e) => {
    e.preventDefault();
    setIsCompact(!isCompact);
  }}
>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
</button>
<button
  type="button"
  className={`alerts-fmt-btn alerts-toggle-btn alerts-toggle-enhance${isEnhanced ? ' active' : ''}`}
  title="Enhance — auto-highlight key info"
  onMouseDown={(e) => {
    e.preventDefault();
    setIsEnhanced(!isEnhanced);
  }}
>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z" />
  </svg>
</button>
```

- [ ] **Step 4: Add toggle CSS**

```css
/* Compact/Enhance toggle buttons */
.alerts-toggle-btn {
  padding: 0 6px;
}

.alerts-toggle-compact.active {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.alerts-toggle-enhance.active {
  background: rgba(124, 92, 252, 0.15);
  color: #a78bfa;
}
```

- [ ] **Step 5: Commit**

(Props already threaded from AlertForm → AlertBodyEditor in Task 6 Step 4.)

```bash
git add src/renderer/src/tabs/alerts/AlertBodyEditor.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat(alerts): integrate highlight popover + compact/enhance toggles into toolbar"
```

---

## Task 9: Event Time Field — Amber Banner (Replaces Timestamp Override)

**Files:**

- Create: `src/renderer/src/tabs/alerts/EventTimeBanner.tsx`
- Create: `src/renderer/src/tabs/__tests__/EventTimeBanner.test.tsx`
- Modify: `src/renderer/src/tabs/AlertCard.tsx`
- Modify: `src/renderer/src/tabs/AlertForm.tsx`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

Replaces the old `customTimestamp` override with a proper Event Time that shows when something is scheduled to happen. Displayed as an amber banner below the subject line. Context labels change based on severity: MAINTENANCE → "Scheduled", ISSUE → "Started", INFO → "When", RESOLVED → "Duration".

- [ ] **Step 1: Write failing tests for EventTimeBanner**

Create `src/renderer/src/tabs/__tests__/EventTimeBanner.test.tsx`:

**Note:** Tests must use UTC ISO strings (with `Z` suffix) because:

- `localToIso()` in AlertsTab produces UTC ISO strings
- The component formats these in `America/Chicago`
- jsdom defaults to UTC, so bare datetime strings would be misinterpreted
- April dates use CDT (UTC-5), March dates may use CST (UTC-6)

```tsx
import { render, screen } from '@testing-library/react';
import { EventTimeBanner } from '../alerts/EventTimeBanner';

describe('EventTimeBanner', () => {
  it('renders nothing when no event time is provided', () => {
    const { container } = render(<EventTimeBanner severity="MAINTENANCE" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Scheduled" label for MAINTENANCE severity', () => {
    // 07:00 UTC = 02:00 CDT (April = CDT, UTC-5)
    render(<EventTimeBanner severity="MAINTENANCE" startTime="2026-04-05T07:00:00Z" />);
    expect(screen.getByText('Scheduled')).toBeTruthy();
  });

  it('renders "Started" label for ISSUE severity', () => {
    render(<EventTimeBanner severity="ISSUE" startTime="2026-03-25T19:15:00Z" />);
    expect(screen.getByText('Started')).toBeTruthy();
  });

  it('renders "When" label for INFO severity', () => {
    render(<EventTimeBanner severity="INFO" startTime="2026-04-01T14:00:00Z" />);
    expect(screen.getByText('When')).toBeTruthy();
  });

  it('renders "Duration" label for RESOLVED severity', () => {
    render(<EventTimeBanner severity="RESOLVED" startTime="2026-03-25T16:00:00Z" />);
    expect(screen.getByText('Duration')).toBeTruthy();
  });

  it('shows start and end time range when both provided', () => {
    // 07:00 UTC = 02:00 CDT, 11:00 UTC = 06:00 CDT
    render(
      <EventTimeBanner
        severity="MAINTENANCE"
        startTime="2026-04-05T07:00:00Z"
        endTime="2026-04-05T11:00:00Z"
      />,
    );
    expect(screen.getByText(/02:00/)).toBeTruthy();
    expect(screen.getByText(/06:00/)).toBeTruthy();
  });

  it('shows only start time when no end time', () => {
    // 19:15 UTC = 14:15 CDT (March 25 2026 is CDT)
    render(<EventTimeBanner severity="ISSUE" startTime="2026-03-25T19:15:00Z" />);
    expect(screen.getByText(/14:15/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- EventTimeBanner`
Expected: FAIL (module not found)

- [ ] **Step 3: Create EventTimeBanner component**

```tsx
// src/renderer/src/tabs/alerts/EventTimeBanner.tsx
import React from 'react';
import type { Severity } from '../alertUtils';

const CONTEXT_LABELS: Record<Severity, string> = {
  MAINTENANCE: 'Scheduled',
  ISSUE: 'Started',
  INFO: 'When',
  RESOLVED: 'Duration',
};

const CONTEXT_ICONS: Record<Severity, string> = {
  MAINTENANCE: '📅',
  ISSUE: '⏰',
  INFO: '📌',
  RESOLVED: '✅',
};

interface EventTimeBannerProps {
  severity: Severity;
  startTime?: string;
  endTime?: string;
}

const CENTRAL_TZ = 'America/Chicago';

function formatEventDateTime(isoString: string): string {
  const date = new Date(isoString);
  return (
    date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: CENTRAL_TZ,
    }) +
    ' · ' +
    date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: CENTRAL_TZ,
      timeZoneName: 'short',
    })
  );
}

function formatTimeOnly(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CENTRAL_TZ,
    timeZoneName: 'short',
  });
}

export const EventTimeBanner: React.FC<EventTimeBannerProps> = ({
  severity,
  startTime,
  endTime,
}) => {
  if (!startTime) return null;

  const label = CONTEXT_LABELS[severity];
  const icon = CONTEXT_ICONS[severity];

  // If start and end are on the same day *in Central Time*, show compact "date · start – end"
  const endDate = endTime ? new Date(endTime) : null;
  const sameDay =
    endDate &&
    (() => {
      // Compare dates in Central Time, not system-local
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { timeZone: CENTRAL_TZ });
      return fmt(new Date(startTime)) === fmt(endDate);
    })();

  let timeDisplay: string;
  if (endDate && sameDay) {
    timeDisplay = formatEventDateTime(startTime).replace(
      /(\d{2}:\d{2}\s*\w+)$/,
      `$1 – ${formatTimeOnly(endTime!)}`,
    );
  } else if (endDate) {
    timeDisplay = `${formatEventDateTime(startTime)} – ${formatEventDateTime(endTime!)}`;
  } else {
    timeDisplay = formatEventDateTime(startTime);
  }

  return (
    <div className="alerts-email-event-time">
      <span className="alerts-email-event-time-icon">{icon}</span>
      <span className="alerts-email-event-time-label">{label}</span>
      <span className="alerts-email-event-time-value">{timeDisplay}</span>
    </div>
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose -- EventTimeBanner`
Expected: All PASS

- [ ] **Step 5: Add amber banner CSS**

Add to `alerts.css`:

```css
/* Event Time Banner — amber strip below subject */
.alerts-email-event-time {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 36px;
  background: linear-gradient(135deg, #fff8e1 0%, #fff3cd 100%);
  border-bottom: 1px solid #f0dca0;
  font-size: 12.5px;
}

.alerts-email-event-time-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.alerts-email-event-time-label {
  font-weight: 700;
  color: #856404;
  text-transform: uppercase;
  font-size: 10.5px;
  letter-spacing: 0.06em;
}

.alerts-email-event-time-value {
  color: #6d5200;
  font-weight: 500;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 6: Wire into AlertCard — place banner below subject, above meta row**

In `AlertCard.tsx`, import and render EventTimeBanner:

```tsx
import { EventTimeBanner } from './alerts/EventTimeBanner';

// Add to props interface:
eventTimeStart?: string;
eventTimeEnd?: string;

// In the JSX, after the subject and before the meta row:
// Props are already ISO strings (converted by AlertsTab), so banner formats in Central Time
<EventTimeBanner
  severity={severity}
  startTime={eventTimeStart}
  endTime={eventTimeEnd}
/>
```

- [ ] **Step 7: Replace timestamp override with Event Time inputs in AlertForm**

In `AlertForm.tsx`:

- Remove `customTimestamp: string` and `setCustomTimestamp: (s: string) => void` from the `AlertFormProps` interface
- Remove them from the destructured props (lines 45-46)
- Remove the entire "Timestamp Override" field JSX (lines 155-179)
- Add the following new props to `AlertFormProps`:

```ts
// Replace customTimestamp/setCustomTimestamp with:
eventTimeStart: string;
setEventTimeStart: (s: string) => void;
eventTimeEnd: string;
setEventTimeEnd: (s: string) => void;
eventTimeSourceTz: string;
setEventTimeSourceTz: (s: string) => void;
```

Destructure the new props in the component and add the Event Time field JSX:

```tsx
{
  /* Event Time — replaces old timestamp override */
}
<div className="alerts-field">
  <label className="alerts-field-label">
    Event Time <span className="alerts-optional-tag">OPTIONAL</span>
  </label>
  <div className="alerts-event-time-inputs">
    <div className="alerts-event-time-input-group">
      <label className="alerts-event-time-sublabel">Start</label>
      <input
        type="datetime-local"
        className="alerts-input alerts-input-datetime"
        value={eventTimeStart}
        onChange={(e) => setEventTimeStart(e.target.value)}
      />
    </div>
    <div className="alerts-event-time-input-group">
      <label className="alerts-event-time-sublabel">
        End <span className="alerts-optional-tag">OPTIONAL</span>
      </label>
      <input
        type="datetime-local"
        className="alerts-input alerts-input-datetime"
        value={eventTimeEnd}
        onChange={(e) => setEventTimeEnd(e.target.value)}
      />
    </div>
    <div className="alerts-event-time-input-group">
      <label className="alerts-event-time-sublabel">Source TZ</label>
      <select
        className="alerts-input alerts-event-time-tz"
        value={eventTimeSourceTz}
        onChange={(e) => setEventTimeSourceTz(e.target.value)}
      >
        <option value="America/Chicago">CT (CST/CDT)</option>
        <option value="America/New_York">ET (EST/EDT)</option>
        <option value="America/Denver">MT (MST/MDT)</option>
        <option value="America/Los_Angeles">PT (PST/PDT)</option>
        <option value="UTC">UTC</option>
        <option value="Europe/London">GMT/BST</option>
        <option value="Europe/Berlin">CET/CEST</option>
        <option value="Asia/Tokyo">JST</option>
        <option value="Asia/Kolkata">IST</option>
        <option value="Australia/Sydney">AEST/AEDT</option>
      </select>
    </div>
    {(eventTimeStart || eventTimeEnd) && (
      <button
        type="button"
        className="alerts-event-time-clear"
        onClick={() => {
          setEventTimeStart('');
          setEventTimeEnd('');
        }}
      >
        Clear
      </button>
    )}
  </div>
  <span className="alerts-event-time-hint">
    Enter times in the source timezone — they'll display as Central Time on the card
  </span>
</div>;
```

- [ ] **Step 8: Add Event Time state to AlertsTab**

In `AlertsTab.tsx`:

- Remove `customTimestamp` state (`useState('')` on line 37)
- Remove `setCustomTimestamp` from `AlertForm` props (line 367)
- Remove `customTimestamp` from `AlertForm` props (line 366)
- In `handleLoadFromHistory` (line 159): remove `setCustomTimestamp('')`, add `setEventTimeStart(''); setEventTimeEnd('');` to clear event time when loading history
- In `handleClear` (line 170): remove `setCustomTimestamp('')`, add `setEventTimeStart(''); setEventTimeEnd('');`
- In the `useEffect` timer (line 62): remove the `if (customTimestamp) return;` guard and `customTimestamp` from deps — timer should always run now
- Add `eventTimeStart`, `eventTimeEnd`, `eventTimeSourceTz` state
- **Replace** the existing `formattedDate` useMemo (lines 67-78) entirely with the new Central Time version below — the old one references `customTimestamp` which no longer exists
- Pass new props to AlertCard and AlertForm

Also update `AlertForm.tsx`:

- Remove `customTimestamp` and `setCustomTimestamp` from `AlertFormProps` interface
- Remove the old "Timestamp Override" field JSX (lines 155-179)
- Add new Event Time props: `eventTimeStart`, `setEventTimeStart`, `eventTimeEnd`, `setEventTimeEnd`, `eventTimeSourceTz`, `setEventTimeSourceTz`

```ts
const [eventTimeStart, setEventTimeStart] = useState('');
const [eventTimeEnd, setEventTimeEnd] = useState('');
const [eventTimeSourceTz, setEventTimeSourceTz] = useState('America/Chicago');

/**
 * Convert a datetime-local value from the source timezone to an ISO string.
 * datetime-local gives us "2026-04-05T02:00" with no timezone info,
 * so we interpret it as if the user typed it in `sourceTz` and produce UTC ISO.
 *
 * Strategy: `new Date(datetimeLocal)` parses as system-local time.
 * We find the difference between system-local and sourceTz at that instant,
 * then adjust so the result represents the same wall-clock in sourceTz.
 */
function localToIso(datetimeLocal: string, sourceTz: string): string {
  if (!datetimeLocal) return '';
  const systemLocal = new Date(datetimeLocal);
  if (Number.isNaN(systemLocal.getTime())) return '';
  // What does this instant look like in the source TZ?
  // Note: toLocaleString('en-US') -> new Date() round-trip relies on en-US producing
  // a parseable format ("M/D/YYYY, H:MM:SS AM/PM"). Reliable in Electron (ships full ICU).
  const inSourceTz = new Date(systemLocal.toLocaleString('en-US', { timeZone: sourceTz }));
  // offsetMs = how far system-local is ahead of sourceTz representation
  const offsetMs = systemLocal.getTime() - inSourceTz.getTime();
  return new Date(systemLocal.getTime() + offsetMs).toISOString();
}

const eventTimeStartIso = useMemo(
  () => localToIso(eventTimeStart, eventTimeSourceTz),
  [eventTimeStart, eventTimeSourceTz],
);
const eventTimeEndIso = useMemo(
  () => localToIso(eventTimeEnd, eventTimeSourceTz),
  [eventTimeEnd, eventTimeSourceTz],
);

// Pass converted ISO values to AlertCard (not raw input values):
// <AlertCard ... eventTimeStart={eventTimeStartIso} eventTimeEnd={eventTimeEndIso} />
//
// Pass raw values + setters to AlertForm:
// <AlertForm ... eventTimeStart={eventTimeStart} setEventTimeStart={setEventTimeStart}
//   eventTimeEnd={eventTimeEnd} setEventTimeEnd={setEventTimeEnd}
//   eventTimeSourceTz={eventTimeSourceTz} setEventTimeSourceTz={setEventTimeSourceTz} />

// formattedDate now always uses live time in Central Time (CST/CDT):
const formattedDate = useMemo(() => {
  return (
    now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Chicago',
    }) +
    ' · ' +
    now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    })
  );
}, [now]);
```

- [ ] **Step 9: Add event time input CSS**

```css
/* Event Time inputs */
.alerts-event-time-inputs {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.alerts-event-time-input-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.alerts-event-time-sublabel {
  font-size: 10px;
  color: var(--color-text-quaternary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.alerts-event-time-tz {
  min-width: 110px;
  font-size: 11px;
}

.alerts-event-time-clear {
  font-size: 11px;
  color: var(--color-text-tertiary);
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  align-self: flex-end;
  margin-bottom: 2px;
  transition: all 0.15s;
}

.alerts-event-time-clear:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-primary);
}

.alerts-event-time-hint {
  font-size: 10.5px;
  color: var(--color-text-quaternary);
  margin-top: 3px;
}
```

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/tabs/alerts/EventTimeBanner.tsx src/renderer/src/tabs/__tests__/EventTimeBanner.test.tsx src/renderer/src/tabs/AlertCard.tsx src/renderer/src/tabs/AlertForm.tsx src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat(alerts): add Event Time field with amber banner — replaces timestamp override"
```

---

## Task 10: Separate Footer Logo Upload (with IPC Persistence)

**Files:**

- Modify: `src/shared/ipc.ts` — add IPC channels + API types for footer logo
- Modify: `src/preload/index.ts` — expose footer logo IPC methods
- Modify: `src/main/handlers/windowHandlers.ts` — add handlers (mirror header logo pattern, save as `footer-logo.png`)
- Modify: `src/renderer/src/tabs/AlertCard.tsx` — use `footerLogoDataUrl` in footer
- Modify: `src/renderer/src/tabs/AlertForm.tsx` — add footer logo upload section (uses same AlertLogoUpload pattern)
- Modify: `src/renderer/src/tabs/AlertsTab.tsx` — add state + IPC load/save/remove handlers
- Modify: `src/renderer/src/tabs/alerts.css` — footer logo preview styles

The footer logo must persist across sessions, just like the header logo. We mirror the same IPC pattern: native file dialog → resize → save to `assets/footer-logo.png` → return data URL.

- [ ] **Step 1: Add IPC channels for footer logo**

In `src/shared/ipc.ts`, add to `IPC_CHANNELS`:

```ts
SAVE_FOOTER_LOGO: 'alert:saveFooterLogo',
GET_FOOTER_LOGO: 'alert:getFooterLogo',
REMOVE_FOOTER_LOGO: 'alert:removeFooterLogo',
```

Add to the API interface:

```ts
saveFooterLogo: () => Promise<IpcResult<string>>;
getFooterLogo: () => Promise<string | null>;
removeFooterLogo: () => Promise<IpcResult>;
```

- [ ] **Step 2: Add preload bridge**

In `src/preload/index.ts`, add (next to the existing company logo methods):

```ts
saveFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FOOTER_LOGO),
getFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_FOOTER_LOGO),
removeFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FOOTER_LOGO),
```

- [ ] **Step 3: Add main process handlers**

In `src/main/handlers/windowHandlers.ts`, add handlers mirroring the company logo ones (right after the `REMOVE_COMPANY_LOGO` handler). The only differences: channel names and filename `footer-logo.png` instead of `company-logo.png`.

```ts
// Footer Logo — save, get, remove (mirrors company logo pattern)
ipcMain.handle(IPC_CHANNELS.SAVE_FOOTER_LOGO, async () => {
  if (!getDataRoot) return { success: false, error: 'Data root not available' };
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Footer Logo',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { success: false, error: 'Cancelled' };

    const buf = await readFile(filePaths[0]);
    if (buf.length > MAX_LOGO_SIZE) {
      return { success: false, error: 'Image must be under 2MB' };
    }

    let image = nativeImage.createFromBuffer(buf);
    if (image.isEmpty()) return { success: false, error: 'Invalid image file' };

    const { width } = image.getSize();
    if (width > MAX_LOGO_WIDTH) {
      image = image.resize({ width: MAX_LOGO_WIDTH });
    }

    const assetsDir = join(await getDataRoot(), 'assets');
    await mkdir(assetsDir, { recursive: true });
    const logoPath = join(assetsDir, 'footer-logo.png');
    const pngBuffer = image.toPNG();
    await writeFile(logoPath, pngBuffer);

    const dataUrl = 'data:image/png;base64,' + pngBuffer.toString('base64');
    return { success: true, data: dataUrl };
  } catch (err) {
    loggers.ipc.warn('Footer logo save failed', {
      error: getErrorMessage(err),
    });
    return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
  }
});

ipcMain.handle(IPC_CHANNELS.GET_FOOTER_LOGO, async () => {
  if (!getDataRoot) return null;
  try {
    const logoPath = join(await getDataRoot(), 'assets', 'footer-logo.png');
    const buf = await readFile(logoPath);
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch {
    return null;
  }
});

ipcMain.handle(IPC_CHANNELS.REMOVE_FOOTER_LOGO, async () => {
  if (!getDataRoot) return { success: false, error: 'Data root not available' };
  try {
    const logoPath = join(await getDataRoot(), 'assets', 'footer-logo.png');
    await unlink(logoPath);
    return { success: true };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
      return { success: true };
    return { success: false, error: err instanceof Error ? err.message : 'Remove failed' };
  }
});
```

- [ ] **Step 4: Add footer logo state + IPC handlers to AlertsTab**

In `AlertsTab.tsx`:

```ts
const [footerLogoDataUrl, setFooterLogoDataUrl] = useState<string | null>(null);

// Load persisted footer logo on mount (add to existing useEffect or create new one)
useEffect(() => {
  void globalThis.api
    ?.getFooterLogo()
    .then((url) => {
      if (url) setFooterLogoDataUrl(url);
    })
    .catch(() => {});
}, []);

const handleSetFooterLogo = useCallback(async () => {
  const result = await globalThis.api?.saveFooterLogo();
  if (result?.success && result.data) {
    setFooterLogoDataUrl(result.data);
    showToast('Footer logo saved', 'success');
  } else if (result?.error && result.error !== 'Cancelled') {
    showToast(result.error, 'error');
  }
}, [showToast]);

const handleRemoveFooterLogo = useCallback(async () => {
  try {
    const result = await globalThis.api?.removeFooterLogo();
    if (result?.success === false) {
      showToast(result.error || 'Failed to remove footer logo', 'error');
      return;
    }
    setFooterLogoDataUrl(null);
  } catch {
    showToast('Failed to remove footer logo', 'error');
  }
}, [showToast]);
```

Pass to AlertCard and AlertForm:

```tsx
<AlertCard ... footerLogoDataUrl={footerLogoDataUrl} />
<AlertForm ...
  footerLogoDataUrl={footerLogoDataUrl}
  onSetFooterLogo={handleSetFooterLogo}
  onRemoveFooterLogo={handleRemoveFooterLogo}
/>
```

- [ ] **Step 5: Update AlertCard to use footerLogoDataUrl in footer**

In `AlertCard.tsx`, add `footerLogoDataUrl` to props and use it in the footer:

```tsx
// Props interface:
footerLogoDataUrl?: string | null;

// Footer JSX — use footerLogoDataUrl instead of logoDataUrl:
<div className="alerts-email-footer">
  {footerLogoDataUrl ? (
    <img src={footerLogoDataUrl} alt="" className="alerts-email-footer-logo" />
  ) : (
    <div className="alerts-email-footer-spacer" />
  )}
  <div className="alerts-email-footer-timestamp">{formattedDate}</div>
</div>
```

- [ ] **Step 6: Add footer logo upload section to AlertForm**

Add props to `AlertFormProps`:

```ts
footerLogoDataUrl: string | null;
onSetFooterLogo: () => void;
onRemoveFooterLogo: () => void;
```

Add JSX below the existing `AlertLogoUpload` component, reusing the same `AlertLogoUpload` component:

```tsx
{
  /* Footer Logo — separate upload, shown at original colors */
}
<div className="alerts-field">
  <span className="alerts-field-label">
    Footer Logo <span className="alerts-optional-tag">OPTIONAL</span>
  </span>
  <span className="alerts-field-hint">Shown at original colors in the card footer</span>
  <div className="alerts-logo-controls">
    {footerLogoDataUrl ? (
      <>
        <img src={footerLogoDataUrl} alt="Footer logo" className="alerts-logo-thumbnail" />
        <button type="button" className="alerts-logo-action" onClick={onRemoveFooterLogo}>
          REMOVE
        </button>
      </>
    ) : (
      <button type="button" className="alerts-logo-action" onClick={onSetFooterLogo}>
        UPLOAD
      </button>
    )}
  </div>
</div>;
```

- [ ] **Step 7: Add footer logo hint CSS**

```css
/* Field hint — used below label for supplementary info */
.alerts-field-hint {
  font-size: 10.5px;
  color: var(--color-text-quaternary);
  margin-top: -4px;
  margin-bottom: 6px;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/handlers/windowHandlers.ts src/renderer/src/tabs/AlertCard.tsx src/renderer/src/tabs/AlertForm.tsx src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat(alerts): add separate footer logo upload with IPC persistence"
```

---

## Task 11: Manual Testing & Cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd /home/claude/apps/Relay && npx vitest run -c vitest.renderer.config.ts --reporter=verbose
```

Expected: All tests pass.

- [ ] **Step 2: Run lint**

```bash
cd /home/claude/apps/Relay && npx eslint src/renderer/src/tabs/alerts/ src/renderer/src/tabs/AlertCard.tsx src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/alertUtils.tsx
```

Expected: No errors. Fix any issues.

- [ ] **Step 3: Run type check**

```bash
cd /home/claude/apps/Relay && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Visual verification**

Build and launch: `cd /home/claude/apps/Relay && npm run dev`

Verify:

- [ ] FROM/TO centered with dot separator
- [ ] Long FROM/TO text auto-scales to smaller font
- [ ] Timestamp appears in footer bottom-right
- [ ] Logo appears in footer bottom-left (if set)
- [ ] Compact toggle strips filler text, toggles off to revert
- [ ] Enhance toggle adds highlights, toggles off to revert
- [ ] Both toggles compose together
- [ ] Highlight popover opens/closes, swatches apply correctly
- [ ] Cmd+1–5 keyboard shortcuts work
- [ ] Manual highlights persist through compact/enhance toggling
- [ ] Copy for Outlook captures correct card with highlights
- [ ] Save PNG captures correct card
- [ ] Event Time inputs (Start + End) appear in form where timestamp override was
- [ ] Setting an event time shows amber banner below subject on card
- [ ] Banner label changes based on severity (Scheduled/Started/When/Duration)
- [ ] Banner always displays times in Central Time (CST/CDT)
- [ ] Entering a time in UTC and selecting UTC source TZ converts correctly to Central on card
- [ ] Entering a time in ET and selecting ET source TZ converts correctly to Central on card
- [ ] Source TZ defaults to CT (no conversion needed for most use)
- [ ] Clearing event time hides the banner
- [ ] Same-day range shows compact format (date · start – end)
- [ ] Footer logo upload is separate from header logo
- [ ] Footer logo displays at original colors in bottom-left
- [ ] Header logo still displays white in severity bar
- [ ] Card looks correct with no footer logo (spacer)
- [ ] Footer timestamp always shows live time (no override)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(alerts): complete alert card redesign — layout, compact, enhance, highlights"
```
