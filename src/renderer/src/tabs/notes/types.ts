export type { StandaloneNote, NoteColor } from '@shared/ipc';

export type SortKey = 'updatedAt' | 'createdAt' | 'title' | 'color';
export type SortDirection = 'asc' | 'desc';

export type NoteSort = {
  key: SortKey;
  direction: SortDirection;
};

export type FontSize = 'sm' | 'md' | 'lg';
