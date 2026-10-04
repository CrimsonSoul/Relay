import React from 'react';
import { TactileButton } from '../TactileButton';

type TagInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

export const TagInput: React.FC<TagInputProps> = ({ id, value, onChange, onAdd, onKeyDown }) => {
  return (
    <div className="tag-input-group">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Add a tag…"
        className="tag-input"
      />
      <TactileButton size="sm" onClick={onAdd} disabled={!value.trim()}>
        Add Tag
      </TactileButton>
    </div>
  );
};
