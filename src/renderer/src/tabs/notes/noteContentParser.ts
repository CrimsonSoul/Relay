export type ContentLine =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'bullet'; text: string }
  | { id: string; type: 'numbered'; number: string; text: string };

const BULLET_RE = /^- (.+)$/;
const NUMBERED_RE = /^(\d+)\. (.+)$/;

export function parseNoteContent(content: string): ContentLine[] {
  return content.split('\n').map((line, index) => {
    const numMatch = NUMBERED_RE.exec(line);
    if (numMatch) {
      return {
        id: `numbered-${index}`,
        type: 'numbered' as const,
        number: numMatch[1],
        text: numMatch[2],
      };
    }

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      return { id: `bullet-${index}`, type: 'bullet' as const, text: bulletMatch[1] };
    }

    return { id: `text-${index}`, type: 'text' as const, text: line };
  });
}
