import { useMemo, useState } from 'react';
import { DynatraceConnectionSettings } from './DynatraceConnectionSettings';
import { DynatraceProblemScopeEditor } from './DynatraceProblemScopeEditor';
import { LocalOnlyNote } from './LocalOnlyNote';
import type { AdministrationPanelProps } from './types';

export function DynatraceServerPanel({ snapshot, execute }: Readonly<AdministrationPanelProps>) {
  const settings = useMemo(
    () => new Map(snapshot.settings.map((setting) => [setting.setting, setting])),
    [snapshot.settings],
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <section className="administration-panel" aria-labelledby="dynatrace-server-title">
      <header className="administration-panel__header">
        <div>
          <h3 id="dynatrace-server-title">Dynatrace Problems</h3>
          <p>The Relay server&apos;s connection to Dynatrace and which problems it keeps.</p>
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
      <LocalOnlyNote />
      {feedback && <output className="administration-feedback">{feedback}</output>}
    </section>
  );
}
