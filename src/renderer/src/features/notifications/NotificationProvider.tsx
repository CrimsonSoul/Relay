import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  defaultNotificationPreferences,
  NotificationPreferencesSchema,
  NotificationTargetSchema,
  type NotificationPreferences,
  type NotificationSource,
  type NotificationTarget,
} from '@shared/notifications';
import { quietNow, TicketPreferencesSchema } from '@shared/serviceDesk';
import {
  useToast,
  type ShowToast,
  type ToastOptions,
  type ToastType,
} from '../../components/Toast';
import { getPb } from '../../services/pocketbase';
import { createClientId } from '../../utils/clientId';
import { navigateTicketWorkspace } from '../tickets/ticketNavigation';

export const NOTIFICATION_NAVIGATION_EVENT = 'relay:notification-navigation';
export function openNotificationTarget(target: NotificationTarget): void {
  if (target.source === 'Tickets') {
    navigateTicketWorkspace({ destination: 'ticket', source: 'sdp', ticketId: target.ticketId });
  } else window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATION_EVENT, { detail: target }));
}
export type NotificationInput = {
  id?: string;
  source: NotificationSource;
  title: string;
  message: string;
  type: ToastType;
  target: NotificationTarget;
  at?: number;
  inbox?: boolean;
  toast?: boolean;
  desktop?: boolean;
  sound?: boolean;
  interrupt?: boolean;
  options?: ToastOptions;
};
export type RelayNotice = NotificationInput & { id: string; at: number; read: boolean };
type NotificationContextValue = {
  notices: RelayNotice[];
  preferences: NotificationPreferences;
  savePreferences: (next: NotificationPreferences) => void;
  storageError: string;
  publish: (input: NotificationInput) => void;
  markRead: (id?: string, source?: NotificationSource) => void;
  clear: (source?: NotificationSource, undoable?: boolean) => void;
  undoClear: () => void;
  clearedCount: number;
};
const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);
export const useNotifications = () => useContext(NotificationContext);

