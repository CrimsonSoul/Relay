import React, { useState } from "react";

interface HistoryNotePromptProps {
  onSave: (note: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}

export const HistoryNotePrompt: React.FC<HistoryNotePromptProps> = ({
  onSave,
  onSkip,
  onCancel,
}) => {
  const [note, setNote] = useState("");

  return (
    <div
      className="animate-slide-up"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        background: "var(--color-bg-surface-opaque)",
        border: "var(--border-medium)",
        borderRadius: "12px",
        padding: "16px",
        boxShadow: "var(--shadow-lg)",
        zIndex: 1000,
        width: "320px",
      }}
    >
      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          marginBottom: "8px",
        }}
      >
        Add note to history?
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          marginBottom: "12px",
        }}
      >
        Optional: Add a note like incident number to help find this later.
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g., INC12345 - Database outage"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(note);
          if (e.key === "Escape") onCancel();
        }}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: "13px",
          border: "var(--border-medium)",
          borderRadius: "6px",
          background: "var(--color-bg-surface-elevated)",
          color: "var(--color-text-primary)",
          outline: "none",
          marginBottom: "12px",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            background: "var(--color-bg-surface-elevated)",
            border: "var(--border-medium)",
            borderRadius: "6px",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-bg-card-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--color-bg-surface-elevated)";
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSkip}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            background: "var(--color-bg-surface-elevated)",
            border: "var(--border-medium)",
            borderRadius: "6px",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-bg-card-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--color-bg-surface-elevated)";
          }}
        >
          Skip
        </button>
        <button
          onClick={() => onSave(note)}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            background: "var(--color-accent-blue)",
            border: "none",
            borderRadius: "6px",
            color: "white",
            cursor: "pointer",
            fontWeight: 500,
            fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-accent-blue-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--color-accent-blue)";
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
};
