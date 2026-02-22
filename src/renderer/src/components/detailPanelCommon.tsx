import React from 'react';

type DetailActionVariant = 'default' | 'primary' | 'danger';

const VARIANT_CLASS: Record<DetailActionVariant, string> = {
  default: '',
  primary: ' detail-panel-action-btn--primary',
  danger: ' detail-panel-action-btn--danger',
};

interface DetailActionButtonProps {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  variant?: DetailActionVariant;
}

export const DetailActionButton: React.FC<DetailActionButtonProps> = ({
  label,
  onClick,
  icon,
  variant = 'default',
}) => (
  <button className={`detail-panel-action-btn${VARIANT_CLASS[variant]}`} onClick={onClick}>
    {icon}
    {label}
  </button>
);

export const DetailField: React.FC<{ label: string; value: string; valueClassName?: string }> = ({
  label,
  value,
  valueClassName,
}) => (
  <div className="detail-panel-field">
    <div className="detail-panel-field-label">{label}</div>
    <div
      className={
        valueClassName ? `detail-panel-field-value ${valueClassName}` : 'detail-panel-field-value'
      }
    >
      {value}
    </div>
  </div>
);

export const DetailTagsSection: React.FC<{ tags: string[] }> = ({ tags }) => {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="detail-panel-section">
      <div className="detail-panel-section-label">TAGS</div>
      <div className="detail-panel-tags">
        {tags.map((tag) => (
          <span key={tag} className="detail-panel-tag">
            #{tag}
          </span>
        ))}
      </div>
    </div>
  );
};

export const DetailNotesSection: React.FC<{ noteText?: string }> = ({ noteText }) => {
  if (!noteText) {
    return null;
  }

  return (
    <div className="detail-panel-section">
      <div className="detail-panel-section-label">NOTES</div>
      <div className="detail-panel-note">{noteText}</div>
    </div>
  );
};

const iconProps = {
  width: '14',
  height: '14',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2.5',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const AddIcon: React.FC = () => (
  <svg {...iconProps}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const NotesIcon: React.FC = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

export const EditIcon: React.FC = () => (
  <svg {...iconProps}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const DeleteIcon: React.FC = () => (
  <svg {...iconProps}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
