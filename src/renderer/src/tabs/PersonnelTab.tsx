import React, { useState, useCallback, useEffect, useMemo } from "react";
import { OnCallRow, Contact, TeamLayout } from "@shared/ipc";
import { TactileButton } from "../components/TactileButton";
import { Modal } from "../components/Modal";
import { Input } from "../components/Input";
import { ContextMenu, ContextMenuItem } from "../components/ContextMenu";
import { ConfirmModal } from "../components/ConfirmModal";
import { Tooltip } from "../components/Tooltip";
import { CollapsibleHeader, useCollapsibleHeader } from "../components/CollapsibleHeader";
import { usePersonnel } from "../hooks/usePersonnel";
import { useToast } from "../components/Toast";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { SortableTeamCard } from "../components/oncall/SortableTeamCard";
import { useAutoAnimate } from '@formkit/auto-animate/react';

// Format on-call rows as text for copying
function formatTeamOnCall(team: string, rows: OnCallRow[]): string {
  if (rows.length === 0) return `${team}: (empty)`;
  const members = rows.map(r => {
    const parts = [r.role];
    if (r.name) parts.push(r.name);
    if (r.contact) parts.push(`(${r.contact})`);
    if (r.timeWindow) parts.push(`[${r.timeWindow}]`);
    return parts.join(' ');
  });
  return `${team}: ${members.join(' | ')}`;
}

