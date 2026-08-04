import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { Severity } from '../alertUtils';
import { sanitizeHtml } from '../alertUtils';

export interface AlertDraftState {
  severity: Severity;
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
      return { ...state, [action.field]: action.value };
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

export type AlertDraftSetField = <Field extends keyof AlertDraftState>(
  field: Field,
  value: AlertDraftState[Field],
) => void;

export interface AlertDraftContextValue {
  state: AlertDraftState;
  setField: AlertDraftSetField;
  load: (nextState: AlertDraftState | ((currentState: AlertDraftState) => AlertDraftState)) => void;
  reset: () => void;
}

const AlertDraftContext = createContext<AlertDraftContextValue | null>(null);

interface AlertDraftProviderProps {
  children: React.ReactNode;
  initialState?: AlertDraftState;
}

export const AlertDraftProvider: React.FC<AlertDraftProviderProps> = ({
  children,
  initialState = initialAlertDraftState,
}) => {
  const [state, dispatch] = useReducer(alertDraftReducer, initialState);
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
