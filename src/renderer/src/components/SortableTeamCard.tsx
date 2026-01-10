import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { OnCallEntry, Contact } from '@shared/ipc';
import { ContextMenuItem } from './ContextMenu';
import { Tooltip } from './Tooltip';
import { getColorForString } from '../utils/colors';

export interface SortableTeamCardProps {
    team: string;
    entry: OnCallEntry | undefined;
    primaryContact: Contact | undefined;
    backupContact: Contact | undefined;
    setEditingTeam: (team: string) => void;
    setRenamingTeam: (val: { old: string, new: string }) => void;
    onRemoveTeam: (team: string) => void;
    setConfirmRemove: (team: string | null) => void;
    setMenu: (menu: { x: number, y: number, items: ContextMenuItem[] } | null) => void;
}

export const SortableTeamCard = ({
    team,
    entry,
    primaryContact,
    backupContact,
    setEditingTeam,
    setRenamingTeam,
    onRemoveTeam,
    setConfirmRemove,
    setMenu
}: SortableTeamCardProps) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: team });

    const colorScheme = getColorForString(team);

    const style = {
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 999 : 'auto',
        minWidth: '260px',
        maxWidth: '260px', // constrain width for horizontal layout
        flex: '0 0 auto'
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
        >
            {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
            <div
                role="button"
                tabIndex={0}
                style={{
                    height: 'auto',
                    minHeight: '0',
                    padding: '12px 16px', // Slightly more padding
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    cursor: 'grab',
                    transition: 'all var(--transition-smooth)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    position: 'relative',
                    overflow: 'hidden',
                    transformOrigin: 'center center'
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                    e.currentTarget.style.boxShadow = 'none';
                }}
                onClick={() => setEditingTeam(team)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingTeam(team); } }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                            { label: 'Edit Assignments', onClick: () => setEditingTeam(team) },
                            { label: 'Rename Team', onClick: () => setRenamingTeam({ old: team, new: team }) },
                            { label: 'Remove Team', danger: true, onClick: () => setConfirmRemove(team) }
                        ]
                    });
                }}
            >
                {/* Accent Strip */}
                <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: '4px',
                    background: colorScheme.text, // Use the unique color
                    opacity: 0.8
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <Tooltip content={team.toUpperCase()}>
                        <div
                            style={{
                                fontSize: '11px', // Slightly smaller team name
                                fontWeight: 800,
                                color: colorScheme.text, // Dynamic color for team name
                                letterSpacing: '0.08em',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '180px' // Adjusted to fit grabber better
                            }}
                        >
                            {team.toUpperCase()}
                        </div>
                    </Tooltip>
                    {/* Drag Handle Icon - Absolute top-right to save space */}
                    <div style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        color: 'var(--color-text-tertiary)',
                        opacity: 0.3,
                        fontSize: '10px',
                        pointerEvents: 'none'
                    }}>
                        ⋮⋮
                    </div>
                </div>

                <div
                    style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 700, opacity: 0.6, flexShrink: 0 }}>PRI</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', overflow: 'hidden', minWidth: 0 }}>
                            <Tooltip content={primaryContact?.name || entry?.primary || 'UNASSIGNED'}>
                                <span
                                    style={{ fontSize: '13px', fontWeight: 700, color: entry?.primary ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                                >
                                    {primaryContact?.name || entry?.primary || 'UNASSIGNED'}
                                </span>
                            </Tooltip>
                            {primaryContact?.phone && (
                                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600, marginTop: '1px', fontFamily: 'var(--font-mono)' }}>
                                    {primaryContact.phone}
                                </span>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 700, opacity: 0.6, flexShrink: 0 }}>{entry?.backupLabel || 'BAK'}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', overflow: 'hidden', minWidth: 0 }}>
                            <Tooltip content={backupContact?.name || entry?.backup || 'UNASSIGNED'}>
                                <span
                                    style={{ fontSize: '12px', fontWeight: 600, color: entry?.backup ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                                >
                                    {backupContact?.name || entry?.backup || 'UNASSIGNED'}
                                </span>
                            </Tooltip>
                            {backupContact?.phone && (
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, marginTop: '1px', fontFamily: 'var(--font-mono)' }}>
                                    {backupContact.phone}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
