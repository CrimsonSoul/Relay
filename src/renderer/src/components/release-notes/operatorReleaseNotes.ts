/** Commit types that never change what an operator sees; GitHub still lists them. */
const INTERNAL_TYPES = new Set(['build', 'chore', 'ci', 'docs', 'refactor', 'style', 'test']);
const SKIP_RELEASE = '[skip release]';

/** `- text` or `* text`: the marker with its indent, and the text. */
function listItem(line: string): { marker: string; text: string } | null {
  const indent = line.length - line.trimStart().length;
  const rest = line.slice(indent);
  if ((rest.startsWith('- ') || rest.startsWith('* ')) && rest.slice(2).trim()) {
    return { marker: line.slice(0, indent + 2), text: rest.slice(2).trim() };
  }
  return null;
}

/** Drops GitHub's trailing ` by @author in <url>`. */
function withoutAttribution(text: string): string {
  const at = text.lastIndexOf(' by @');
  if (at < 0) return text;
  const tail = text.slice(at + 5);
  const inAt = tail.indexOf(' in http');
  return inAt > 0 && !tail.slice(0, inAt).includes(' ') ? text.slice(0, at) : text;
}

/** `type(scope)!: summary` → [type, summary], or null when the text has no type prefix. */
function conventional(text: string): [string, string] | null {
  const colon = text.indexOf(': ');
  if (colon < 1) return null;
  const head = text.slice(0, colon);
  const type = head.split('(')[0]!.replace('!', '');
  if (
    !/^[a-z]+$/u.test(type) ||
    (head !== type && !head.startsWith(`${type}(`) && head !== `${type}!`)
  )
    return null;
  return [type, text.slice(colon + 2).trim()];
}

/** One change line in operator words: no type prefix, author, PR link or release tag. */
function operatorItem(text: string): string | null {
  const plain = withoutAttribution(text).replaceAll(SKIP_RELEASE, '').replaceAll('  ', ' ').trim();
  const parsed = conventional(plain);
  if (!parsed) return plain;
  if (INTERNAL_TYPES.has(parsed[0])) return null;
  return parsed[1].charAt(0).toUpperCase() + parsed[1].slice(1);
}

const isFullChangelog = (line: string) =>
  line.replaceAll('*', '').trim().toLowerCase().startsWith('full changelog:');

/**
 * GitHub's generated release body, trimmed for operators: internal commits, authors, PR links,
 * `[skip release]` tags and the Full Changelog link go (View on GitHub still offers them all).
 */
export function operatorReleaseNotes(body: string): string {
  const lines: string[] = [];
  let listed = 0;
  let kept = 0;
  for (const line of body.replaceAll('\r\n', '\n').split('\n')) {
    if (isFullChangelog(line)) continue;
    const item = listItem(line);
    if (!item) {
      lines.push(line);
      continue;
    }
    listed++;
    const text = operatorItem(item.text);
    if (text) {
      lines.push(item.marker + text);
      kept++;
    }
  }
  if (listed > 0 && kept === 0) return 'Maintenance release with no visible changes.';
  return lines.join('\n').trim();
}
