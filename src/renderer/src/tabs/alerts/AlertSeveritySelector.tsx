import { SEVERITIES } from '../alertUtils';
import type { Severity } from '../alertUtils';

interface AlertSeveritySelectorProps {
  readonly severity: Severity;
  readonly setSeverity: (s: Severity) => void;
}

export function AlertSeveritySelector({
  severity,
  setSeverity,
}: AlertSeveritySelectorProps): React.JSX.Element {
  return (
    <div className="alerts-field">
      <legend className="alerts-field-label" id="alerts-severity-label">
        Severity
      </legend>
      <fieldset className="alerts-severity-grid" aria-labelledby="alerts-severity-label">
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            type="button"
            className={`alerts-sev-btn${severity === sev ? ' active' : ''}`}
            data-sev={sev}
            onClick={() => setSeverity(sev)}
          >
            {sev}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
