import React, { useState, useEffect } from "react";
import { Modal } from "../../components/Modal";
import { TactileButton } from "../../components/TactileButton";
import { Input } from "../../components/Input";

type SaveGroupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  existingNames: string[];
  title?: string;
  description?: string;
  initialName?: string;
};

export const SaveGroupModal: React.FC<SaveGroupModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingNames,
  title = "Save Group",
  description = "Save the current selection as a reusable group.",
  initialName = "",
}) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");

  // Reset name when initialName changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError("");
    }
  }, [isOpen, initialName]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter a name");
      return;
    }
    if (existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())) {
      setError("A group with this name already exists");
      return;
    }
    onSave(trimmedName);
    setName("");
    setError("");
    onClose();
  };

  const handleClose = () => {
    setName("");
    setError("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div style={{ padding: "24px", minWidth: "360px" }}>
        <h2
          style={{
            margin: "0 0 8px 0",
            fontSize: "18px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: "0 0 20px 0",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          {description}
        </p>

        <div style={{ marginBottom: "20px" }}>
          <Input
            label="Group Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder="e.g., Network P1, Database Team"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          {error && (
            <p
              style={{
                margin: "8px 0 0 0",
                fontSize: "12px",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <TactileButton variant="secondary" onClick={handleClose}>
            Cancel
          </TactileButton>
          <TactileButton variant="primary" onClick={handleSave}>
            Save
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
