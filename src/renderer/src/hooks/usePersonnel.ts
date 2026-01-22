import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { OnCallRow, TeamLayout } from "@shared/ipc";
import { useToast } from '../components/Toast';

const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.getFullYear(), now.getMonth(), diff);
    const sunday = new Date(now.getFullYear(), now.getMonth(), diff + 6);
    const options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
    return `${monday.toLocaleDateString(
      undefined,
      options
    )} - ${sunday.toLocaleDateString(
      undefined,
      options
    )}, ${sunday.getFullYear()}`;
};

export function usePersonnel(onCall: OnCallRow[], _teamLayout?: TeamLayout) {
  const { showToast } = useToast();
  const [localOnCall, setLocalOnCall] = useState<OnCallRow[]>(onCall);
  const [weekRange, setWeekRange] = useState(getWeekRange());
  const [currentDay, setCurrentDay] = useState(new Date().getDay());
  const [tick, setTick] = useState(Date.now());

  // Ref to track if the update was triggered locally (optimistic update)
  const isLocalUpdateRef = useRef(false);

  // Sync with external updates, respecting local optimistic state
  useEffect(() => {
    if (!isLocalUpdateRef.current) {
        setLocalOnCall(onCall);
    } else {
        isLocalUpdateRef.current = false;
    }
  }, [onCall]);

  // Alert Logic
  const getAlertKey = useCallback((type: string) => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${type}`;
  }, []);

  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    const check = [getAlertKey('first-responder'), getAlertKey('general'), getAlertKey('sql'), getAlertKey('oracle')];
    const saved = new Set<string>();
    check.forEach(k => { if (localStorage.getItem(`dismissed-${k}`)) saved.add(k); });
    return saved;
  });

  const dismissAlert = useCallback((type: string) => {
    const key = getAlertKey(type);
    localStorage.setItem(`dismissed-${key}`, 'true');
    setDismissedAlerts(prev => { const next = new Set(prev); next.add(key); return next; });
  }, [getAlertKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setWeekRange(getWeekRange());
      setTick(Date.now());
      const newDay = new Date().getDay();
      if (newDay !== currentDay) {
        setCurrentDay(newDay);
        const types = ['first-responder', 'general', 'sql', 'oracle'];
        const saved = new Set<string>();
        types.forEach(type => {
            const key = getAlertKey(type);
            if (localStorage.getItem(`dismissed-${key}`)) saved.add(key);
        });
        setDismissedAlerts(saved);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay, getAlertKey]);

  const teams = useMemo(() => {
    const map = new Map<string, OnCallRow[]>();
    localOnCall.forEach((row) => {
      if (!map.has(row.team)) map.set(row.team, []);
      map.get(row.team)?.push(row);
    });
    return Array.from(map.keys());
  }, [localOnCall]);

  const handleUpdateRows = async (team: string, rows: OnCallRow[]) => {
    const day = new Date().getDay();
    const lowerTeam = team.toLowerCase();
    
    if (day === 0 && lowerTeam.includes('first responder')) dismissAlert('first-responder');
    if (day === 1) dismissAlert('general');
    if (day === 3 && lowerTeam.includes('sql')) dismissAlert('sql');
    if (day === 4 && lowerTeam.includes('oracle')) dismissAlert('oracle');

    isLocalUpdateRef.current = true;
    setLocalOnCall((prev) => {
      const teamOrder = Array.from(new Set(prev.map((r) => r.team)));
      if (!teamOrder.includes(team)) {
        return [...prev, ...rows];
      }
      const newFlatList: OnCallRow[] = [];
      teamOrder.forEach((t) => {
        if (t === team) {
          newFlatList.push(...rows);
        } else {
          newFlatList.push(...prev.filter((r) => r.team === t));
        }
      });
      return newFlatList;
    });

    const success = await window.api?.updateOnCallTeam(team, rows);
    if (!success) {
      isLocalUpdateRef.current = false;
      showToast("Failed to save changes", "error");
    }
  };

  const handleRemoveTeam = async (team: string) => {
    isLocalUpdateRef.current = true;
    const success = await window.api?.removeOnCallTeam(team);
    if (success) {
      setLocalOnCall((prev) => prev.filter((r) => r.team !== team));
      showToast(`Removed ${team}`, "success");
    } else {
      isLocalUpdateRef.current = false;
      showToast("Failed to remove team", "error");
    }
  };

  const handleRenameTeam = async (oldName: string, newName: string) => {
    isLocalUpdateRef.current = true;
    const success = await window.api?.renameOnCallTeam(oldName, newName);
    if (success) {
      setLocalOnCall((prev) =>
        prev.map((r) => (r.team === oldName ? { ...r, team: newName } : r))
      );
      showToast(`Renamed ${oldName} to ${newName}`, "success");
    } else {
      isLocalUpdateRef.current = false;
      showToast("Failed to rename team", "error");
    }
  };

  const handleAddTeam = async (name: string) => {
    const initialRow: OnCallRow = {
      id: crypto.randomUUID(),
      team: name,
      role: "Primary",
      name: "",
      contact: "",
      timeWindow: "",
    };
    isLocalUpdateRef.current = true;
    
    // Use functional update to ensure we have latest state
    setLocalOnCall((prev) => {
      const next = [...prev, initialRow];
      
      // Chain the API calls after the state update logic
      void (async () => {
        const success = await window.api?.updateOnCallTeam(name, [initialRow]);
        if (success) {
          const currentTeams = Array.from(new Set(next.map(r => r.team)));
          await window.api?.reorderOnCallTeams(currentTeams, {});
          showToast(`Added team ${name}`, "success");
        } else {
          isLocalUpdateRef.current = false;
          // Rollback local state
          setLocalOnCall(p => p.filter(r => r.id !== initialRow.id));
          showToast("Failed to add team", "error");
        }
      })();
      
      return next;
    });
  };

  const handleReorderTeams = async (oldIndex: number, newIndex: number) => {
    if (oldIndex === newIndex) return;

    const currentTeams = [...teams];
    const [movedTeam] = currentTeams.splice(oldIndex, 1);
    currentTeams.splice(newIndex, 0, movedTeam);
    
    const newFlatList: OnCallRow[] = [];
    currentTeams.forEach(t => {
       newFlatList.push(...localOnCall.filter(r => r.team === t));
    });

    isLocalUpdateRef.current = true;
    const oldFlatList = [...localOnCall];
    setLocalOnCall(newFlatList);

    const success = await window.api?.reorderOnCallTeams(currentTeams, {});
    if (success) {
      showToast("Teams reordered", "success");
    } else {
      isLocalUpdateRef.current = false;
      setLocalOnCall(oldFlatList);
      showToast("Failed to save team order", "error");
    }
  };

  return {
    localOnCall,
    weekRange,
    dismissedAlerts,
    dismissAlert,
    getAlertKey,
    currentDay,
    teams,
    handleUpdateRows,
    handleRemoveTeam,
    handleRenameTeam,
    handleAddTeam,
    handleReorderTeams,
    setLocalOnCall,
    tick
  };
}
