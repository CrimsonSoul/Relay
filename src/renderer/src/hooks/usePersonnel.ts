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

export function usePersonnel(onCall: OnCallRow[], teamLayout?: TeamLayout) {
  const { showToast } = useToast();
  const [localOnCall, setLocalOnCall] = useState<OnCallRow[]>(onCall);
  const [weekRange, setWeekRange] = useState(getWeekRange());
  const [currentDay, setCurrentDay] = useState(new Date().getDay());

  // Ref to track if the update was triggered locally (optimistic update)
  // to avoid overwriting state with the same data when it broadcasts back.
  const isLocalUpdateRef = useRef(false);

  // Alert Logic
  const getAlertKey = useCallback((type: string) => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${type}`;
  }, []);

  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    const check = [getAlertKey('general'), getAlertKey('sql'), getAlertKey('oracle'), getAlertKey('network')];
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
    // Skip sync if we just performed an optimistic update
    if (isLocalUpdateRef.current) {
      isLocalUpdateRef.current = false;
      return;
    }
    setLocalOnCall(onCall);
  }, [onCall]);

  useEffect(() => {
    const interval = setInterval(() => {
      setWeekRange(getWeekRange());
      const newDay = new Date().getDay();
      if (newDay !== currentDay) {
        setCurrentDay(newDay);
        const types = ['general', 'sql', 'oracle', 'network'];
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
    const result = Array.from(map.keys());
    return result;
  }, [localOnCall]);

  const handleUpdateRows = async (team: string, rows: OnCallRow[]) => {
    const day = new Date().getDay();
    const lowerTeam = team.toLowerCase();
    if (day === 1) dismissAlert('general');
    if (day === 3 && lowerTeam.includes('sql')) dismissAlert('sql');
    if (day === 4 && lowerTeam.includes('oracle')) dismissAlert('oracle');
    if (day === 5 && (lowerTeam.includes('network') || lowerTeam.includes('voice') || lowerTeam.includes('fts'))) dismissAlert('network');

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

  const getItemHeight = useCallback(
    (teamName: string) => {
      const rows = localOnCall.filter((r) => r.team === teamName);
      // Formula tuned for cellHeight: 75 and margin: 12
      // Header (~60px) + rows (~40px each)
      const rowHeight = Math.ceil((rows.length * 40 + 65) / 75);
      return Math.max(2, rowHeight);
    },
    [localOnCall]
  );

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
    
    // Optimistic Update
    setLocalOnCall((prev) => [...prev, initialRow]);

    // 1. Add the team data
    const success = await window.api?.updateOnCallTeam(name, [initialRow]);
    
    if (success) {
      // 2. Calculate and persist safe layout position to prevent overlaps
      // Default behavior: place at bottom of the list
      // We look at all existing layout entries to find the lowest point
      let maxY = 0;
      if (teamLayout) {
        Object.entries(teamLayout).forEach(([teamName, pos]) => {
           // Estimate height of this team to find its bottom
           // We can't access getItemHeight easily here for ALL teams efficiently without recalc, 
           // but we can trust the 'y' pos is the start. 
           // We need to know where it ends.
           // A safe heuristic is to assume max height of ~6 units if unknown, or just look at Y.
           // Better approach: Since GridStack packs them, finding the max Y start is a good baseline.
           if (pos.y >= maxY) {
             maxY = pos.y + 2; // Add 2 buffer units
           }
        });
      }

      const newLayout = {
        ...(teamLayout || {}),
        [name]: { x: 0, y: maxY + 2 } // Place well below others
      };

      // Get current team order including new team
      const currentTeams = Array.from(new Set(localOnCall.map(r => r.team)));
      if (!currentTeams.includes(name)) currentTeams.push(name);

      // Persist layout
      await window.api?.reorderOnCallTeams(currentTeams, newLayout);
      
      showToast(`Added team ${name}`, "success");
    } else {
      isLocalUpdateRef.current = false;
      // Revert optimistic update? Technically hard here without deep clone history.
      showToast("Failed to add team", "error");
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
    getItemHeight,
    setLocalOnCall
  };
}
