import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  RELAY_OPERATORS_COLLECTION,
  type OperatorAttribution,
  type RelayOperatorRecord,
} from '@shared/operators';
import { useToast } from '../components/Toast';
import { useCollection } from '../hooks/useCollection';
import { loadSelectedOperatorId, persistSelectedOperatorId } from '../services/operatorSelection';

export type OperatorContextValue = {
  operators: RelayOperatorRecord[];
  activeOperators: RelayOperatorRecord[];
  selectedOperator: RelayOperatorRecord | null;
  selectOperator: (id: string) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  requireAttribution: () => OperatorAttribution | null;
  loading: boolean;
  error: Error | null;
};

const OperatorContext = createContext<OperatorContextValue | null>(null);

export function OperatorProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { showToast } = useToast();
  const {
    data,
    loading,
    error: collectionError,
  } = useCollection<RelayOperatorRecord>(RELAY_OPERATORS_COLLECTION, { sort: 'displayName' });
  const [selectedOperatorId, setSelectedOperatorId] = useState(loadSelectedOperatorId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const lastInactiveNotificationRef = useRef<string | null>(null);

  const operators = useMemo(
    () => [...data].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [data],
  );
  const activeOperators = useMemo(
    () => operators.filter((operator) => operator.active),
    [operators],
  );
  const selectedOperator = useMemo(() => {
    const operator = operators.find(({ id }) => id === selectedOperatorId);
    return operator?.active ? operator : null;
  }, [operators, selectedOperatorId]);
  const error = useMemo(
    () => (collectionError ? new Error(collectionError) : null),
    [collectionError],
  );

  useEffect(() => {
    if (!selectedOperatorId || loading || collectionError) return;

    const storedOperator = operators.find(({ id }) => id === selectedOperatorId);
    if (storedOperator?.active) {
      lastInactiveNotificationRef.current = null;
      return;
    }

    persistSelectedOperatorId(null);
    setSelectedOperatorId(null);

    if (storedOperator && lastInactiveNotificationRef.current !== selectedOperatorId) {
      lastInactiveNotificationRef.current = selectedOperatorId;
      showToast('The selected operator is no longer active. Choose another operator.', 'info');
    }
  }, [collectionError, loading, operators, selectedOperatorId, showToast]);

  const selectOperator = useCallback((id: string) => {
    const normalizedId = id.trim() || null;
    lastInactiveNotificationRef.current = null;
    setSelectedOperatorId(normalizedId);
    persistSelectedOperatorId(normalizedId);
  }, []);

  const requireAttribution = useCallback((): OperatorAttribution | null => {
    if (!selectedOperator) {
      setPickerOpen(true);
      return null;
    }

    return {
      operatorId: selectedOperator.id,
      operatorName: selectedOperator.displayName,
    };
  }, [selectedOperator]);

  const value = useMemo<OperatorContextValue>(
    () => ({
      operators,
      activeOperators,
      selectedOperator,
      selectOperator,
      pickerOpen,
      setPickerOpen,
      requireAttribution,
      loading,
      error,
    }),
    [
      activeOperators,
      error,
      loading,
      operators,
      pickerOpen,
      requireAttribution,
      selectOperator,
      selectedOperator,
    ],
  );

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorContextValue {
  const context = useContext(OperatorContext);
  if (!context) {
    throw new Error('useOperator must be used within OperatorProvider');
  }
  return context;
}
