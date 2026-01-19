import { useState, useEffect, useCallback } from "react";
import type { OnCallRecord } from "@shared/ipc";

export function useOnCallRecords() {
  const [onCall, setOnCall] = useState<OnCallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOnCall = useCallback(async () => {
    try {
      const data = await window.api?.getOnCall();
      setOnCall(data || []);
    } catch (e) {
      console.error("Failed to load on-call records:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOnCall();
  }, [loadOnCall]);

  const addRecord = useCallback(
    async (record: Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">) => {
      try {
        if (!window.api) {
          console.error("[useOnCallRecords] API not available");
          return null;
        }
        const result = await window.api.addOnCallRecord(record);
        if (result.success && result.data) {
          setOnCall((prev) => [...prev, result.data!]);
          return result.data;
        }
        return null;
      } catch (e) {
        console.error("[useOnCallRecords] Failed to add record:", e);
        return null;
      }
    },
    []
  );

  const updateRecord = useCallback(
    async (
      id: string,
      updates: Partial<Omit<OnCallRecord, "id" | "createdAt">>
    ) => {
      try {
        if (!window.api) {
          console.error("[useOnCallRecords] API not available");
          return false;
        }
        const result = await window.api.updateOnCallRecord(id, updates);
        if (result.success) {
          setOnCall((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, ...updates, updatedAt: Date.now() } : r
            )
          );
        }
        return result.success;
      } catch (e) {
        console.error("[useOnCallRecords] Failed to update record:", e);
        return false;
      }
    },
    []
  );

  const deleteRecord = useCallback(async (id: string) => {
    try {
      if (!window.api) {
        console.error("[useOnCallRecords] API not available");
        return false;
      }
      const result = await window.api.deleteOnCallRecord(id);
      if (result.success) {
        setOnCall((prev) => prev.filter((r) => r.id !== id));
      }
      return result.success;
    } catch (e) {
      console.error("[useOnCallRecords] Failed to delete record:", e);
      return false;
    }
  }, []);

  const deleteByTeam = useCallback(async (team: string) => {
    try {
      if (!window.api) {
        console.error("[useOnCallRecords] API not available");
        return false;
      }
      const result = await window.api.deleteOnCallByTeam(team);
      if (result.success) {
        setOnCall((prev) => prev.filter((r) => r.team !== team));
      }
      return result.success;
    } catch (e) {
      console.error("[useOnCallRecords] Failed to delete team records:", e);
      return false;
    }
  }, []);

  const getByTeam = useCallback(
    (team: string) => {
      return onCall.filter((r) => r.team === team);
    },
    [onCall]
  );

  const getTeams = useCallback(() => {
    return Array.from(new Set(onCall.map((r) => r.team)));
  }, [onCall]);

  return {
    onCall,
    loading,
    addRecord,
    updateRecord,
    deleteRecord,
    deleteByTeam,
    getByTeam,
    getTeams,
    reloadOnCall: loadOnCall,
  };
}
