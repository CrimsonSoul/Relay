import type { SdpMonitor } from '@shared/sdpAccount';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { linkSdpProblem } from '../../services/sdpLinkService';
import { SdpWorkflowAutoLink } from './sdpWorkflowAutoLink';
import { useEffect, useRef, useState } from 'react';
import {
  defaultTicketPreferences,
  TicketPreferencesSchema,
  type TicketPreferences,
} from '@shared/serviceDesk';
import { SDP_LINK_COLLECTION, type SdpLink } from '@shared/sdpLinks';
import { getPb } from '../../services/pocketbase';
import { useCollection } from '../../hooks/useCollection';
import { TactileButton } from '../../components/TactileButton';
import { useNotifications } from '../notifications/NotificationProvider';
import { SdpAlertEngine } from './sdpAlertEngine';

export const SDP_NOTIFICATIONS_RESET = 'relay:sdp-notifications-reset';
export function resetSdpNotifications(): void {
  window.dispatchEvent(new Event(SDP_NOTIFICATIONS_RESET));
}
function useSdpConnection(override?: boolean): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (
      override !== undefined ||
      globalThis.api?.runtime.kind !== 'electron' ||
      !globalThis.api?.sdpAccount
    )
      return;
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await globalThis.api!.sdpAccount!({ action: 'status' });
        if (active) setConnected(result.success && result.data?.status === 'connected');
      } catch {
        if (active) setConnected(false);
      } finally {
        pending = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [override]);
  return override ?? connected;
}
export function useSdpAlerts(connectedOverride?: boolean, resetKey = 0) {
  const connected = useSdpConnection(connectedOverride);
  const notifications = useNotifications();
  const publish = notifications?.publish;
  const clear = notifications?.clear;
  const [attention, setAttention] = useState(false);
  const previousReset = useRef(resetKey);
  const key = `relay:sdp-alert-rules:${getPb().baseURL}`;
  const [preferences, setPreferences] = useState<TicketPreferences>(() => {
    try {
      return TicketPreferencesSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    } catch {
      return { ...defaultTicketPreferences(), rules: [] };
    }
  });
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('Monitoring off');
  const engine = useRef(new SdpAlertEngine());
  const links = useCollection<SdpLink>(SDP_LINK_COLLECTION);
  const problems = useCollection<DynatraceProblemRecord>('dynatrace_problems');
  const current = useRef({
    preferences,
    linked: new Set(links.data.filter((link) => !link.suppressed).map((link) => link.ticketId)),
    links: links.data,
    problems: problems.data,
  });
  current.current = {
    preferences,
    linked: new Set(links.data.filter((link) => !link.suppressed).map((link) => link.ticketId)),
    links: links.data,
    problems: problems.data,
  };
  useEffect(() => {
    if (!connected) {
      engine.current.reset();
      clear?.('Tickets');
    }
    setAttention(false);
    setEnabled(connected);
    setMessage(connected ? 'Starting queue monitoring…' : 'Monitoring off');
  }, [connected, clear]);
  useEffect(() => {
    if (previousReset.current === resetKey) return;
    previousReset.current = resetKey;
    setAttention(false);
    setEnabled(false);
    engine.current.reset();
    clear?.('Tickets');
    setMessage('Monitoring off · Saved data cleared');
  }, [resetKey, clear]);
  useEffect(() => {
    const reset = () => {
      setEnabled(false);
      engine.current.reset();
      clear?.('Tickets');
      setMessage('Monitoring paused');
    };
    window.addEventListener(SDP_NOTIFICATIONS_RESET, reset);
    return () => window.removeEventListener(SDP_NOTIFICATIONS_RESET, reset);
  }, [clear]);
  useEffect(() => {
    if (!enabled || !connected || !globalThis.api?.sdpAccount) return;
    const evaluator = engine.current;
    const autoLink = new SdpWorkflowAutoLink();
    let active = true;
    let running = false;
    let after: number | undefined;
    let generation: string | undefined;
    const linkWorkflowTickets = async (monitor: SdpMonitor, coverage: string) => {
      try {
        const linked = await autoLink.scan(
          monitor.tickets,
          current.current.problems,
          current.current.links,
          async (input) => {
            const result = await globalThis.api!.sdpAccount!({
              action: 'verifyWorkflowTicket',
              id: input.ticketId,
              problemId: input.problemId,
              environment: input.environment,
            });
            if (!result.success || result.data?.status !== 'connected')
              throw new Error('SdpAlerts: SDP operation did not return the expected result.');
            return result.data.workflowTicketMatch === true;
          },
          (input) => linkSdpProblem(input, true),
          () => active,
        );
        if (active && linked)
          setMessage(`${coverage} · ${linked} workflow ticket${linked === 1 ? '' : 's'} linked`);
      } catch {
        if (active) {
          setAttention(true);
          setMessage(
            `${coverage} · Automatic linking will retry; check the SDP and Relay connections.`,
          );
        }
      }
    };
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const result = await globalThis.api!.sdpAccount!({ action: 'monitorQueues', after });
        if (!active) return;
        if (!result.success || !result.data)
          throw new Error('SdpAlerts: SDP operation did not return the expected result.');
        if (result.data.monitoring?.state === 'backoff') {
          setAttention(true);
          evaluator.reset();
          clear?.('Tickets');
          after = undefined;
          setMessage(
            `${monitorFailure(result.data.monitoring.failure)} Next check ${new Date(result.data.monitoring.nextCheckAt).toLocaleTimeString()}.`,
          );
          return;
        }
        const { monitor } = result.data;
        if (!monitor) return;
        setAttention(false);
        if (generation && generation !== monitor.generation) clear?.('Tickets');
        generation = monitor.generation;
        after = monitor.fetchedAt;
        const deliveries = evaluator.evaluate(
          monitor,
          { ...current.current.preferences, quietStart: '', quietEnd: '', snoozeUntil: 0 },
          current.current.linked,
        );
        for (const delivery of deliveries) {
          const { notice, rule } = delivery;
          publish?.({
            id: `${monitor.generation}:${notice.id}`,
            source: 'Tickets',
            title: `Ticket #${notice.number}`,
            message: `${rule.name} · ${notice.event}`,
            type: notice.event === 'sla-breached' ? 'error' : 'info',
            target: { source: 'Tickets', ticketId: notice.ticketId },
            at: notice.at,
            inbox: rule.inbox,
            toast: rule.toast,
            desktop: rule.desktop,
            sound: rule.sound,
            options: { delivery: 'ticket', action: undefined },
          });
        }
        const coverage = monitor.truncated
          ? 'Partial coverage: newest 1,000 per queue'
          : `${monitor.tickets.length} tickets checked`;
        setMessage(`${coverage} · ${new Date(monitor.fetchedAt).toLocaleTimeString()}`);
        await linkWorkflowTickets(monitor, coverage);
      } catch {
        if (active) {
          setAttention(true);
          engine.current.reset();
          clear?.('Tickets');
          after = undefined;
          setMessage('Waiting for the Relay server. Reconnecting automatically…');
        }
      } finally {
        running = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
      evaluator.reset();
      void globalThis.api
        ?.sdpAccount?.({ action: 'monitorQueues', enabled: false })
        .catch(() => undefined);
    };
  }, [enabled, connected, publish, clear]);
  function savePreferences(next: TicketPreferences) {
    setPreferences(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setMessage('Rules apply to this session; device storage is unavailable.');
    }
  }
  return { connected, enabled, setEnabled, attention, message, preferences, savePreferences };
}
export function SdpAlertControls({
  state,
  onRules,
}: Readonly<{
  state: ReturnType<typeof useSdpAlerts>;
  onRules: () => void;
}>) {
  return (
    <section aria-label="Ticket monitoring">
      <div className="ticket-actions">
        <TactileButton
          size="sm"
          disabled={!state.connected}
          onClick={() => state.setEnabled(!state.enabled)}
        >
          {state.enabled ? 'Stop monitoring' : 'Monitor queues'}
        </TactileButton>
        <TactileButton size="sm" variant="ghost" onClick={onRules}>
          Ticket rules
        </TactileButton>
      </div>
      <p className="ticket-mode-note">
        <output>{state.enabled ? state.message : 'Monitoring paused'}</output>
      </p>
      <details className="sdp-monitor-help">
        <summary>How ticket monitoring works</summary>
        <p>
          Queues are checked every 30 seconds while Relay is running and your SDP account is
          connected, including when you use another tab. A full check runs every five minutes.
          Coverage is limited to 1,000 tickets per queue; the first scan establishes a baseline.
          Busy queues may require another scan for replies. Matching NOC workflow tickets are
          automatically linked after their description confirms the exact Dynatrace problem URL. Up
          to five candidates are checked per scan; ambiguous matches stay unlinked. Unlinking
          prevents automatic relinking across the workspace. Ticket rules are opt-in.
        </p>
      </details>
    </section>
  );
}

function monitorFailure(kind?: string): string {
  switch (kind) {
    case 'timeout':
      return 'The queue scan took too long.';
    case 'invalid':
      return 'Relay could not read an SDP queue response.';
    case 'throttled':
      return 'SDP requested a pause before more API calls.';
    case 'denied':
      return 'SDP access needs to be verified again.';
    case 'outage':
      return 'SDP could not be reached.';
    default:
      return 'Queue monitoring could not complete.';
  }
}
