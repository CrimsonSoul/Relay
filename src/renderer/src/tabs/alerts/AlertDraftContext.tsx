import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import type { Severity } from '../alertUtils';
import { sanitizeHtml } from '../alertUtils';
import { secureStorage } from '../../utils/secureStorage';

export interface AlertDraftState {
  severity: Severity;
  /** False until the operator picks a severity or loads a saved alert; INFO is only a default. */
  severityConfirmed: boolean;
  subject: string;
  bodyHtml: string;
  sender: string;
  recipient: string;
  clickThroughUrl: string;
  updateNumber: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  eventTimeSourceTz: string;
}

export const initialAlertDraftState: AlertDraftState = {
  severity: 'INFO',
  severityConfirmed: false,
  subject: '',
  bodyHtml: '',
  sender: '',
  recipient: '',
  clickThroughUrl: '',
  updateNumber: 0,
  eventTimeStart: '',
  eventTimeEnd: '',
  eventTimeSourceTz: 'America/Chicago',
};

const STORED_SEVERITIES: Readonly<Record<Severity, true>> = {
  ISSUE: true,
  MAINTENANCE: true,
  INFO: true,
  RESOLVED: true,
};

function isBlankDraft(state: AlertDraftState): boolean {
  return (Object.keys(initialAlertDraftState) as Array<keyof AlertDraftState>).every(
    (field) => state[field] === initialAlertDraftState[field],
  );
}

/**
 * The draft this workstation saved before a reload. Each field falls back to its blank value on
 * its own when missing or of the wrong type, so one corrupt field never discards the rest.
 */
function readStoredAlertDraft(storageKey: string): AlertDraftState | null {
  const stored = secureStorage.getItemSync<unknown>(storageKey);
  if (typeof stored !== 'object' || stored === null) return null;
  const record = stored as Record<string, unknown>;
  const draft = { ...initialAlertDraftState } as Record<string, unknown>;
  for (const field of Object.keys(initialAlertDraftState)) {
    if (typeof record[field] === typeof draft[field]) draft[field] = record[field];
  }
  const restored = draft as unknown as AlertDraftState;
  if (!Object.hasOwn(STORED_SEVERITIES, restored.severity)) {
    restored.severity = initialAlertDraftState.severity;
    restored.severityConfirmed = false;
  }
  restored.bodyHtml = sanitizeHtml(restored.bodyHtml);
  return restored;
}

type AlertDraftAction =
  | {
      type: 'SET_FIELD';
      field: keyof AlertDraftState;
      value: AlertDraftState[keyof AlertDraftState];
    }
  | {
      type: 'LOAD';
      nextState: AlertDraftState | ((currentState: AlertDraftState) => AlertDraftState);
    }
  | { type: 'RESET' };

const alertDraftReducer = (state: AlertDraftState, action: AlertDraftAction): AlertDraftState => {
  switch (action.type) {
    case 'SET_FIELD':
      return action.field === 'severity'
        ? { ...state, severity: action.value as Severity, severityConfirmed: true }
        : { ...state, [action.field]: action.value };
    case 'LOAD': {
      const nextState =
        typeof action.nextState === 'function' ? action.nextState(state) : action.nextState;
      return { ...nextState, bodyHtml: sanitizeHtml(nextState.bodyHtml) };
    }
    case 'RESET':
      return initialAlertDraftState;
    default:
      return state;
  }
};

type AlertDraftSetField = <Field extends keyof AlertDraftState>(
  field: Field,
  value: AlertDraftState[Field],
) => void;

interface AlertDraftContextValue {
  state: AlertDraftState;
  setField: AlertDraftSetField;
  load: (nextState: AlertDraftState | ((currentState: AlertDraftState) => AlertDraftState)) => void;
  reset: () => void;
}

const AlertDraftContext = createContext<AlertDraftContextValue | null>(null);

interface AlertDraftProviderProps {
  children: React.ReactNode;
  initialState?: AlertDraftState;
  /**
   * secureStorage (localStorage) key that keeps the unsent draft on this workstation across
   * reloads; never synced to PocketBase. A blank draft removes the key.
   */
  storageKey?: string;
}

export const AlertDraftProvider: React.FC<Readonly<AlertDraftProviderProps>> = ({
  children,
  initialState = initialAlertDraftState,
  storageKey,
}) => {
  const [state, dispatch] = useReducer(
    alertDraftReducer,
    initialState,
    (fallback) => (storageKey ? readStoredAlertDraft(storageKey) : null) ?? fallback,
  );
  useEffect(() => {
    if (!storageKey) return;
    if (isBlankDraft(state)) secureStorage.removeItem(storageKey);
    else secureStorage.setItemSync(storageKey, state);
  }, [state, storageKey]);
  const setField = useCallback<AlertDraftSetField>((field, value) => {
    dispatch({ type: 'SET_FIELD', field, value });
  }, []);
  const load = useCallback<AlertDraftContextValue['load']>((nextState) => {
    dispatch({ type: 'LOAD', nextState });
  }, []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);
  const value = useMemo(() => ({ state, setField, load, reset }), [load, reset, setField, state]);

  return <AlertDraftContext.Provider value={value}>{children}</AlertDraftContext.Provider>;
};

export const useAlertDraft = (): AlertDraftContextValue => {
  const context = useContext(AlertDraftContext);
  if (!context) throw new Error('useAlertDraft must be used within AlertDraftProvider');
  return context;
};
