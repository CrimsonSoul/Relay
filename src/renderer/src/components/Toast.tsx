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
import { createClientId } from '../utils/clientId';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastDelivery =
  | 'routine'
  | 'ticket'
  | 'cloud-degradation'
  | 'cloud-outage'
  | 'radar-critical'
  | 'dynatrace-problem';

export type ToastOptions = {
  title?: string;
  durationMs?: number;
  delivery?: ToastDelivery;
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * Runs once when the toast leaves without its action being taken: it timed out, was
   * dismissed, was pushed out of the routine stack, or the provider unmounted.
   */
  onDismiss?: () => void;
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
  dismissDelivery?: (delivery: ToastDelivery) => void;
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

function deliveryPriority(delivery: ToastDelivery): number {
  switch (delivery) {
    case 'ticket':
    case 'dynatrace-problem':
      return 4;
    case 'radar-critical':
      return 3;
    case 'cloud-outage':
      return 2;
    case 'cloud-degradation':
      return 1;
    case 'routine':
      return 0;
  }
}

/**
 * Routine toasts stack visibly, so an error burst — a failing sync retrying, a
 * dropped connection fanning out across hooks — used to bury the UI under an
 * unbounded column. Cap the stack and drop the oldest routine entries: the
 * newest message is the one describing the current state.
 */
const MAX_ROUTINE_TOASTS = 4;

function capRoutineToasts(toasts: ToastMessage[]): ToastMessage[] {
  let overflow = toasts.filter((toast) => !isOperationalToast(toast)).length - MAX_ROUTINE_TOASTS;
  if (overflow <= 0) return toasts;
  // Operational toasts are exempt — their own priority queue decides which of
  // them is on screen, and none of them are ever bulk-generated.
  return toasts.filter((toast) => {
    if (overflow <= 0 || isOperationalToast(toast)) return true;
    overflow -= 1;
    return false;
  });
}

function toastReducer(current: ToastMessage[], action: ToastAction): ToastMessage[] {
  switch (action.type) {
    case 'show': {
      const incomingDelivery = deliveryOf(action.toast);
      if (incomingDelivery === 'routine') {
        return capRoutineToasts([...current, action.toast]);
      }
      return [
        ...current.map((toast) =>
          toast.state === 'open' &&
          isOperationalToast(toast) &&
          deliveryPriority(deliveryOf(toast)) < deliveryPriority(incomingDelivery)
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
    queued.find((toast) => deliveryOf(toast) === 'ticket')?.id ??
    queued.find((toast) => deliveryOf(toast) === 'radar-critical')?.id ??
    queued.find((toast) => deliveryOf(toast) === 'cloud-outage')?.id ??
    queued.find((toast) => deliveryOf(toast) === 'cloud-degradation')?.id ??
    null
  );
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/**
 * A toast states its own outcome ("Copied 4 recipients", "Couldn't save Leadership …"), so there is
 * no generic visible title. Severity is carried three ways: the rail colour, a shape glyph on the
 * first line (the pip grammar — filled square = error, diamond = warning, filled circle = success,
 * hollow ring = notice) so it survives forced colours and colour-blindness, and this prefix for
 * screen readers, because neither `role="alert"` nor the polite stack says whether it was an error.
 */
const SEVERITY_LABEL: Record<ToastType, string> = {
  success: 'Success:',
  error: 'Error:',
  warning: 'Warning:',
  info: 'Notice:',
};

const SEVERITY_SHAPE: Record<ToastType, React.ReactElement> = {
  error: <rect x="1" y="1" width="8" height="8" />,
  warning: <polygon points="5,0 10,5 5,10 0,5" />,
  success: <circle cx="5" cy="5" r="4.5" />,
  info: <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />,
};

const SeverityGlyph: React.FC<Readonly<{ type: ToastType }>> = ({ type }) => (
  <svg
    className={`toast-glyph toast-glyph--${type}`}
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    {SEVERITY_SHAPE[type]}
  </svg>
);

/** Longest message excerpt carried into the close button's accessible name. */
const DISMISS_NAME_MAX = 60;

function dismissLabel(message: string): string {
  const text = message.replaceAll(/\s+/g, ' ').trim();
  const excerpt = text.length > DISMISS_NAME_MAX ? `${text.slice(0, DISMISS_NAME_MAX - 1)}…` : text;
  return `Dismiss: ${excerpt}`;
}

const ToastBody: React.FC<
  Readonly<{ toast: ToastMessage; onAction: (toast: ToastMessage) => void }>
> = ({ toast, onAction }) => {
  const title = toast.options?.title;
  return (
    <>
      {title && (
        <div className="toast-title">
          <SeverityGlyph type={toast.type} />
          {title}
        </div>
      )}
      <span className="sr-only">{SEVERITY_LABEL[toast.type]} </span>
      <div className="toast-message">
        {!title && <SeverityGlyph type={toast.type} />}
        {toast.message}
      </div>
      {toast.options?.action && (
        <button type="button" className="toast-action" onClick={() => onAction(toast)}>
          {toast.options.action.label}
        </button>
      )}
    </>
  );
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
  const autoCloseDeadlinesRef = useRef<Map<string, number>>(new Map());
  /** Paused toasts keep the time they had left; hover or focus holds them open. */
  const pausedRemainingRef = useRef<Map<string, number>>(new Map());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dismissHandlersRef = useRef<Map<string, { onDismiss: () => void; rendered: boolean }>>(
    new Map(),
  );

  const clearAutoClose = useCallback((id: string) => {
    const autoCloseTimer = autoCloseTimersRef.current.get(id);
    if (autoCloseTimer) globalThis.clearTimeout(autoCloseTimer);
    autoCloseTimersRef.current.delete(id);
    autoCloseDeadlinesRef.current.delete(id);
  }, []);

  const finalizeToastRemoval = useCallback(
    (id: string) => {
      dispatch({ type: 'remove', id });
      clearAutoClose(id);
      pausedRemainingRef.current.delete(id);
      const exitTimer = exitTimersRef.current.get(id);
      if (exitTimer) globalThis.clearTimeout(exitTimer);
      exitTimersRef.current.delete(id);
    },
    [clearAutoClose],
  );

  const removeToast = useCallback(
    (id: string) => {
      dispatch({ type: 'close', id });
      clearAutoClose(id);
      pausedRemainingRef.current.delete(id);
      const existing = exitTimersRef.current.get(id);
      if (existing) globalThis.clearTimeout(existing);
      const exit = globalThis.setTimeout(() => finalizeToastRemoval(id), 160);
      exitTimersRef.current.set(id, exit);
    },
    [clearAutoClose, finalizeToastRemoval],
  );

  const scheduleAutoClose = useCallback(
    (id: string, delayMs: number) => {
      const timer = globalThis.setTimeout(() => removeToast(id), delayMs);
      autoCloseTimersRef.current.set(id, timer);
      autoCloseDeadlinesRef.current.set(id, Date.now() + delayMs);
    },
    [removeToast],
  );

  const pauseToast = useCallback(
    (id: string) => {
      if (pausedRemainingRef.current.has(id)) return;
      const deadline = autoCloseDeadlinesRef.current.get(id);
      if (deadline === undefined) return;
      clearAutoClose(id);
      pausedRemainingRef.current.set(id, Math.max(0, deadline - Date.now()));
    },
    [clearAutoClose],
  );

  const resumeToast = useCallback(
    (id: string) => {
      const remaining = pausedRemainingRef.current.get(id);
      if (remaining === undefined) return;
      pausedRemainingRef.current.delete(id);
      // Leave a short read-out window after the pointer or focus moves away.
      scheduleAutoClose(id, Math.max(remaining, 1_000));
    },
    [scheduleAutoClose],
  );

  const showToast = useCallback<ShowToast>(
    (message: string, type: ToastType, options?: ToastOptions) => {
      const id = createClientId();
      if (options?.onDismiss) {
        dismissHandlersRef.current.set(id, { onDismiss: options.onDismiss, rendered: false });
      }
      const delivery = options?.delivery ?? 'routine';
      if (delivery !== 'routine') {
        const interruptedToasts = toastsRef.current.filter(
          (toast) =>
            toast.state === 'open' &&
            isOperationalToast(toast) &&
            deliveryPriority(deliveryOf(toast)) < deliveryPriority(delivery),
        );
        for (const interruptedToast of interruptedToasts) {
          clearAutoClose(interruptedToast.id);
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
    [clearAutoClose],
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

    for (const id of autoCloseTimersRef.current.keys()) {
      if (openToasts.has(id)) continue;
      clearAutoClose(id);
    }
    for (const id of pausedRemainingRef.current.keys()) {
      if (!openToasts.has(id)) pausedRemainingRef.current.delete(id);
    }

    for (const toast of openToasts.values()) {
      if (autoCloseTimersRef.current.has(toast.id)) continue;
      if (pausedRemainingRef.current.has(toast.id)) continue;
      // Routine errors stay until the operator dismisses them; operational queue toasts keep
      // their timed hand-off so the next queued notice is never blocked.
      if (toast.type === 'error' && !isOperationalToast(toast)) continue;
      scheduleAutoClose(toast.id, toast.options?.durationMs ?? 4000);
    }
  }, [clearAutoClose, scheduleAutoClose, toasts]);

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

  // A toast with onDismiss reports leaving without its action, however it left: timeout,
  // Dismiss, eviction from the routine stack, or provider unmount. showToast registers the
  // handler and taking the action drops it, so only the action-less exits remain. A handler
  // fires only after its toast has been rendered, so a toast still waiting on its own
  // dispatch is never mistaken for one that left.
  useEffect(() => {
    const handlers = dismissHandlersRef.current;
    if (handlers.size === 0) return;
    const present = new Set(toasts.map((toast) => toast.id));
    // Snapshot: an onDismiss handler may show a new toast and register its own handler.
    for (const [id, handler] of new Map(handlers)) {
      if (present.has(id)) {
        handler.rendered = true;
        continue;
      }
      if (!handler.rendered) continue;
      handlers.delete(id);
      handler.onDismiss();
    }
  }, [toasts]);
  useEffect(() => {
    const handlers = dismissHandlersRef.current;
    return () => {
      const pending = [...handlers.values()];
      handlers.clear();
      for (const handler of pending) handler.onDismiss();
    };
  }, []);

  const takeToastAction = (toast: ToastMessage) => {
    dismissHandlersRef.current.delete(toast.id);
    removeToast(toast.id);
    toast.options?.action?.onClick();
  };

  const dismissDelivery = useCallback(
    (delivery: ToastDelivery) => {
      for (const toast of toastsRef.current)
        if (deliveryOf(toast) === delivery) finalizeToastRemoval(toast.id);
    },
    [finalizeToastRemoval],
  );
  const toastContextValue = useMemo(
    () => ({ showToast, dismissDelivery }),
    [showToast, dismissDelivery],
  );
  const visibleToasts = toasts.filter((toast) => toast.state !== 'queued');
  const orderedToasts = [
    ...visibleToasts.filter(isOperationalToast),
    ...visibleToasts.filter((toast) => !isOperationalToast(toast)),
  ];
  const errorToasts = orderedToasts.filter((toast) => toast.type === 'error');
  const politeToasts = orderedToasts.filter((toast) => toast.type !== 'error');

  const renderToast = (toast: ToastMessage) => (
    <div
      key={toast.id}
      className={`toast toast-${toast.type}`}
      data-motion="toast"
      data-state={toast.state}
      onMouseEnter={() => pauseToast(toast.id)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) resumeToast(toast.id);
      }}
      onFocus={() => pauseToast(toast.id)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        if (event.currentTarget.matches(':hover')) return;
        resumeToast(toast.id);
      }}
    >
      <div className="toast-content" role={toast.type === 'error' ? 'alert' : undefined}>
        <ToastBody toast={toast} onAction={takeToastAction} />
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => removeToast(toast.id)}
        aria-label={dismissLabel(toast.message)}
      >
        <svg
          aria-hidden="true"
          focusable="false"
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
  );

  return (
    <ToastContext.Provider value={toastContextValue}>
      {children}
      {/* The Messages region itself is not live. A live region inserted already holding text is
          often not read, so routine and warning toasts are appended into a polite stack that is
          mounted for the provider's whole life. Error toasts sit outside that stack, each its own
          role="alert" (the one live role announced on insertion), so nothing is read twice. */}
      <section className="toast-container" aria-label="Messages">
        {errorToasts.map(renderToast)}
        <div className="toast-stack" aria-live="polite">
          {politeToasts.map(renderToast)}
        </div>
      </section>
    </ToastContext.Provider>
  );
};

export const NoopToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const showToast = useCallback<ShowToast>(() => {}, []);
  const noopContextValue = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={noopContextValue}>{children}</ToastContext.Provider>;
};
