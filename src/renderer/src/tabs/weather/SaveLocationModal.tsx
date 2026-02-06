import React, { useState } from "react";
import { type Location } from "./types";

interface SaveLocationModalProps {
  location: Location | null;
  onClose: () => void;
  onSave: (name: string, isDefault: boolean) => void;
}

export const SaveLocationModal: React.FC<SaveLocationModalProps> = ({ location, onClose, onSave }) => {
  const [saveName, setSaveName] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const handleSave = () => {
    if (!saveName.trim()) return;
    onSave(saveName.trim(), saveAsDefault);
  };

  return (
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
        zIndex: 30000,
      }}
      onClick={onClose}
    >
      <div
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "var(--color-bg-surface-opaque)",
          borderRadius: "12px",
          border: "var(--border-medium)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-subtle)" }}>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Save Location
          </div>
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            {location?.name} ({location?.latitude.toFixed(4)}, {location?.longitude.toFixed(4)})
          </div>
        </div>
        <div style={{ padding: "20px" }}>
          <label style={{
            display: "block",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            marginBottom: "8px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            Name
          </label>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g., HQ, Store #1234"
            autoFocus
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "14px",
              background: "var(--color-bg-surface-elevated)",
              border: "var(--border-medium)",
              borderRadius: "8px",
              color: "var(--color-text-primary)",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginTop: "16px",
            cursor: "pointer",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}>
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
            Set as default location
          </label>
        </div>
        <div style={{
          padding: "16px 20px",
          borderTop: "1px solid var(--color-border-subtle)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "12px",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              background: "var(--color-bg-surface-elevated)",
              color: "var(--color-text-secondary)",
              border: "var(--border-medium)",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            style={{
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              background: saveName.trim() ? "var(--color-accent-blue)" : "var(--color-bg-surface-elevated)",
              color: saveName.trim() ? "#ffffff" : "var(--color-text-tertiary)",
              border: saveName.trim() ? "1px solid var(--color-accent-blue)" : "var(--border-medium)",
              borderRadius: "8px",
              cursor: saveName.trim() ? "pointer" : "not-allowed",
              transition: "all 0.15s ease",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
