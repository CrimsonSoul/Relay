import React, { useRef, useState, useCallback, useEffect } from 'react';
import { sanitizeHtml, escapeHtml } from '../alertUtils';

export interface AlertBodyEditorHandle {
  setEditorContent: (html: string) => void;
}

interface AlertBodyEditorProps {
  setBodyHtml: (s: string) => void;
}

export const AlertBodyEditor = React.forwardRef<AlertBodyEditorHandle, AlertBodyEditorProps>(
  ({ setBodyHtml }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const [activeFormats, setActiveFormats] = useState({
      bold: false,
      italic: false,
      underline: false,
    });

    React.useImperativeHandle(ref, () => ({
      setEditorContent(html: string) {
        if (editorRef.current) editorRef.current.innerHTML = sanitizeHtml(html);
      },
    }));

    const handleBodyInput = useCallback(() => {
      setBodyHtml(editorRef.current?.innerHTML ?? '');
    }, [setBodyHtml]);

    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const plain = e.clipboardData.getData('text/plain');
      const cleaned = html ? sanitizeHtml(html) : escapeHtml(plain).replaceAll('\n', '<br>');
      // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to insert HTML into contentEditable
      document.execCommand('insertHTML', false, cleaned);
    }, []);

    const updateActiveFormats = useCallback(() => {
      /* eslint-disable sonarjs/deprecation -- queryCommandState is the only way to check formatting in contentEditable */
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
      /* eslint-enable sonarjs/deprecation */
    }, []);

    useEffect(() => {
      const handler = () => {
        if (
          editorRef.current?.contains(document.activeElement) ||
          editorRef.current === document.activeElement
        ) {
          updateActiveFormats();
        }
      };
      document.addEventListener('selectionchange', handler);
      return () => document.removeEventListener('selectionchange', handler);
    }, [updateActiveFormats]);

    const applyFormat = useCallback(
      (cmd: string) => {
        editorRef.current?.focus();
        // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to toggle formatting in contentEditable
        document.execCommand(cmd);
        updateActiveFormats();
      },
      [updateActiveFormats],
    );

    return (
      <div className="alerts-field">
        <span className="alerts-field-label">Body</span>
        <div className="alerts-body-editor">
          <div className="alerts-body-toolbar">
            <button
              type="button"
              className={`alerts-fmt-btn${activeFormats.bold ? ' active' : ''}`}
              title="Bold (Cmd+B)"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat('bold');
              }}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className={`alerts-fmt-btn${activeFormats.italic ? ' active' : ''}`}
              title="Italic (Cmd+I)"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat('italic');
              }}
            >
              <em>I</em>
            </button>
            <button
              type="button"
              className={`alerts-fmt-btn${activeFormats.underline ? ' active' : ''}`}
              title="Underline (Cmd+U)"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat('underline');
              }}
            >
              <span className="alerts-fmt-underline">U</span>
            </button>
            <span className="alerts-fmt-separator" />
            <button
              type="button"
              className="alerts-fmt-btn"
              title="Bullet List"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat('insertUnorderedList');
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
                <line x1="9" y1="6" x2="21" y2="6" />
                <line x1="9" y1="12" x2="21" y2="12" />
                <line x1="9" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <button
              type="button"
              className="alerts-fmt-btn"
              title="Numbered List"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat('insertOrderedList');
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <text
                  x="2"
                  y="8"
                  fontSize="7"
                  fontWeight="700"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="sans-serif"
                >
                  1
                </text>
                <text
                  x="2"
                  y="14.5"
                  fontSize="7"
                  fontWeight="700"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="sans-serif"
                >
                  2
                </text>
                <text
                  x="2"
                  y="21"
                  fontSize="7"
                  fontWeight="700"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="sans-serif"
                >
                  3
                </text>
                <line x1="9" y1="6" x2="21" y2="6" />
                <line x1="9" y1="12" x2="21" y2="12" />
                <line x1="9" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
          <div // NOSONAR - contentEditable rich text editor requires role="textbox", no native equivalent
            ref={editorRef}
            className="alerts-editable-body"
            contentEditable
            role="textbox"
            aria-label="Alert body"
            spellCheck
            data-placeholder="Write your alert message here. Cmd+B bold, Cmd+I italic, Cmd+U underline."
            onInput={handleBodyInput}
            onPaste={handlePaste}
          />
        </div>
      </div>
    );
  },
);

AlertBodyEditor.displayName = 'AlertBodyEditor';
