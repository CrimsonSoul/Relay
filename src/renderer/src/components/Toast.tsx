import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
  useRef,
  useEffect,
  useReducer,
} from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastDelivery = 'routine' | 'cloud-outage' | 'dynatrace-problem';

export type ToastOptions = {
  title?: string;
  durationMs?: number;
  delivery?: ToastDelivery;
  action?: {
    label: string;
    onClick: () => void;
  };
};

export type ShowToast = (message: string, type: ToastType, options?: ToastOptions) => void;

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  state: 'queued' | 'open' | 'closing';
  options?: ToastOptions;
}

interface ToastContextType {
  showToast: ShowToast;
}

type ToastAction =
  | { type: 'show'; toast: ToastMessage }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }
  | { type: 'remove'; id: string };

function deliveryOf(toast: ToastMessage): ToastDelivery {
  return toast.options?.delivery ?? 'routine';
}

function isOperationalToast(toast: ToastMessage): boolean {
  return deliveryOf(toast) !== 'routine';
}

function toastReducer(current: ToastMessage[], action: ToastAction): ToastMessage[] {
  switch (action.type) {
    case 'show': {
      if (deliveryOf(action.toast) !== 'dynatrace-problem') {
        return [...current, action.toast];
      }
      return [
        ...current.map((toast) =>
          deliveryOf(toast) === 'cloud-outage' && toast.state === 'open'
            ? { ...toast, state: 'queued' as const }
            : toast,
        ),
        action.toast,
      ];
    }
    case 'activate':
      return current.map((toast) =>
        toast.id === action.id && toast.state === 'queued' ? { ...toast, state: 'open' } : toast,
      );
    case 'close':
      return current.map((toast) =>
        toast.id === action.id && toast.state === 'open' ? { ...toast, state: 'closing' } : toast,
      );
    case 'remove':
      return current.filter((toast) => toast.id !== action.id);
  }
}

