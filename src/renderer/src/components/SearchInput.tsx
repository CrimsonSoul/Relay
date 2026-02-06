import React from 'react';
import { Input } from './Input';

type SearchInputProps = React.ComponentProps<typeof Input>;

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>((props, ref) => {
  return (
    <Input
      ref={ref}
      className="tactile-input"
      icon={
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="var(--color-accent-blue)" 
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
});

SearchInput.displayName = 'SearchInput';
