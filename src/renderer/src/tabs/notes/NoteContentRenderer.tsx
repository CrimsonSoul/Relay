import React from 'react';
import { parseNoteContent } from './noteContentParser';

interface NoteContentRendererProps {
  content: string;
  className?: string;
}

export const NoteContentRenderer: React.FC<NoteContentRendererProps> = ({ content, className }) => {
  const lines = parseNoteContent(content);

  return (
    <div className={className}>
      {lines.map((line, i) => {
        switch (line.type) {
          case 'bullet':
            return (
              <div key={i} className="note-bullet-item">
                <span className="note-bullet-dot" />
                <span>{line.text}</span>
              </div>
            );
          case 'numbered':
            return (
              <div key={i} className="note-numbered-item">
                <span className="note-numbered-num">{line.number}.</span>
                <span>{line.text}</span>
              </div>
            );
          default:
            return line.text ? (
              <p key={i} className="note-text-line">
                {line.text}
              </p>
            ) : (
              <div key={i} className="note-blank-line" />
            );
        }
      })}
    </div>
  );
};
