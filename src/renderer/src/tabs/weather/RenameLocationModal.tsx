import React, { useState } from "react";
import { type SavedLocation } from "@shared/ipc";

interface RenameLocationModalProps {
  location: SavedLocation;
  onClose: () => void;
  onRename: (newName: string) => void;
}

export const RenameLocationModal: React.FC<RenameLocationModalProps> = ({ location, onClose, onRename }) => {
  const [renameName, setRenameName] = useState(location.name);

  const handleRename = () => {
    if (!renameName.trim()) return;
    onRename(renameName.trim());
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
            Rename Location
          </div>
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
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
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Location name"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && renameName.trim() && handleRename()}
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
            onClick={handleRename}
            disabled={!renameName.trim()}
            style={{
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              background: renameName.trim() ? "var(--color-accent-blue)" : "var(--color-bg-surface-elevated)",
              color: renameName.trim() ? "#ffffff" : "var(--color-text-tertiary)",
              border: renameName.trim() ? "1px solid var(--color-accent-blue)" : "var(--border-medium)",
              borderRadius: "8px",
              cursor: renameName.trim() ? "pointer" : "not-allowed",
              transition: "all 0.15s ease",
            }}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
};
