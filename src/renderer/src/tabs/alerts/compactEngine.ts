// src/renderer/src/tabs/alerts/compactEngine.ts

/** Phrase replacement rule: [pattern, replacement]. Replacement '' means remove. */
type Rule = [RegExp, string];

/**
 * Ordered list of compact rules. Applied sequentially — order matters.
 * Rules that remove sentence-level padding run first, then phrase-level.
 */
/* eslint-disable sonarjs/slow-regex */
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
  [/\bapproximately\s*/gi, '~'],
  [/\beach and every\b/gi, 'every'],
  [/\bany and all\b/gi, 'all'],
  [/\bcurrently\s*/gi, ''],

  // --- Passive to active ---
  [/you may experience/gi, 'expect'],
  [/will be migrating/gi, 'migrating'],
  [/are\s+affected/gi, 'affected'],

  // --- Contact block compression ---
  [/(?:please )?(?:reach out to|contact)\s+the\s+/gi, 'Contact: '],
  [/\bat extension\b/gi, 'at ext.'],
];
/* eslint-enable sonarjs/slow-regex */

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
  // eslint-disable-next-line sonarjs/slow-regex
  result = result.replace(/\s+\./g, '.').replace(/\s+,/g, ',');

  // Remove trailing whitespace
  result = result.trim();

  // Remove trailing period if the result ends with just punctuation after stripping
  result = result.replace(/\.\s*$/, (m) => (result.length > 2 ? m : ''));

  return result;
}
