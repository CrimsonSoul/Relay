import React, { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensors,
  useSensor,
} from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  CollisionDetection,
} from '@dnd-kit/core';
import type { StandaloneNote, NoteColor } from '@shared/ipc';
import { useNotepad } from '../hooks/useNotepad';
import { useToast } from '../components/Toast';
import { ContextMenu } from '../components/ContextMenu';
import { NoteCard, NoteCardOverlay, NoteEditor, NoteToolbar } from './notes';
import { TactileButton } from '../components/TactileButton';

export const NotesTab: React.FC = () => {
  const pad = useNotepad();
  const { showToast } = useToast();
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overlayWidth, setOverlayWidth] = useState<number | undefined>();

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<StandaloneNote | undefined>();

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    note: StandaloneNote;
  } | null>(null);

  // Drag sensors with activation constraint to distinguish clicks from drags
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const noteIds = pad.notes.map((n) => n.id);

  const notesById = React.useMemo(() => {
    const map = new Map<string, StandaloneNote>();
    pad.notes.forEach((note) => map.set(note.id, note));
    return map;
  }, [pad.notes]);

  // Collision detection: closest center, filter out self
  const notesCollisionDetection = useCallback<CollisionDetection>(
    (args) => closestCenter(args).filter((c) => c.id !== args.active.id),
    [],
  );

  const updateColumnCount = useCallback(() => {
    const node = gridRef.current;
    if (!node) return;

    const minColumnWidth = pad.fontSize === 'lg' ? 340 : 280;
    const gap = pad.fontSize === 'lg' ? 20 : 16;
    const width = node.clientWidth;
    const nextCount = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
    setColumnCount((prev) => (prev === nextCount ? prev : nextCount));
  }, [pad.fontSize]);

  const handleNewNote = useCallback(() => {
    setEditingNote(undefined);
    setEditorOpen(true);
  }, []);

  const handleEditNote = useCallback((note: StandaloneNote) => {
    setEditingNote(note);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(
    (data: { title: string; content: string; color: NoteColor; tags: string[] }) => {
      if (editingNote) {
        pad.updateNote(editingNote.id, data);
        showToast('Note updated', 'success');
      } else {
        pad.addNote(data);
        showToast('Note created', 'success');
      }
      setEditorOpen(false);
      setEditingNote(undefined);
    },
    [editingNote, pad, showToast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      pad.deleteNote(id);
      setEditorOpen(false);
      setEditingNote(undefined);
      setContextMenu(null);
      showToast('Note deleted', 'info');
    },
    [pad, showToast],
  );

  const handleDuplicate = useCallback(
    (id: string) => {
      pad.duplicateNote(id);
      setContextMenu(null);
      showToast('Note duplicated', 'success');
    },
    [pad, showToast],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setOverId(null);
    const width = event.active.rect.current.initial?.width;
    setOverlayWidth(typeof width === 'number' && Number.isFinite(width) ? width : undefined);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const newOverId = event.over?.id ? String(event.over.id) : null;
      // Only highlight a different card as drop target
      if (newOverId && newOverId !== activeId) {
        setOverId(newOverId);
      } else {
        setOverId(null);
      }
    },
    [activeId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const draggedId = activeId;
      const droppedOnId = event.over?.id ? String(event.over.id) : null;

      // Reset drag state
      setActiveId(null);
      setOverId(null);
      setOverlayWidth(undefined);

      // Commit the swap
      if (draggedId && droppedOnId && draggedId !== droppedOnId) {
        pad.reorderNotes(draggedId, droppedOnId, noteIds);
      }
    },
    [activeId, noteIds, pad],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
    setOverlayWidth(undefined);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, note: StandaloneNote) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, note });
  }, []);

  // Close context menu on click anywhere
  React.useEffect(() => {
    if (contextMenu) {
      const handler = () => setContextMenu(null);
      globalThis.addEventListener('click', handler);
      return () => globalThis.removeEventListener('click', handler);
    }
  }, [contextMenu]);

  React.useEffect(() => {
    updateColumnCount();

    const node = gridRef.current;
    if (!node) return;

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateColumnCount);
    observer?.observe(node);
    globalThis.addEventListener('resize', updateColumnCount);

    return () => {
      observer?.disconnect();
      globalThis.removeEventListener('resize', updateColumnCount);
    };
  }, [updateColumnCount]);

  const noteColumns = React.useMemo(() => {
    const normalizedCount = Math.max(1, columnCount);
    const columns: StandaloneNote[][] = Array.from({ length: normalizedCount }, () => []);

    pad.notes.forEach((note, index) => {
      columns[index % normalizedCount].push(note);
    });

    return columns;
  }, [columnCount, pad.notes]);

  const activeNote = activeId ? (notesById.get(activeId) ?? null) : null;

  let contentSection: React.ReactNode;
  if (pad.notes.length === 0 && pad.totalCount === 0) {
    contentSection = (
      <div className="notes-empty-state">
        <div className="notes-empty-icon">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.3"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <h3 className="notes-empty-title">No notes yet</h3>
        <p className="notes-empty-subtitle">
          Create your first note to start capturing ideas, incident details, and reminders.
        </p>
        <TactileButton variant="primary" onClick={handleNewNote}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Note
        </TactileButton>
      </div>
    );
  } else if (pad.notes.length === 0) {
    contentSection = (
      <div className="notes-empty-state">
        <p className="notes-empty-subtitle">No notes match your search or filter.</p>
      </div>
    );
  } else {
    contentSection = (
      <DndContext
        sensors={sensors}
        collisionDetection={notesCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div ref={gridRef} className="relay-grid--notes" data-font-size={pad.fontSize}>
          <div className="notes-masonry-columns stagger-children">
            {noteColumns.map((column, columnIndex) => (
              <div className="notes-masonry-column" key={columnIndex}>
                {column.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    isDragActive={activeId === note.id}
                    isDropTarget={overId === note.id}
                    onClick={() => handleEditNote(note)}
                    onContextMenu={(e) => handleContextMenu(e, note)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeNote ? <NoteCardOverlay note={activeNote} width={overlayWidth} /> : null}
        </DragOverlay>
      </DndContext>
    );
  }

  return (
    <div className="notes-tab">
      <NoteToolbar
        allTags={pad.allTags}
        activeTag={pad.activeTag}
        onTagClick={pad.setActiveTag}
        fontSize={pad.fontSize}
        onFontSizeChange={pad.setFontSize}
        onNewNote={handleNewNote}
        noteCount={pad.totalCount}
      />

      {contentSection}

      {/* Note Editor Modal */}
      <NoteEditor
        isOpen={editorOpen}
        note={editingNote}
        onSave={handleSave}
        onClose={() => {
          setEditorOpen(false);
          setEditingNote(undefined);
        }}
        onDelete={editingNote ? () => handleDelete(editingNote.id) : undefined}
      />

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: 'Edit',
              onClick: () => {
                handleEditNote(contextMenu.note);
                setContextMenu(null);
              },
            },
            {
              label: 'Duplicate',
              onClick: () => handleDuplicate(contextMenu.note.id),
            },
            {
              label: 'Delete',
              danger: true,
              onClick: () => handleDelete(contextMenu.note.id),
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
