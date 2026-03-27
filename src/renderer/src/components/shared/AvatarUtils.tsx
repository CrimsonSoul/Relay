import React from 'react';
import { getColorForString } from '../../utils/colors';

export const GroupPill = ({ group }: { group: string }) => {
  const c = getColorForString(group);
  return (
    <span
      className="group-pill"
      style={
        {
          '--pill-text': c.text,
          '--pill-bg': c.bg,
          '--pill-border': c.border,
          '--pill-fill': c.fill,
        } as React.CSSProperties
      }
    >
      <span className="group-pill-accent" />
      {group.toUpperCase()}
    </span>
  );
};

const isValidName = (name: string) => {
  if (!name) return false;
  const stripped = name.replaceAll(/[.\s\-_]/g, '');
  return stripped.length > 0;
};

export const getInitials = (name: string, email: string) => {
  if (isValidName(name)) {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return email && email.length > 0 ? email[0].toUpperCase() : '?';
};

interface AvatarProps {
  name: string;
  email: string;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ name, email, className }) => {
  const cls = ['avatar', className].filter(Boolean).join(' ');
  return <div className={cls}>{getInitials(name, email)}</div>;
};
