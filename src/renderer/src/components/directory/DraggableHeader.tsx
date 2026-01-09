import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DraggableHeaderProps {
  id: string;
  children: React.ReactNode;
}

export const DraggableHeader = ({ id, children }: DraggableHeaderProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'flex',
    alignItems: 'center',
    zIndex: isDragging ? 10 : 'auto',
    position: isDragging ? 'relative' : undefined,
    cursor: 'grab',
    touchAction: 'none'
  } as React.CSSProperties;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};
