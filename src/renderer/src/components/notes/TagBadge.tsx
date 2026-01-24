import React from "react";

type TagBadgeProps = {
  tag: string;
  onRemove: (tag: string) => void;
};

export const TagBadge: React.FC<TagBadgeProps> = ({ tag, onRemove }) => {
  return (
    <span className="tag-badge">
      #{tag}
      <button
        type="button"
        onClick={() => onRemove(tag)}
        className="tag-remove-btn"
        aria-label={`Remove tag ${tag}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <title>Remove tag</title>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </span>
  );
};