function findNextOperationalId(toasts: ToastMessage[]): string | null {
  const queued = toasts.filter((toast) => toast.state === 'queued');
  return (
    queued.find((toast) => deliveryOf(toast) === 'dynatrace-problem')?.id ??
    queued.find((toast) => deliveryOf(toast) === 'cloud-outage')?.id ??
    null
  );
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const getToastMeta = (type: ToastType) => {
  if (type === 'success') {
    return {
      title: 'Success',
    };
  }

  if (type === 'error') {
    return {
      title: 'Error',
    };
  }

  if (type === 'warning') {
    return {
      title: 'Warning',
    };
  }

  return {
    title: 'Notice',
  };
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const autoCloseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const finalizeToastRemoval = useCallback((id: string) => {
    dispatch({ type: 'remove', id });
    const autoCloseTimer = autoCloseTimersRef.current.get(id);
    if (autoCloseTimer) globalThis.clearTimeout(autoCloseTimer);
    autoCloseTimersRef.current.delete(id);
    const exitTimer = exitTimersRef.current.get(id);
    if (exitTimer) globalThis.clearTimeout(exitTimer);
    exitTimersRef.current.delete(id);
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      dispatch({ type: 'close', id });
      const autoCloseTimer = autoCloseTimersRef.current.get(id);
      if (autoCloseTimer) globalThis.clearTimeout(autoCloseTimer);
      autoCloseTimersRef.current.delete(id);
      const existing = exitTimersRef.current.get(id);
      if (existing) globalThis.clearTimeout(existing);
      const exit = globalThis.setTimeout(() => finalizeToastRemoval(id), 160);
      exitTimersRef.current.set(id, exit);
    },
    [finalizeToastRemoval],
  );

  const showToast = useCallback<ShowToast>(
    (message: string, type: ToastType, options?: ToastOptions) => {
      const id = globalThis.crypto.randomUUID();
      const delivery = options?.delivery ?? 'routine';
      if (delivery === 'dynatrace-problem') {
        const interruptedCloud = toastsRef.current.find(
          (toast) => deliveryOf(toast) === 'cloud-outage' && toast.state === 'open',
        );
        if (interruptedCloud) {
          const timer = autoCloseTimersRef.current.get(interruptedCloud.id);
          if (timer) globalThis.clearTimeout(timer);
          autoCloseTimersRef.current.delete(interruptedCloud.id);
        }
      }
      dispatch({
        type: 'show',
        toast: {
          id,
          message,
          type,
          state: delivery === 'routine' ? 'open' : 'queued',
          options,
        },
      });
    },
    [],
  );

  const hasActiveOperationalToast = toasts.some(
    (toast) => isOperationalToast(toast) && toast.state !== 'queued',
  );
  const nextOperationalId = hasActiveOperationalToast ? null : findNextOperationalId(toasts);

  useEffect(() => {
    if (!nextOperationalId) return;
    dispatch({ type: 'activate', id: nextOperationalId });
  }, [nextOperationalId]);

  useEffect(() => {
    const openToasts = new Map(
      toasts.filter((toast) => toast.state === 'open').map((toast) => [toast.id, toast]),
    );

    for (const [id, timer] of autoCloseTimersRef.current) {
      if (openToasts.has(id)) continue;
      globalThis.clearTimeout(timer);
      autoCloseTimersRef.current.delete(id);
    }

    for (const toast of openToasts.values()) {
      if (autoCloseTimersRef.current.has(toast.id)) continue;
      const timer = globalThis.setTimeout(
        () => removeToast(toast.id),
        toast.options?.durationMs ?? 4000,
      );
      autoCloseTimersRef.current.set(toast.id, timer);
    }
  }, [removeToast, toasts]);

  useEffect(() => {
    const autoCloseTimers = autoCloseTimersRef.current;
    const exitTimers = exitTimersRef.current;
    return () => {
      autoCloseTimers.forEach((timeout) => {
        globalThis.clearTimeout(timeout);
      });
      autoCloseTimers.clear();
      exitTimers.forEach((timeout) => {
        globalThis.clearTimeout(timeout);
      });
      exitTimers.clear();
    };
  }, []);

  const toastContextValue = useMemo(() => ({ showToast }), [showToast]);
  const visibleToasts = toasts.filter((toast) => toast.state !== 'queued');
  const orderedToasts = [
    ...visibleToasts.filter(isOperationalToast),
    ...visibleToasts.filter((toast) => !isOperationalToast(toast)),
  ];

  return (
    <ToastContext.Provider value={toastContextValue}>
      {children}
      <div className="toast-container" aria-label="Notifications">
        {orderedToasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            data-motion="toast"
            data-state={toast.state}
          >
            {toast.type === 'error' ? (
              <div className="toast-content" role="alert" aria-live="assertive">
                <div className="toast-title">
                  {toast.options?.title ?? getToastMeta(toast.type).title}
                </div>
                <div className="toast-message">{toast.message}</div>
                {toast.options?.action && (
                  <button
                    type="button"
                    className="toast-action"
                    onClick={() => {
                      removeToast(toast.id);
                      toast.options?.action?.onClick();
                    }}
                  >
                    {toast.options.action.label}
                  </button>
                )}
              </div>
            ) : (
              <output className="toast-content" aria-live="polite">
                <div className="toast-title">
                  {toast.options?.title ?? getToastMeta(toast.type).title}
                </div>
                <div className="toast-message">{toast.message}</div>
                {toast.options?.action && (
                  <button
                    type="button"
                    className="toast-action"
                    onClick={() => {
                      removeToast(toast.id);
                      toast.options?.action?.onClick();
                    }}
                  >
                    {toast.options.action.label}
                  </button>
                )}
              </output>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const NoopToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const showToast = useCallback<ShowToast>(() => {}, []);
  const noopContextValue = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={noopContextValue}>{children}</ToastContext.Provider>;
};
