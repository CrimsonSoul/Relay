import React from 'react';
import { TactileButton } from './TactileButton';

type DetailActionVariant = 'default' | 'primary' | 'danger';

const BUTTON_VARIANT: Record<DetailActionVariant, 'secondary' | 'primary' | 'danger'> = {
  default: 'secondary',
  primary: 'primary',
  danger: 'danger',
};

interface DetailActionButtonProps {
  /** Short visible verb; it never ellipsizes, even in the paired short-window grid. */
  label: string;
  /** Full command name (`Delete Server`); starts with `label` so the name contains it (WCAG 2.5.3). */
  accessibleLabel?: string;
  onClick: () => void;
  icon: React.ReactNode;
  variant?: DetailActionVariant;
}

/** Inspector command; the tooltip carries the full command name behind the short verb. */
export const DetailActionButton: React.FC<Readonly<DetailActionButtonProps>> = ({
  label,
  accessibleLabel,
  onClick,
  icon,
  variant = 'default',
}) => (
  <TactileButton
    variant={BUTTON_VARIANT[variant]}
    block
    icon={icon}
    tooltip={accessibleLabel ?? label}
    aria-label={accessibleLabel}
    onClick={onClick}
  >
    {label}
  </TactileButton>
);

/**
 * Renders an email address with its only line-break opportunity after "@", so a narrow inspector
 * wraps `ada.lovelace@` / `example.com` and never strands `.com` or splits a token mid-word.
 */
export const EmailText: React.FC<{ email: string }> = ({ email }) => {
  const at = email.lastIndexOf('@');
  if (at < 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
};

export const DetailField: React.FC<{
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}> = ({ label, value, valueClassName }) => (
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
      <div className="detail-panel-section-label">Tags</div>
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
      <div className="detail-panel-section-label">Notes</div>
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
