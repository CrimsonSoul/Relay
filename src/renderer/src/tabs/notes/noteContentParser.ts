export type ContentLine =
  | { type: 'text'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; number: string; text: string };

const BULLET_RE = /^- (.+)$/;
const NUMBERED_RE = /^(\d+)\. (.+)$/;

export function parseNoteContent(content: string): ContentLine[] {
  return content.split('\n').map((line) => {
    const numMatch = NUMBERED_RE.exec(line);
    if (numMatch) {
      return { type: 'numbered' as const, number: numMatch[1], text: numMatch[2] };
    }

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      return { type: 'bullet' as const, text: bulletMatch[1] };
    }

    return { type: 'text' as const, text: line };
  });
}
