import { useState, useEffect, useCallback } from "react";
import type { BridgeHistoryEntry } from "@shared/ipc";

export function useBridgeHistory() {
  const [history, setHistory] = useState<BridgeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const data = await window.api?.getBridgeHistory();
      setHistory(data || []);
    } catch (e) {
      console.error("Failed to load bridge history:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const addHistory = useCallback(
    async (entry: Omit<BridgeHistoryEntry, "id" | "timestamp">) => {
      const result = await window.api?.addBridgeHistory(entry);
      if (result) {
        setHistory((prev) => [result, ...prev]);
      }
      return result;
    },
    []
  );

  const deleteHistory = useCallback(async (id: string) => {
    const success = await window.api?.deleteBridgeHistory(id);
    if (success) {
      setHistory((prev) => prev.filter((h) => h.id !== id));
    }
    return success;
  }, []);

  const clearHistory = useCallback(async () => {
    const success = await window.api?.clearBridgeHistory();
    if (success) {
      setHistory([]);
    }
    return success;
  }, []);

  return {
    history,
    loading,
    addHistory,
    deleteHistory,
    clearHistory,
    reloadHistory: loadHistory,
  };
}
