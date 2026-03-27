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

    // Split into HTML tags and text runs without backtracking regex
    return splitTagsAndText(segment)
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

/** Split a string into alternating text and HTML tag tokens without backtracking regex. */
function splitTagsAndText(input: string): string[] {
  const parts: string[] = [];
  let i = 0;
  let textStart = 0;

  while (i < input.length) {
    if (input[i] === '<') {
      // Flush text before the tag
      if (i > textStart) {
        parts.push(input.slice(textStart, i));
      }
      const tagStart = i;
      i++; // skip '<'
      while (i < input.length && input[i] !== '>') i++;
      i++; // skip '>'
      parts.push(input.slice(tagStart, i));
      textStart = i;
    } else {
      i++;
    }
  }

  // Flush remaining text
  if (textStart < input.length) {
    parts.push(input.slice(textStart));
  }

  return parts;
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
