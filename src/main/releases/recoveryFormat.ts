import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

/** Formats and path checks shared by the recovery files that Relay and its native launcher read. */

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** A build ID that is also a safe Windows directory name. */
export function isBuildId(value: string): boolean {
  if (!BUILD_ID_PATTERN.test(value) || value.endsWith('.')) return false;
  return !RESERVED_WINDOWS_NAMES.has(value.split('.', 1)[0] ?? value);
}

/** Whether a resolved `child` is exactly `parent/expectedName`, with no redirection between. */
export function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const childRelative = relative(parent, child);
  return !isAbsolute(childRelative) && childRelative === expectedName;
}

/** Whether the bytes start with the MZ header every Windows executable has. */
export function isWindowsExecutableHeader(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

/** Whether an open file starts with the Windows executable header. */
export async function hasWindowsExecutableHeader(handle: FileHandle): Promise<boolean> {
  const magic = Buffer.alloc(2);
  const { bytesRead } = await handle.read(magic, 0, magic.byteLength, 0);
  return bytesRead === magic.byteLength && isWindowsExecutableHeader(magic);
}

export type IniSections = Map<string, Map<string, string>>;

/** The INI dialect a recovery file uses; each mirrors what its native reader accepts. */
export type IniGrammar = {
  maximumBytes: number;
  /** The longest raw line accepted; unlimited when omitted. */
  maximumLineLength?: number;
  /** Whether `;` and `#` lines are comments; otherwise they parse as entries. */
  comments: boolean;
  /** Whether a value containing a stray carriage return makes the file invalid. */
  rejectCarriageReturn?: boolean;
};

type IniEntry = { key: string; value: string };

/** Splits `key=value`, or returns null when the line has no key. */
function iniEntry(line: string): IniEntry | null {
  const separator = line.indexOf('=');
  if (separator <= 0) return null;
  const key = line.slice(0, separator).trim();
  return key ? { key, value: line.slice(separator + 1).trim() } : null;
}

function iniSectionName(line: string): string | null {
  return line.startsWith('[') && line.endsWith(']') ? line.slice(1, -1) : null;
}

function iniLines(text: string, maximumBytes: number): string[] | null {
  if (Buffer.byteLength(text, 'utf8') > maximumBytes || text.includes('\0')) return null;
  return text.split(/\r?\n/u);
}

function acceptIniLine(
  rawLine: string,
  grammar: IniGrammar,
  sections: IniSections,
  state: { current: Map<string, string> | null },
): boolean {
  if (grammar.maximumLineLength !== undefined && rawLine.length > grammar.maximumLineLength) {
    return false;
  }
  const line = rawLine.trim();
  if (!line || (grammar.comments && (line.startsWith(';') || line.startsWith('#')))) return true;
  const sectionName = iniSectionName(line);
  if (sectionName !== null) {
    if (!sectionName || sections.has(sectionName)) return false;
    state.current = new Map();
    sections.set(sectionName, state.current);
    return true;
  }
  const entry = iniEntry(line);
  if (!state.current || !entry || state.current.has(entry.key)) return false;
  if (grammar.rejectCarriageReturn && /[\r\n]/u.test(entry.value)) return false;
  state.current.set(entry.key, entry.value);
  return true;
}

/** Parses unique sections of unique keys; any malformed line makes the whole file invalid. */
export function parseIniSections(text: string, grammar: IniGrammar): IniSections | null {
  const lines = iniLines(text, grammar.maximumBytes);
  if (!lines) return null;
  const sections: IniSections = new Map();
  const state = { current: null as Map<string, string> | null };
  for (const rawLine of lines) {
    if (!acceptIniLine(rawLine, grammar, sections, state)) return null;
  }
  return sections;
}

function acceptExactSectionLine(
  rawLine: string,
  sectionName: string,
  expected: ReadonlySet<string>,
  values: Map<string, string>,
  state: { inSection: boolean },
): boolean {
  if (rawLine.length > 4_096) return false;
  const line = rawLine.trim();
  if (!line) return true;
  if (iniSectionName(line) !== null) {
    if (state.inSection || line !== `[${sectionName}]`) return false;
    state.inSection = true;
    return true;
  }
  const entry = iniEntry(line);
  if (!state.inSection || !entry || !expected.has(entry.key) || values.has(entry.key)) {
    return false;
  }
  values.set(entry.key, entry.value);
  return true;
}

/**
 * Parses a file holding exactly one `[sectionName]` with exactly `expectedKeys`, without
 * comments, in lines of at most 4,096 characters.
 */
export function parseExactIniSection(
  text: string,
  sectionName: string,
  expectedKeys: readonly string[],
  maximumBytes: number,
): Map<string, string> | null {
  const lines = iniLines(text, maximumBytes);
  if (!lines) return null;
  const expected = new Set(expectedKeys);
  const values = new Map<string, string>();
  const state = { inSection: false };
  for (const rawLine of lines) {
    if (!acceptExactSectionLine(rawLine, sectionName, expected, values, state)) return null;
  }
  return state.inSection && values.size === expected.size ? values : null;
}
