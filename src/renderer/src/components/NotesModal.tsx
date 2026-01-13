import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { NoteEntry } from "@shared/ipc";

type NotesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  entityType: "contact" | "server";
  entityId: string;
  entityName: string;
  existingNote?: NoteEntry;
  onSave: (note: string, tags: string[]) => Promise<boolean | undefined>;
};

export const NotesModal: React.FC<NotesModalProps> = ({
  isOpen,
  onClose,
  entityType,
  entityName,
  existingNote,
  onSave,
}) => {
  const [note, setNote] = useState(existingNote?.note || "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(existingNote?.tags || []);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNote(existingNote?.note || "");
      setTags(existingNote?.tags || []);
      setTagInput("");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, existingNote]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await onSave(note.trim(), tags);
      if (success) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="animate-fade-in"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: "500px",
          background: "var(--color-bg-surface-opaque)",
          borderRadius: "12px",
          border: "1px solid var(--color-border-medium)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "rgba(251, 191, 36, 0.15)",
              color: "rgba(251, 191, 36, 1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              {entityType === "contact" ? "Contact Notes" : "Server Notes"}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "var(--color-text-tertiary)",
                marginTop: "2px",
              }}
            >
              {entityName}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid transparent",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--color-text-primary)";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--color-text-tertiary)";
              e.currentTarget.style.background = "none";
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "20px" }}>
          {/* Note textarea */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Note
            </label>
            <textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Add a note about this ${entityType}...`}
              style={{
                width: "100%",
                minHeight: "100px",
                padding: "12px",
                fontSize: "14px",
                background: "rgba(0, 0, 0, 0.2)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
                color: "var(--color-text-primary)",
                resize: "vertical",
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>

          {/* Tags */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Tags
            </label>

            {/* Tag list */}
            {tags.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "12px",
                }}
              >
                {tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      background: "rgba(99, 179, 237, 0.15)",
                      color: "rgba(99, 179, 237, 1)",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    #{tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        padding: 0,
                        display: "flex",
                        opacity: 0.7,
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Tag input */}
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a tag..."
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  fontSize: "14px",
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "8px",
                  color: "var(--color-text-primary)",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
                style={{
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background: tagInput.trim()
                    ? "rgba(99, 179, 237, 0.15)"
                    : "rgba(255, 255, 255, 0.05)",
                  color: tagInput.trim()
                    ? "rgba(99, 179, 237, 1)"
                    : "var(--color-text-tertiary)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: tagInput.trim() ? "pointer" : "not-allowed",
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--color-border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              background: "rgba(255, 255, 255, 0.08)",
              color: "var(--color-text-secondary)",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              background: "rgba(52, 211, 153, 0.15)",
              color: "rgba(52, 211, 153, 1)",
              border: "none",
              borderRadius: "8px",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.background = "rgba(52, 211, 153, 0.25)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(52, 211, 153, 0.15)";
            }}
          >
            {saving ? "Saving..." : "Save Notes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
