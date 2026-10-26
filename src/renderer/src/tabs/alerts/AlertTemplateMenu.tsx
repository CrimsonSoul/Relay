import { useState } from 'react';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { TactileButton } from '../../components/TactileButton';
import { ALERT_GUIDE_TEMPLATES, type AlertGuideTemplate } from './guideTemplates';

type AlertTemplateMenuProps = {
  disabled: boolean;
  onChoose: (template: AlertGuideTemplate) => void;
};

/** Command-bar menu that starts the draft from one of the built-in guide templates. */
export function AlertTemplateMenu({ disabled, onChoose }: Readonly<AlertTemplateMenuProps>) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const items: ContextMenuItem[] = ALERT_GUIDE_TEMPLATES.map((template) => ({
    label: template.label,
    onClick: () => onChoose(template),
  }));

  return (
    <>
      <TactileButton
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        disabled={disabled}
        tooltip="Start a guide from a built-in template"
        icon={
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6M12 12v6M9 15h6" />
          </svg>
        }
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        New from Template
      </TactileButton>
      {position && (
        <ContextMenu
          x={position.x}
          y={position.y}
          items={items}
          onClose={() => setPosition(null)}
        />
      )}
    </>
  );
}
