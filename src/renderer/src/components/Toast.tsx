import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
  useRef,
  useEffect,
} from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

type ToastOptions = {
  title?: string;
  durationMs?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
};

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  state: 'open' | 'closing';
  options?: ToastOptions;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType, options?: ToastOptions) => void;
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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const finalizeToastRemoval = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timeout = timeoutsRef.current.get(id);
    if (timeout) globalThis.clearTimeout(timeout);
    timeoutsRef.current.delete(id);
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, state: 'closing' } : toast)),
      );
      const existing = timeoutsRef.current.get(id);
      if (existing) globalThis.clearTimeout(existing);
      const exit = globalThis.setTimeout(() => finalizeToastRemoval(id), 160);
      timeoutsRef.current.set(id, exit);
    },
    [finalizeToastRemoval],
  );

  const showToast = useCallback(
    (message: string, type: ToastType, options?: ToastOptions) => {
      const id = globalThis.crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, type, state: 'open', options }]);

      const timeout = globalThis.setTimeout(() => {
        removeToast(id);
      }, options?.durationMs ?? 4000);
      timeoutsRef.current.set(id, timeout);
    },
    [removeToast],
  );

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((timeout) => {
        globalThis.clearTimeout(timeout);
      });
      timeouts.clear();
    };
  }, []);

  const toastContextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={toastContextValue}>
      {children}
      <div className="toast-container" aria-label="Notifications">
        {toasts.map((toast) => (
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
  const showToast = useCallback(() => {}, []);
  const noopContextValue = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={noopContextValue}>{children}</ToastContext.Provider>;
};
