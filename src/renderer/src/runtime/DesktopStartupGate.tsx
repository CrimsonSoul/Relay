import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import type { StartupSnapshot } from '@shared/ipc';

export type DesktopStartupBridge = {
  getStartupState: () => Promise<StartupSnapshot>;
  onStartupStateChanged: (callback: (snapshot: StartupSnapshot) => void) => () => void;
  markStartupRendererMounted: () => void;
};

type AppProps = { launchIntent?: 'recovery' };
type AppModule = { default: ComponentType<AppProps> };

type DesktopStartupGateProps = Readonly<{
  bridge: DesktopStartupBridge;
  loadApp: () => Promise<AppModule>;
}>;

const INITIAL_SNAPSHOT: StartupSnapshot = {
  generation: 0,
  sequence: 0,
  phase: 'launching',
  message: 'Starting Relay…',
};

function StartupShell({ snapshot }: Readonly<{ snapshot: StartupSnapshot }>) {
  const failed = snapshot.phase === 'failed';
  return (
    <main
      className={`startup-shell${failed ? ' startup-shell--failed' : ''}`}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <div className="startup-shell__content">
        <p className="startup-shell__wordmark" aria-label="Relay">
          relay<span aria-hidden="true">.</span>
        </p>
        <div className="startup-shell__rail" aria-hidden="true">
          <span />
        </div>
        <p className="startup-shell__status">{snapshot.message}</p>
      </div>
    </main>
  );
}

function RecoveryProbation({ App }: Readonly<{ App: ComponentType<AppProps> }>) {
  return (
    <main className="recovery-probation" aria-busy="true">
      <div className="recovery-probation__app" aria-hidden="true" inert>
        <App />
      </div>
      <section className="recovery-probation__status" role="status" aria-live="polite">
        <div className="recovery-probation__signal" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>Finishing the update</h1>
        <p>Relay is checking this version for 60 seconds. It will reopen automatically.</p>
      </section>
    </main>
  );
}

export function DesktopStartupGate({ bridge, loadApp }: DesktopStartupGateProps) {
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [App, setApp] = useState<ComponentType<AppProps> | null>(null);
  const [appFailed, setAppFailed] = useState(false);
  const appPromise = useRef<Promise<AppModule> | null>(null);
  const mountedReported = useRef(false);

  appPromise.current ??= loadApp();

  // Rapid packaged relaunches must wire startup progress at commit time; a
  // painted shell cannot depend on the browser eventually flushing passive effects.
  useLayoutEffect(() => {
    let active = true;
    const acceptNewerSnapshot = (next: StartupSnapshot) => {
      if (!active) return;
      setSnapshot((current) => (next.sequence > current.sequence ? next : current));
    };
    const unsubscribe = bridge.onStartupStateChanged(acceptNewerSnapshot);
    void bridge.getStartupState().then(acceptNewerSnapshot, () => {
      if (!active) return;
      setSnapshot((current) =>
        current.sequence === 0
          ? { ...current, phase: 'failed', message: 'Relay could not read its startup state.' }
          : current,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  useLayoutEffect(() => {
    let active = true;
    void appPromise.current?.then(
      (module) => {
        if (active) setApp(() => module.default);
      },
      () => {
        if (active) setAppFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (snapshot.phase !== 'ready' || !App || mountedReported.current) return;
    mountedReported.current = true;
    bridge.markStartupRendererMounted();
  }, [App, bridge, snapshot.phase]);

  if (appFailed) {
    return (
      <StartupShell
        snapshot={{ ...snapshot, phase: 'failed', message: 'Relay could not load its interface.' }}
      />
    );
  }

  if (snapshot.phase !== 'ready' || !App) return <StartupShell snapshot={snapshot} />;
  return snapshot.recoveryMode === 'probation' ? (
    <RecoveryProbation App={App} />
  ) : (
    <App launchIntent={snapshot.launchIntent} />
  );
}
