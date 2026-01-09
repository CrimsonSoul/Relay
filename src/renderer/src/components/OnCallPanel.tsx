import React from 'react';
import { OnCallEntry, Contact, GroupMap } from '@shared/ipc';
import { TactileButton } from './TactileButton';
import { Modal } from './Modal';
import { Input } from './Input';
import { Tooltip } from './Tooltip';
import { ContextMenu } from './ContextMenu';
import { ConfirmModal } from './ConfirmModal';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy
} from '@dnd-kit/sortable';

import { SortableTeamCard } from './SortableTeamCard';
import { AssignmentModal } from './oncall/AssignmentModal';
import { useOnCallPanel } from '../hooks/useOnCallPanel';

interface OnCallPanelProps {
    onCall: OnCallEntry[];
    contacts: Contact[];
    groups: GroupMap;
    onUpdate: (entry: OnCallEntry) => void;
    onRemoveTeam: (team: string) => void;
    onRenameTeam: (oldName: string, newName: string) => void;
    onAddTeam: (name: string) => void;
}

export const OnCallPanel: React.FC<OnCallPanelProps> = ({
    onCall,
    contacts,
    onUpdate,
    onRemoveTeam,
    onRenameTeam,
    onAddTeam
}) => {
    const {
        isCollapsed, setIsCollapsed,
        editingTeam, setEditingTeam,
        isAddingTeam, setIsAddingTeam,
        newTeamName, setNewTeamName,
        searchQuery, setSearchQuery,
        renamingTeam, setRenamingTeam,
        localOnCall,
        menu, setMenu,
        confirmRemove, setConfirmRemove,
        filteredContacts,
        handleUpdate,
        handleDragEnd,
        weekRange,
        teams,
        currentEntry
    } = useOnCallPanel(onCall, contacts, onUpdate);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    return (
        <div style={{
            borderTop: 'var(--border-subtle)',
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            height: isCollapsed ? '24px' : '200px',
            overflow: 'hidden',
            position: 'relative',
            boxShadow: isCollapsed ? 'none' : '0 -4px 20px rgba(0,0,0,0.3)',
            boxSizing: 'border-box'
        }}>
            {/* Header / Toggle */}
            <div
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="hover-bg"
                style={{
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderBottom: isCollapsed ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                    cursor: 'pointer'
                }}
            >
                <Tooltip content={isCollapsed ? "Expand Panel" : "Collapse Panel"} position="top">
                    <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '0.05em' }}>ON-CALL STATUS</div>
                            <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', fontWeight: 500, letterSpacing: '0.05em', opacity: 0.8 }}>{weekRange}</div>
                        </div>
                        <div style={{ color: 'var(--color-text-tertiary)', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', transform: isCollapsed ? 'rotate(90deg)' : 'rotate(270deg)' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                        </div>
                    </div>
                </Tooltip>
            </div>

            <div
                onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Add New Team', onClick: () => setIsAddingTeam(true) }] });
                }}
                style={{
                    flex: 1, padding: '20px', gap: '24px', overflowX: 'auto', alignItems: 'stretch',
                    display: isCollapsed ? 'none' : 'flex', opacity: isCollapsed ? 0 : 1,
                    pointerEvents: isCollapsed ? 'none' : 'auto', transition: 'opacity 0.3s'
                }}
            >
                {teams.length === 0 && !isCollapsed && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'var(--color-text-tertiary)', fontSize: '12px', fontStyle: 'italic' }}>
                        No teams defined. Use "+ ADD TEAM" to start.
                    </div>
                )}

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={teams} strategy={horizontalListSortingStrategy}>
                        {teams.map(team => {
                            const entry = localOnCall.find(e => e.team === team);
                            const primaryContact = contacts.find(c => c.email === entry?.primary);
                            const backupContact = contacts.find(c => c.email === entry?.backup);
                            return (
                                <SortableTeamCard
                                    key={team} team={team} entry={entry}
                                    primaryContact={primaryContact} backupContact={backupContact}
                                    setEditingTeam={setEditingTeam} setRenamingTeam={setRenamingTeam}
                                    onRemoveTeam={onRemoveTeam} setConfirmRemove={setConfirmRemove} setMenu={setMenu}
                                />
                            );
                        })}
                    </SortableContext>
                </DndContext>
            </div>

            <Modal isOpen={!!renamingTeam} onClose={() => setRenamingTeam(null)} title="Rename Team" width="400px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <Input value={renamingTeam?.new || ''} onChange={e => setRenamingTeam(p => p ? { ...p, new: e.target.value } : null)} autoFocus />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <TactileButton variant="secondary" onClick={() => setRenamingTeam(null)}>Cancel</TactileButton>
                        <TactileButton variant="primary" onClick={() => { if (renamingTeam) { onRenameTeam(renamingTeam.old, renamingTeam.new); setRenamingTeam(null); } }}>Rename</TactileButton>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isAddingTeam} onClose={() => setIsAddingTeam(false)} title="Add New On-Call Team" width="400px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <Input
                        placeholder="Team Name" value={newTeamName} onChange={e => setNewTeamName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newTeamName.trim()) { onAddTeam(newTeamName.trim()); setNewTeamName(''); setIsAddingTeam(false); } }} autoFocus
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <TactileButton variant="secondary" onClick={() => setIsAddingTeam(false)}>Cancel</TactileButton>
                        <TactileButton variant="primary" onClick={() => { if (newTeamName.trim()) { onAddTeam(newTeamName.trim()); setNewTeamName(''); setIsAddingTeam(false); } }}>Add Team</TactileButton>
                    </div>
                </div>
            </Modal>

            <AssignmentModal
                isOpen={!!editingTeam} onClose={() => setEditingTeam(null)} teamName={editingTeam}
                currentEntry={currentEntry} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                filteredContacts={filteredContacts} contacts={contacts} handleUpdate={handleUpdate}
            />

            {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
            {confirmRemove && (
                <ConfirmModal
                    isOpen={!!confirmRemove} onClose={() => setConfirmRemove(null)} onConfirm={() => { onRemoveTeam(confirmRemove); setConfirmRemove(null); }}
                    title="Remove Team" message={`Are you sure you want to remove "${confirmRemove}"?`} confirmLabel="Remove" isDanger
                />
            )}
        </div>
    );
};
