import { useState, useMemo, useEffect, useCallback } from 'react';
import { OnCallEntry, Contact } from '@shared/ipc';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.getFullYear(), now.getMonth(), diff);
    const sunday = new Date(now.getFullYear(), now.getMonth(), diff + 6);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${monday.toLocaleDateString(undefined, options)} - ${sunday.toLocaleDateString(undefined, options)}, ${sunday.getFullYear()}`;
};

export function useOnCallPanel(onCall: OnCallEntry[], contacts: Contact[], onUpdate: (entry: OnCallEntry) => void) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [editingTeam, setEditingTeam] = useState<string | null>(null);
    const [isAddingTeam, setIsAddingTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [renamingTeam, setRenamingTeam] = useState<{ old: string, new: string } | null>(null);
    const [localOnCall, setLocalOnCall] = useState<OnCallEntry[]>(onCall);
    const [menu, setMenu] = useState<{ x: number, y: number, items: any[] } | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

    useEffect(() => {
        setLocalOnCall(onCall);
    }, [onCall]);

    const filteredContacts = useMemo(() => {
        if (!searchQuery.trim()) return contacts.slice(0, 50);
        const low = searchQuery.toLowerCase();
        return contacts.filter(c => c._searchString.includes(low));
    }, [contacts, searchQuery]);

    const handleUpdate = useCallback((team: string, type: 'primary' | 'backup' | 'backupLabel', value: string) => {
        const existing = localOnCall.find(e => e.team === team) || { team, primary: '', backup: '', backupLabel: 'BAK' };
        const updated = {
            ...existing,
            [type]: value
        };

        setLocalOnCall(prev => {
            const exists = prev.find(e => e.team === team);
            if (exists) {
                return prev.map(e => e.team === team ? updated : e);
            }
            return [...prev, updated];
        });

        onUpdate(updated);
    }, [localOnCall, onUpdate]);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setLocalOnCall((items) => {
                const oldIndex = items.findIndex(item => item.team === active.id);
                const newIndex = items.findIndex(item => item.team === over.id);
                const newOrder = arrayMove(items, oldIndex, newIndex);

                if (window.api?.saveAllOnCall) {
                    window.api.saveAllOnCall(newOrder);
                }

                return newOrder;
            });
        }
    }, []);

    const weekRange = useMemo(() => getWeekRange(), []);
    const teams = useMemo(() => localOnCall.map(e => e.team), [localOnCall]);
    const currentEntry = useMemo(() => localOnCall.find(e => e.team === editingTeam), [localOnCall, editingTeam]);

    return {
        isCollapsed, setIsCollapsed,
        editingTeam, setEditingTeam,
        isAddingTeam, setIsAddingTeam,
        newTeamName, setNewTeamName,
        searchQuery, setSearchQuery,
        renamingTeam, setRenamingTeam,
        localOnCall, setLocalOnCall,
        menu, setMenu,
        confirmRemove, setConfirmRemove,
        filteredContacts,
        handleUpdate,
        handleDragEnd,
        weekRange,
        teams,
        currentEntry
    };
}
