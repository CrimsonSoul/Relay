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
  const [localLayout, setLocalLayout] = useState<TeamLayout>(teamLayout || {});
  const [weekRange, setWeekRange] = useState(getWeekRange());
  const [currentDay, setCurrentDay] = useState(new Date().getDay());

  // Sync local layout with prop updates
  useEffect(() => {
    if (teamLayout) {
      setLocalLayout(teamLayout);
    }
  }, [teamLayout]);

  // Ref to track if the update was triggered locally (optimistic update)
  // to avoid overwriting state with the same data when it broadcasts back.
  const isLocalUpdateRef = useRef(false);

  // ... (Alert Logic unchanged) ...

  useEffect(() => {
    // Skip sync if we just performed an optimistic update
    if (isLocalUpdateRef.current) {
      isLocalUpdateRef.current = false;
      return;
    }
    setLocalOnCall(onCall);
  }, [onCall]);

  // ... (Interval and Teams logic unchanged) ...

  // ... (handleUpdateRows, handleRemoveTeam, handleRenameTeam unchanged) ...

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
    
    // Optimistic Update: Add row
    setLocalOnCall((prev) => [...prev, initialRow]);

    // Calculate safe layout position to prevent overlaps
    // Default behavior: place at bottom of the list
    let maxY = 0;
    
    // Use localLayout state instead of prop to ensure we have the latest
    if (localLayout) {
      Object.entries(localLayout).forEach(([teamName, pos]) => {
         const h = getItemHeight(teamName);
         const bottom = pos.y + h;
         if (bottom > maxY) {
           maxY = bottom;
         }
      });
    }

    // Force explicit position for the new team
    const newTeamPos = { x: 0, y: maxY };
    const newLayout = {
      ...(localLayout || {}),
      [name]: newTeamPos
    };

    // Optimistic Update: Layout
    setLocalLayout(newLayout);

    // 1. Add the team data
    const success = await window.api?.updateOnCallTeam(name, [initialRow]);
    
    if (success) {
      // Get current team order including new team
      const currentTeams = Array.from(new Set(localOnCall.map(r => r.team)));
      if (!currentTeams.includes(name)) currentTeams.push(name);

      // Persist layout
      await window.api?.reorderOnCallTeams(currentTeams, newLayout);
      
      showToast(`Added team ${name}`, "success");
    } else {
      isLocalUpdateRef.current = false;
      showToast("Failed to add team", "error");
    }
  };

  return {
    localOnCall,
    localLayout, // Return this!
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
