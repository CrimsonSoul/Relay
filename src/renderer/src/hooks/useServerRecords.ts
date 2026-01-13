import { useState, useEffect, useCallback } from "react";
import type { ServerRecord } from "@shared/ipc";

export function useServerRecords() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadServers = useCallback(async () => {
    try {
      const data = await window.api?.getServers();
      setServers(data || []);
    } catch (e) {
      console.error("Failed to load servers:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const addServer = useCallback(
    async (server: Omit<ServerRecord, "id" | "createdAt" | "updatedAt">) => {
      try {
        if (!window.api) {
          console.error("[useServerRecords] API not available");
          return null;
        }
        const result = await window.api.addServerRecord(server);
        if (result) {
          setServers((prev) => {
            // Check if this was an update (same name)
            const existingIndex = prev.findIndex(
              (s) => s.name.toLowerCase() === result.name.toLowerCase()
            );
            if (existingIndex !== -1) {
              const updated = [...prev];
              updated[existingIndex] = result;
              return updated;
            }
            return [...prev, result];
          });
        }
        return result;
      } catch (e) {
        console.error("[useServerRecords] Failed to add server:", e);
        return null;
      }
    },
    []
  );

  const updateServer = useCallback(
    async (
      id: string,
      updates: Partial<Omit<ServerRecord, "id" | "createdAt">>
    ) => {
      try {
        if (!window.api) {
          console.error("[useServerRecords] API not available");
          return false;
        }
        const success = await window.api.updateServerRecord(id, updates);
        if (success) {
          setServers((prev) =>
            prev.map((s) =>
              s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
            )
          );
        }
        return success ?? false;
      } catch (e) {
        console.error("[useServerRecords] Failed to update server:", e);
        return false;
      }
    },
    []
  );

  const deleteServer = useCallback(async (id: string) => {
    try {
      if (!window.api) {
        console.error("[useServerRecords] API not available");
        return false;
      }
      const success = await window.api.deleteServerRecord(id);
      if (success) {
        setServers((prev) => prev.filter((s) => s.id !== id));
      }
      return success ?? false;
    } catch (e) {
      console.error("[useServerRecords] Failed to delete server:", e);
      return false;
    }
  }, []);

  const findByName = useCallback(
    (name: string) => {
      return servers.find((s) => s.name.toLowerCase() === name.toLowerCase());
    },
    [servers]
  );

  return {
    servers,
    loading,
    addServer,
    updateServer,
    deleteServer,
    findByName,
    reloadServers: loadServers,
  };
}