export function NotificationProvider({ children }: Readonly<PropsWithChildren>) {
  const { showToast, dismissDelivery } = useToast();
  const storageKey = `relay:notifications:${getPb().baseURL}`;
  const [preferences, setPreferences] = useState(() => {
    try {
      return NotificationPreferencesSchema.parse(
        JSON.parse(localStorage.getItem(storageKey) ?? 'null'),
      );
    } catch {
      const defaults = defaultNotificationPreferences();
      try {
        const old = TicketPreferencesSchema.parse(
          JSON.parse(localStorage.getItem(`relay:sdp-alert-rules:${getPb().baseURL}`) ?? 'null'),
        );
        return {
          ...defaults,
          quietHoursEnabled: !!old.quietStart && !!old.quietEnd,
          quietStart: old.quietStart,
          quietEnd: old.quietEnd,
          snoozeUntil: old.snoozeUntil,
        };
      } catch {
        return defaults;
      }
    }
  });
  const [{ notices, cleared }, setInbox] = useState<{
    notices: RelayNotice[];
    cleared: RelayNotice[];
  }>({ notices: [], cleared: [] });
  const setNotices = useCallback((update: (old: RelayNotice[]) => RelayNotice[]) => {
    setInbox((old) => ({ ...old, notices: update(old.notices) }));
  }, []);
  const [storageError, setStorageError] = useState('');
  const seen = useRef(new Set<string>());
  const lastSound = useRef(0);
  const current = useRef({ preferences, showToast, dismissDelivery });
  current.current = { preferences, showToast, dismissDelivery };
  const savePreferences = useCallback(
    (next: NotificationPreferences) => {
      const parsed = NotificationPreferencesSchema.parse(next);
      setPreferences(parsed);
      try {
        localStorage.setItem(storageKey, JSON.stringify(parsed));
        setStorageError('');
      } catch {
        setStorageError('Preferences apply to this session; device storage is unavailable.');
      }
    },
    [storageKey],
  );
  const clear = useCallback((source?: NotificationSource, undoable = false) => {
    if (!source || source === 'Tickets') current.current.dismissDelivery?.('ticket');
    setInbox((old) => ({
      notices: source ? old.notices.filter((notice) => notice.source !== source) : [],
      // Account resets must also purge any ticket entries waiting for Undo.
      cleared: undoable
        ? old.notices.filter((notice) => !source || notice.source === source)
        : old.cleared.filter((notice) => source && notice.source !== source),
    }));
  }, []);
  const undoClear = useCallback(() => {
    setInbox((old) => {
      const existingIds = new Set(old.notices.map((notice) => notice.id));
      return {
        notices: [...old.notices, ...old.cleared.filter((notice) => !existingIds.has(notice.id))]
          .sort((a, b) => b.at - a.at)
          .slice(0, 200),
        cleared: [],
      };
    });
  }, []);
  const markRead = useCallback(
    (id?: string, source?: NotificationSource) => {
      setNotices((old) =>
        old.map((notice) =>
          (!id || notice.id === id) && (!source || notice.source === source)
            ? { ...notice, read: true }
            : notice,
        ),
      );
    },
    [setNotices],
  );
  const publish = useCallback(
    (input: NotificationInput) => {
      const { preferences: prefs, showToast: toast } = current.current;
      const rule = prefs.sources[input.source];
      const level = input.type === 'success' ? 'info' : input.type;
      if (!rule.enabled || !rule[level]) return;
      const id = input.id ?? createClientId();
      if (seen.current.has(id)) return;
      seen.current.add(id);
      if (seen.current.size > 1000) seen.current.delete(seen.current.values().next().value!);
      const notice: RelayNotice = { ...input, id, at: input.at ?? Date.now(), read: false };
      if (input.inbox !== false) setNotices((old) => [notice, ...old].slice(0, 200));
      if (
        input.interrupt === false ||
        quietNow(
          {
            ...prefs,
            quietStart: prefs.quietHoursEnabled ? prefs.quietStart : '',
            rules: [],
            warningMinutes: 30,
          },
          Date.now(),
        )
      )
        return;
      const open = () => {
        markRead(id);
        if (input.options?.action) input.options.action.onClick();
        else openNotificationTarget(input.target);
      };
      if (prefs.toast && input.toast !== false)
        toast(input.message, input.type, {
          ...input.options,
          title: input.title,
          durationMs: input.options?.durationMs ?? 8000,
          action: { label: input.options?.action?.label ?? `Open ${input.source}`, onClick: open },
        });
      const desktop = globalThis.api?.runtime.kind === 'electron';
      if (desktop && prefs.desktop && input.desktop !== false)
        void globalThis.api
          ?.notifyTicket?.({
            title: `Relay — ${input.source.toLowerCase()}`,
            body: 'New activity needs attention. Open Relay to review.',
            target: input.target,
          })
          .catch(() => undefined);
      if (
        desktop &&
        prefs.sound &&
        (input.sound ?? rule.sound) &&
        Date.now() - lastSound.current >= 1000
      ) {
        lastSound.current = Date.now();
        void globalThis.api?.playAlertSound?.().catch(() => undefined);
      }
    },
    [markRead, setNotices],
  );
  useEffect(
    () =>
      globalThis.api?.onNotificationClick?.((target) => {
        const parsed = NotificationTargetSchema.safeParse(target);
        if (!parsed.success) return;
        const destination = parsed.data;
        setNotices((old) => readTarget(old, destination));
        openNotificationTarget(destination);
      }),
    [setNotices],
  );
  const value = useMemo(
    () => ({
      notices,
      preferences,
      savePreferences,
      storageError,
      publish,
      markRead,
      clear,
      undoClear,
      clearedCount: cleared.length,
    }),
    [
      notices,
      preferences,
      savePreferences,
      storageError,
      publish,
      markRead,
      clear,
      undoClear,
      cleared.length,
    ],
  );
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

/** Preserve each source's detector and action; deliver operational events through one policy. */
export function useOperationalToast(source: Exclude<NotificationSource, 'Tickets'>): ShowToast {
  const context = useNotifications();
  const publish = context?.publish;
  const { showToast } = useToast();
  return useCallback<ShowToast>(
    (message, type, options) => {
      if (!publish || !options?.delivery || options.delivery === 'routine') {
        showToast(message, type, options);
        if (!publish && source === 'Problems')
          void globalThis.api?.playAlertSound?.().catch(() => undefined);
        return;
      }
      publish({
        source,
        title: options.title ?? source,
        message,
        type,
        target: { source },
        options,
      });
    },
    [publish, source, showToast],
  );
}

function readTarget(notices: RelayNotice[], destination: NotificationTarget): RelayNotice[] {
  return notices.map((notice) => {
    if (notice.target.source !== destination.source) return notice;
    if (
      destination.source === 'Tickets' &&
      notice.target.source === 'Tickets' &&
      notice.target.ticketId !== destination.ticketId
    )
      return notice;
    return { ...notice, read: true };
  });
}
