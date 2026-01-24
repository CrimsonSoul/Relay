import React from "react";

type TagInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

export const TagInput: React.FC<TagInputProps> = ({
  id,
  value,
  onChange,
  onAdd,
  onKeyDown,
}) => {
  return (
    <div className="tag-input-group">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Add a tag..."
        className="tag-input"
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={!value.trim()}
        className="tag-add-btn"
      >
        Add
      </button>
    </div>
  );
};
