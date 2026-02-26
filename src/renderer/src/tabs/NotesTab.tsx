import React, { useState, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensors, useSensor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { StandaloneNote, NoteColor } from '@shared/ipc';
import { useNotepad } from '../hooks/useNotepad';
import { useToast } from '../components/Toast';
import { ContextMenu } from '../components/ContextMenu';
import { NoteCard, NoteEditor, NoteToolbar } from './notes';
import { TactileButton } from '../components/TactileButton';

export const NotesTab: React.FC = () => {
  const pad = useNotepad();
  const { showToast } = useToast();

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
        pad.addNote({ ...data, pinned: false });
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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        pad.reorderNotes(active.id as string, over.id as string);
      }
    },
    [pad],
  );

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

  const noteIds = pad.notes.map((n) => n.id);

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={noteIds} strategy={rectSortingStrategy}>
          <div
            className="relay-grid relay-grid--notes stagger-children"
            data-font-size={pad.fontSize}
          >
            {pad.notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onClick={() => handleEditNote(note)}
                onContextMenu={(e) => handleContextMenu(e, note)}
                onTogglePin={() => pad.togglePin(note.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="notes-tab">
      <NoteToolbar
        allTags={pad.allTags}
        activeTag={pad.activeTag}
        onTagClick={pad.setActiveTag}
        sort={pad.sort}
        onSortChange={pad.setSort}
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
              label: contextMenu.note.pinned ? 'Unpin' : 'Pin to top',
              onClick: () => {
                pad.togglePin(contextMenu.note.id);
                setContextMenu(null);
              },
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
