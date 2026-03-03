import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SEVERITIES, escapeHtml, sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';

export interface AlertFormProps {
  severity: Severity;
  setSeverity: (s: Severity) => void;
  subject: string;
  setSubject: (s: string) => void;
  setBodyHtml: (s: string) => void;
  sender: string;
  setSender: (s: string) => void;
  recipient: string;
  setRecipient: (s: string) => void;
  updateNumber: number;
  setUpdateNumber: (n: number) => void;
  customTimestamp: string;
  setCustomTimestamp: (s: string) => void;
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
}

export interface AlertFormHandle {
  setEditorContent: (html: string) => void;
}

export const AlertForm = React.forwardRef<AlertFormHandle, AlertFormProps>(
  (
    {
      severity,
      setSeverity,
      subject,
      setSubject,
      setBodyHtml,
      sender,
      setSender,
      recipient,
      setRecipient,
      updateNumber,
      setUpdateNumber,
      customTimestamp,
      setCustomTimestamp,
      logoDataUrl,
      onSetLogo,
      onRemoveLogo,
    },
    ref,
  ) => {
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
      <div className="alerts-composer">
        <div className="alerts-form-section">
          {/* Severity */}
          <div className="alerts-field">
            <legend className="alerts-field-label" id="alerts-severity-label">
              Severity
            </legend>
            <fieldset className="alerts-severity-grid" aria-labelledby="alerts-severity-label">
              {SEVERITIES.map((sev) => (
                <button
                  key={sev}
                  type="button"
                  className={`alerts-sev-btn${severity === sev ? ' active' : ''}`}
                  data-sev={sev}
                  onClick={() => setSeverity(sev)}
                >
                  {sev}
                </button>
              ))}
            </fieldset>
          </div>

          {/* Subject */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-subject">
              Subject{' '}
              <span className={`alerts-char-count${subject.length > 80 ? ' warn' : ''}`}>
                {subject.length}
              </span>
            </label>
            <input
              id="alerts-subject"
              type="text"
              className="alerts-input"
              placeholder="e.g. Planned Maintenance — POS Systems Saturday 2AM–4AM CT"
              spellCheck
              maxLength={10000}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Body */}
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

          {/* Sender */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-sender">
              Sender / From Name <span className="alerts-optional-tag">OPTIONAL</span>
            </label>
            <input
              id="alerts-sender"
              type="text"
              className="alerts-input"
              placeholder="e.g. IT"
              maxLength={10000}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
            />
          </div>

          {/* Recipient */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-recipient">
              To / Recipient <span className="alerts-optional-tag">OPTIONAL</span>
            </label>
            <input
              id="alerts-recipient"
              type="text"
              className="alerts-input"
              placeholder="e.g. All Employees"
              maxLength={10000}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          {/* Update Number */}
          <div className="alerts-field">
            <span className="alerts-field-label">
              Update Prefix <span className="alerts-optional-tag">OPTIONAL</span>
            </span>
            <div className="alerts-update-controls">
              <button
                type="button"
                className={`alerts-update-toggle${updateNumber > 0 ? ' active' : ''}`}
                onClick={() => setUpdateNumber(updateNumber > 0 ? 0 : 1)}
              >
                {updateNumber > 0 ? 'ON' : 'OFF'}
              </button>
              {updateNumber > 0 && (
                <div className="alerts-update-stepper">
                  <button
                    type="button"
                    className="alerts-stepper-btn"
                    onClick={() => setUpdateNumber(Math.max(1, updateNumber - 1))}
                  >
                    −
                  </button>
                  <span className="alerts-stepper-value">#{updateNumber}</span>
                  <button
                    type="button"
                    className="alerts-stepper-btn"
                    onClick={() => setUpdateNumber(updateNumber + 1)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Timestamp Override */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-timestamp">
              Date / Time <span className="alerts-optional-tag">OPTIONAL</span>
            </label>
            <div className="alerts-timestamp-controls">
              <input
                id="alerts-timestamp"
                type="datetime-local"
                className={`alerts-input alerts-input-datetime${customTimestamp ? '' : ' is-empty'}`}
                value={customTimestamp}
                onChange={(e) => setCustomTimestamp(e.target.value)}
              />
              {customTimestamp && (
                <button
                  type="button"
                  className="alerts-timestamp-reset"
                  onClick={() => setCustomTimestamp('')}
                  title="Reset to current time"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Company Logo */}
          <div className="alerts-field">
            <span className="alerts-field-label">
              Company Logo <span className="alerts-optional-tag">OPTIONAL</span>
            </span>
            <div className="alerts-logo-controls">
              {logoDataUrl ? (
                <>
                  <img src={logoDataUrl} alt="Company logo" className="alerts-logo-thumbnail" />
                  <button type="button" className="alerts-logo-action" onClick={onRemoveLogo}>
                    REMOVE
                  </button>
                </>
              ) : (
                <button type="button" className="alerts-logo-action" onClick={onSetLogo}>
                  UPLOAD
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

AlertForm.displayName = 'AlertForm';