export const PersonnelTab: React.FC<{ onCall: OnCallRow[]; contacts: Contact[]; teamLayout?: TeamLayout }> = ({ onCall, contacts, teamLayout }) => {
  const { localOnCall, weekRange, dismissedAlerts, dismissAlert, getAlertKey, currentDay, teams, handleUpdateRows, handleRemoveTeam, handleRenameTeam, handleAddTeam, handleReorderTeams, tick } = usePersonnel(onCall, teamLayout);
  const [isAddingTeam, setIsAddingTeam] = useState(false); const [newTeamName, setNewTeamName] = useState("");
  const [renamingTeam, setRenamingTeam] = useState<{ old: string; new: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ team: string; onConfirm: () => void } | null>(null);
  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const { showToast } = useToast();

  const [animationParent, enableAnimations] = useAutoAnimate({
    duration: 500,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
  });

  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    enableAnimations(!isDragging);
  }, [isDragging, enableAnimations]);

  // Ensure drag state is cleared on unmount
  useEffect(() => {
    return () => {
      window.api?.notifyDragStop();
    };
  }, []);

  // Disable animations during active window resize to prevent jank
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      enableAnimations(false);
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        enableAnimations(true);
      }, 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [enableAnimations]);

  const isPopout = window.location.hash.includes('popout');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Pre-group rows by team for performance
  const groupedOnCall = useMemo(() => {
    const map = new Map<string, OnCallRow[]>();
    localOnCall.forEach((row) => {
      const existing = map.get(row.team) || [];
      existing.push(row);
      map.set(row.team, existing);
    });
    return map;
  }, [localOnCall]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
        const oldIndex = teams.indexOf(active.id as string);
        const newIndex = teams.indexOf(over.id as string);
        void handleReorderTeams(oldIndex, newIndex);
    }
  };

  // Copy handlers - use Electron's native clipboard API
  const handleCopyTeamInfo = useCallback(async (team: string, rows: OnCallRow[]) => {
    const text = formatTeamOnCall(team, rows);
    const success = await window.api?.writeClipboard(text);
    if (success) {
      showToast(`Copied ${team} info`, 'success');
    } else {
      showToast('Failed to copy', 'error');
    }
  }, [showToast]);

  const handleCopyAllOnCall = useCallback(async () => {
    const allText = teams.map(team => {
      const teamRows = groupedOnCall.get(team) || [];
      return formatTeamOnCall(team, teamRows);
    }).join('\n');
    const success = await window.api?.writeClipboard(allText);
    if (success) {
      showToast('Copied all info', 'success');
    } else {
      showToast('Failed to copy', 'error');
    }
  }, [teams, groupedOnCall, showToast]);

  const handleExportCsv = useCallback(async () => {
    const result = await window.api?.exportData({
      format: 'csv',
      category: 'oncall',
      includeMetadata: false
    });
    if (result) {
      showToast('Exported successfully', 'success');
    } else {
      showToast('Export failed', 'error');
    }
  }, [showToast]);

  const alertConfigs = [
    { day: 0, type: 'first-responder', label: 'Update First Responder', tone: 'info' },
    { day: 1, type: 'general', label: 'Update Weekly Schedule', tone: 'info' },
    { day: 3, type: 'sql', label: 'Update SQL DBA', tone: 'danger' },
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', tone: 'danger' }
  ] as const;

  const renderAlerts = () =>
    alertConfigs
      .filter((config) => config.day === currentDay && !dismissedAlerts.has(getAlertKey(config.type)))
      .map((config) => {
        const isDanger = config.tone === 'danger';
        return (
          <Tooltip key={config.type} content="Click to dismiss">
            <button
              type="button"
              onClick={() => dismissAlert(config.type)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 700,
                color: isDanger ? '#FCA5A5' : '#93C5FD',
                padding: '8px 16px',
                borderRadius: '14px',
                marginLeft: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              className="card-surface"
            >
              <span
                className="animate-active-indicator"
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: isDanger ? '#F87171' : '#60A5FA',
                  boxShadow: isDanger ? '0 0 6px rgba(248, 113, 113, 0.6)' : '0 0 6px rgba(96, 165, 250, 0.6)',
                  flexShrink: 0,
                }}
              />
              {config.label}
            </button>
          </Tooltip>
        );
      });

  const isAnyModalOpen = !!(isAddingTeam || renamingTeam || confirmDelete);

  return (
    <div ref={scrollContainerRef} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "24px 32px", background: "transparent", overflowY: "auto" }}>
      <CollapsibleHeader title="On-Call Board" subtitle={<>{weekRange}{renderAlerts()}</>} isCollapsed={isCollapsed}>
        <TactileButton
          onClick={handleCopyAllOnCall}
          title="Copy All On-Call Info"
          aria-label="Copy All On-Call Info"
          style={{ marginRight: '8px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>}
        >COPY ALL</TactileButton>
        <TactileButton
          onClick={handleExportCsv}
          title="Export to CSV (Excel)"
          aria-label="Export to CSV"
          style={{ marginRight: '8px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>}
        >EXPORT</TactileButton>
        {!isPopout && (
          <TactileButton
            onClick={() => {
              window.api?.openAuxWindow('popout/board');
            }}
            title="Pop Out Board"
            aria-label="Pop Out Board"
            style={{ marginRight: '8px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>}
          >POP OUT</TactileButton>
        )}
        <TactileButton variant="primary" aria-label="Add Card" style={{ padding: isCollapsed ? '8px 16px' : '15px 32px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={() => setIsAddingTeam(true)}>+ ADD CARD</TactileButton>
      </CollapsibleHeader>

      <DndContext 
        id="personnel-board-dnd"
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={(event) => {
          if (isAnyModalOpen) return;
          const { active } = event;
          if (teams.includes(active.id as string)) {
            setIsDragging(true);
            window.api?.notifyDragStart();
          }
        }}
        onDragEnd={(event) => {
          if (isDragging) {
            handleDragEnd(event);
            setTimeout(() => setIsDragging(false), 50);
            window.api?.notifyDragStop();
          }
        }}
        onDragCancel={() => {
          if (isDragging) {
            setIsDragging(false);
            window.api?.notifyDragStop();
          }
        }}
      >
        <SortableContext items={teams} strategy={rectSortingStrategy}>
          <div 
            ref={animationParent} 
            className="oncall-grid" 
            role="list" 
            aria-label="Sortable On-Call Teams"
          >
            {teams.map((team, idx) => (
              <div key={team} className="oncall-grid-item" role="listitem">
                <SortableTeamCard
                  team={team}
                  index={idx}
                  rows={groupedOnCall.get(team) || []}
                  contacts={contacts}
                  onUpdateRows={handleUpdateRows}
                  onRenameTeam={(o, n) => setRenamingTeam({ old: o, new: n })}
                  onRemoveTeam={handleRemoveTeam}
                  setConfirm={setConfirmDelete}
                  setMenu={setMenu}
                  onCopyTeamInfo={handleCopyTeamInfo}
                  tick={tick}
                />
              </div>
            ))}
          </div>
        </SortableContext>
        <div aria-live="polite" className="sr-only">
          {isDragging ? `Dragging team ${isDragging}` : ""}
        </div>
      </DndContext>

      <Modal isOpen={!!renamingTeam} onClose={() => setRenamingTeam(null)} title="Rename Card" width="400px"><div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><Input value={renamingTeam?.new || ""} onChange={(e) => setRenamingTeam(p => p ? { ...p, new: e.target.value } : null)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && renamingTeam) { void handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() => setRenamingTeam(null)); } }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}><TactileButton variant="secondary" onClick={() => setRenamingTeam(null)}>Cancel</TactileButton><TactileButton variant="primary" onClick={() => { if (renamingTeam) { void handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() => setRenamingTeam(null)); } }}>Rename</TactileButton></div></div></Modal>


      <Modal isOpen={isAddingTeam} onClose={() => setIsAddingTeam(false)} title="Add New Card" width="400px"><div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><Input placeholder="Card Name (e.g. SRE, Support)" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && newTeamName.trim()) { void handleAddTeam(newTeamName.trim()); setNewTeamName(""); setIsAddingTeam(false); } }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}><TactileButton variant="secondary" onClick={() => setIsAddingTeam(false)}>Cancel</TactileButton><TactileButton variant="primary" onClick={() => { if (newTeamName.trim()) { void handleAddTeam(newTeamName.trim()); setNewTeamName(""); setIsAddingTeam(false); } }}>Add Card</TactileButton></div></div></Modal>

      {confirmDelete && <ConfirmModal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={confirmDelete.onConfirm} title="Remove Card" message={`Are you sure you want to remove the card "${confirmDelete.team}"? This will delete all members in this card.`} confirmLabel="Remove" isDanger />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
};
