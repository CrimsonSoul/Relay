import React from 'react';
import { getColorForString } from '../../utils/colors';

export const GroupPill = ({ group }: { group: string }) => {
  const c = getColorForString(group);
  return (
    <span className="card-surface group-pill" style={{ color: c.text }}>
      {group.toUpperCase()}
    </span>
  );
};

const isValidName = (name: string) => {
  if (!name) return false;
  const stripped = name.replace(/[.\s\-_]/g, '');
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
  size?: number;
  fontSize?: number;
}

export const Avatar: React.FC<AvatarProps> = ({ name, email, size = 64, fontSize = 24 }) => {
  const colorScheme = getColorForString(name || email);
  return (
    <div
      className="avatar"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: colorScheme.bg,
        border: `1px solid ${colorScheme.border}`,
        color: colorScheme.text,
        fontSize: `${fontSize}px`,
      }}
    >
      {getInitials(name, email)}
    </div>
  );
};
