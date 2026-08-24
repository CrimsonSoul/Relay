import React, { useMemo, useState } from 'react';
import { DynatraceConnectionSettings } from './DynatraceConnectionSettings';
import { DynatraceProblemScopeEditor } from './DynatraceProblemScopeEditor';
import type { AdministrationPanelProps } from './types';

export function RelayServerPanel({ snapshot, execute }: Readonly<AdministrationPanelProps>) {
  const settings = useMemo(
    () => new Map(snapshot.settings.map((setting) => [setting.setting, setting])),
    [snapshot.settings],
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <section className="administration-panel" aria-labelledby="relay-server-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">Server</div>
          <h3 id="relay-server-title">Relay & Dynatrace</h3>
          <p>Only typed, path-independent settings can be changed remotely.</p>
        </div>
      </header>
      <div className="administration-setting-grid">
        <DynatraceConnectionSettings
          environment={settings.get('dynatrace.environment-url')}
          token={settings.get('dynatrace.platform-token')}
          execute={execute}
          onFeedback={setFeedback}
        />
        <DynatraceProblemScopeEditor
          profiles={settings.get('dynatrace.alerting-profiles')}
          execute={execute}
          onFeedback={setFeedback}
        />
      </div>
      <div className="administration-callout">
        <strong>Local-only maintenance boundary</strong>
        <span>
          Connection paths, backups, restores, folder pickers, and executable selection remain
          available only on the Relay server PC.
        </span>
      </div>
      {feedback && (
        <div className="administration-feedback" role="status">
          {feedback}
        </div>
      )}
    </section>
  );
}
