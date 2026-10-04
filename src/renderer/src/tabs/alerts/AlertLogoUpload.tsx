import { TactileButton } from '../../components/TactileButton';

interface AlertLogoUploadProps {
  /** Names the logo slot, for example 'Company logo' or 'Footer logo'. */
  readonly label: string;
  readonly logoDataUrl: string | null;
  readonly onSetLogo: () => void;
  readonly onRemoveLogo: () => void;
}

export function AlertLogoUpload({
  label,
  logoDataUrl,
  onSetLogo,
  onRemoveLogo,
}: AlertLogoUploadProps): React.JSX.Element {
  return (
    <div className="alerts-field">
      <span className="alerts-field-label">{label}</span>
      <div className="alerts-logo-controls">
        {logoDataUrl ? (
          <>
            <img src={logoDataUrl} alt={label} className="alerts-logo-thumbnail" />
            <TactileButton size="xs" aria-label={`Remove ${label}`} onClick={onRemoveLogo}>
              Remove
            </TactileButton>
          </>
        ) : (
          <TactileButton size="xs" aria-label={`Upload ${label}`} onClick={onSetLogo}>
            Upload
          </TactileButton>
        )}
      </div>
    </div>
  );
}
