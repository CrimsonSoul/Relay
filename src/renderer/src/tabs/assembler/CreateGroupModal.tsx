import React, { useState, useEffect } from "react";
import { Modal } from "../../components/Modal";
import { Input } from "../../components/Input";
import { TactileButton } from "../../components/TactileButton";
import { useToast } from "../../components/Toast";

type CreateGroupModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { showToast } = useToast();
  const [newGroupName, setNewGroupName] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setNewGroupName("");
    }
  }, [isOpen]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName) return;
    const success = await window.api?.addGroup(newGroupName);
    if (success) {
      onClose();
      showToast(`Group "${newGroupName}" created`, "success");
    } else {
      showToast("Failed to create group", "error");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Group" width="400px">
      <form onSubmit={handleCreateGroup}>
        <Input
          label="Group Name"
          autoFocus
          variant="vivid"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="e.g. Marketing"
          required
          style={{ marginBottom: "24px" }}
        />
        <div
          style={{
            fontSize: "12px",
            fontWeight: 800,
            color: "var(--color-text-tertiary)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Quick Add
        </div>
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}
        >
          <TactileButton type="button" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton type="submit" variant="primary">
            Create
          </TactileButton>
        </div>
      </form>
    </Modal>
  );
};
