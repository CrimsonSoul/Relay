import React from 'react';
import { Input } from './Input';

type SearchInputProps = React.ComponentProps<typeof Input>;

export const SearchInput: React.FC<SearchInputProps> = (props) => {
  return (
    <Input
      className="tactile-input"
      icon={
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      }
      {...props}
    />
  );
};
