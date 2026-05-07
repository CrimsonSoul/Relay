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
import { StatusBar, StatusBarLive } from '../components/StatusBar';

type NotesFontSize = 'sm' | 'md' | 'lg' | string;

export function getNotesColumnCount({
  width,
  fontSize,
  isWorkspace,
}: Readonly<{ width: number; fontSize: NotesFontSize; isWorkspace: boolean }>): number {
  if (width < 1) return 1;

  let minColumnWidth = 280;
  if (isWorkspace) {
    minColumnWidth = fontSize === 'lg' ? 360 : 320;
  }

  const gap = fontSize === 'lg' ? 20 : 16;
  return Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
}

function NoteDocumentIcon({ size = 36 }: Readonly<{ size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size > 40 ? '1' : '1.5'}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={size > 40 ? '0.3' : undefined}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      {size > 40 && <polyline points="10 9 9 9 8 9" />}
    </svg>
  );
}

function NotesEmptyState({ onNewNote }: Readonly<{ onNewNote: () => void }>) {
  return (
    <div className="notes-empty-state">
      <div className="notes-empty-icon">
        <NoteDocumentIcon size={64} />
      </div>
      <h3 className="notes-empty-title">No notes yet</h3>
      <p className="notes-empty-subtitle">
        Create your first note to start capturing ideas, incident details, and reminders.
      </p>
      <TactileButton variant="primary" onClick={onNewNote}>
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
}

function NotesNoMatchState() {
  return (
    <div className="notes-empty-state">
      <p className="notes-empty-subtitle">No notes match your search or filter.</p>
    </div>
  );
}

interface NotesBoardProps {
  notes: StandaloneNote[];
  columns: StandaloneNote[][];
  fontSize: string;
  gridRef: React.RefObject<HTMLElement | null>;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  activeId: string | null;
  overId: string | null;
  activeNote: StandaloneNote | null;
  overlayWidth?: number;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  onEditNote: (note: StandaloneNote) => void;
  onContextMenu: (event: React.MouseEvent, note: StandaloneNote) => void;
}

function NotesBoard({
  notes,
  columns,
  fontSize,
  gridRef,
  sensors,
  collisionDetection,
  activeId,
  overId,
  activeNote,
  overlayWidth,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  onEditNote,
  onContextMenu,
}: Readonly<NotesBoardProps>) {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <section
        ref={gridRef}
        className="relay-grid--notes"
        data-font-size={fontSize}
        aria-label="Notes board"
      >
        <div className="notes-board-heading">
          <div className="notes-panel-heading">
            <span className="notes-panel-kicker">Notes board</span>
            <h2>All notes</h2>
          </div>
          <span className="notes-board-count">
            {notes.length} {notes.length === 1 ? 'card' : 'cards'}
          </span>
        </div>
        {notes.length > 0 ? (
          <div className="notes-masonry-columns stagger-children">
            {columns.map((column, columnIndex) => (
              <div className="notes-masonry-column" key={columnIndex}>
                {column.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    isDragActive={activeId === note.id}
                    isDropTarget={overId === note.id}
                    onClick={() => onEditNote(note)}
                    onContextMenu={(event) => onContextMenu(event, note)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="notes-board-empty">
            <p>No notes to show.</p>
          </div>
        )}
      </section>

      <DragOverlay dropAnimation={null}>
        {activeNote ? <NoteCardOverlay note={activeNote} width={overlayWidth} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface NotesDetailPanelProps {
  editorOpen: boolean;
  editingNote?: StandaloneNote;
  onSave: (data: { title: string; content: string; color: NoteColor; tags: string[] }) => void;
  onClose: () => void;
  onDelete?: () => void;
}

function NotesDetailPanel({
  editorOpen,
  editingNote,
  onSave,
  onClose,
  onDelete,
}: Readonly<NotesDetailPanelProps>) {
  return (
    <aside className="notes-detail-panel">
      {editorOpen ? (
        <NoteEditor
          isOpen={editorOpen}
          variant="panel"
          note={editingNote}
          onSave={onSave}
          onClose={onClose}
          onDelete={onDelete}
        />
      ) : (
        <div className="notes-detail-empty">
          <span className="notes-detail-empty-icon">
            <NoteDocumentIcon />
          </span>
          <h2>Select a note</h2>
          <p>Open a card to edit it here, or create a new note without leaving the board.</p>
        </div>
      )}
    </aside>
  );
}

export const NotesTab: React.FC = () => {
  const pad = useNotepad();
  const { showToast } = useToast();
  const gridRef = React.useRef<HTMLElement | null>(null);
  const [columnCount, setColumnCount] = useState(3);
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

  const notesById = React.useMemo(() => {
    const map = new Map<string, StandaloneNote>();
    pad.notes.forEach((note) => map.set(note.id, note));
    return map;
  }, [pad.notes]);

  const boardNotes = pad.notes;
  const noteIds = boardNotes.map((n) => n.id);

  // Collision detection: closest center, filter out self
  const notesCollisionDetection = useCallback<CollisionDetection>(
    (args) => closestCenter(args).filter((c) => c.id !== args.active.id),
    [],
  );

  const updateColumnCount = useCallback(() => {
    const node = gridRef.current;
    if (!node) return;

    const width = node.clientWidth;
    if (width < 1) return; // not laid out yet
    const isWorkspace = node.closest('.notes-workspace') !== null;
    const nextCount = getNotesColumnCount({ width, fontSize: pad.fontSize, isWorkspace });
    setColumnCount((prev) => (prev === nextCount ? prev : nextCount));
  }, [pad.fontSize]);

  const handleNewNote = useCallback(() => {
    setEditingNote(undefined);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingNote(undefined);
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
      closeEditor();
    },
    [closeEditor, editingNote, pad, showToast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      pad.deleteNote(id);
      closeEditor();
      setContextMenu(null);
      showToast('Note deleted', 'info');
    },
    [closeEditor, pad, showToast],
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

  React.useEffect(() => {
    const frame = globalThis.requestAnimationFrame(updateColumnCount);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [boardNotes.length, updateColumnCount]);

  const noteColumns = React.useMemo(() => {
    const normalizedCount = Math.max(1, columnCount);
    const columns: StandaloneNote[][] = Array.from({ length: normalizedCount }, () => []);

    boardNotes.forEach((note, index) => {
      columns[index % normalizedCount].push(note);
    });

    return columns;
  }, [boardNotes, columnCount]);

  const activeNote = activeId ? (notesById.get(activeId) ?? null) : null;

  let contentSection: React.ReactNode;
  if (pad.notes.length === 0 && pad.totalCount === 0) {
    contentSection = <NotesEmptyState onNewNote={handleNewNote} />;
  } else if (pad.notes.length === 0) {
    contentSection = <NotesNoMatchState />;
  } else {
    contentSection = (
      <div
        className={`notes-workspace${editorOpen ? ' is-editing' : ''}`}
        data-font-size={pad.fontSize}
      >
        <NotesBoard
          notes={boardNotes}
          columns={noteColumns}
          fontSize={pad.fontSize}
          gridRef={gridRef}
          sensors={sensors}
          collisionDetection={notesCollisionDetection}
          activeId={activeId}
          overId={overId}
          activeNote={activeNote}
          overlayWidth={overlayWidth}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          onEditNote={handleEditNote}
          onContextMenu={handleContextMenu}
        />
        <NotesDetailPanel
          editorOpen={editorOpen}
          editingNote={editingNote}
          onSave={handleSave}
          onClose={closeEditor}
          onDelete={editingNote ? () => handleDelete(editingNote.id) : undefined}
        />
      </div>
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

      {pad.notes.length === 0 && (
        <NoteEditor
          isOpen={editorOpen}
          note={editingNote}
          onSave={handleSave}
          onClose={closeEditor}
          onDelete={editingNote ? () => handleDelete(editingNote.id) : undefined}
        />
      )}

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

      <StatusBar
        left={<StatusBarLive />}
        right={
          <span>
            {pad.totalCount} {pad.totalCount === 1 ? 'note' : 'notes'}
          </span>
        }
      />
    </div>
  );
};
