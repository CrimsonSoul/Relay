import { useRef } from 'react';
import { SEVERITIES } from '../alertUtils';
import type { Severity } from '../alertUtils';

interface AlertSeveritySelectorProps {
  readonly severity: Severity;
  /** False while severity is still the untouched default: then no option is checked. */
  readonly confirmed: boolean;
  readonly setSeverity: (s: Severity) => void;
}

export function AlertSeveritySelector({
  severity,
  confirmed,
  setSeverity,
}: AlertSeveritySelectorProps): React.JSX.Element {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveSelection = (index: number) => {
    const next = (index + SEVERITIES.length) % SEVERITIES.length;
    setSeverity(SEVERITIES[next]!);
    buttonRefs.current[next]?.focus();
  };

  return (
    // The fieldset is the radiogroup, so its legend names the group exactly once.
    <fieldset
      className="alerts-field alerts-severity-fieldset"
      role="radiogroup"
      aria-labelledby="alerts-severity-legend"
    >
      <legend id="alerts-severity-legend" className="alerts-field-label">
        Severity
      </legend>
      <div className="alerts-severity-grid">
        {SEVERITIES.map((sev, index) => {
          // The untouched INFO default is not a choice: nothing is checked until the operator picks.
          const checked = confirmed && severity === sev;
          // Roving tab stop: the checked radio, or the first one while nothing is checked.
          const tabStop = confirmed ? checked : index === 0;
          return (
            <button
              key={sev}
              id={tabStop ? 'alerts-severity' : undefined}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={tabStop ? 0 : -1}
              className={`alerts-sev-btn${checked ? ' active' : ''}`}
              data-sev={sev}
              onClick={() => setSeverity(sev)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveSelection(index + 1);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveSelection(index - 1);
                }
              }}
            >
              {sev}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
