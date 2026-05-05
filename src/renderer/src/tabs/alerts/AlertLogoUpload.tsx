interface AlertLogoUploadProps {
  readonly logoDataUrl: string | null;
  readonly onSetLogo: () => void;
  readonly onRemoveLogo: () => void;
}

export function AlertLogoUpload({
  logoDataUrl,
  onSetLogo,
  onRemoveLogo,
}: AlertLogoUploadProps): React.JSX.Element {
  return (
    <div className="alerts-field">
      <span className="alerts-field-label">Company Logo</span>
      <div className="alerts-logo-controls">
        {logoDataUrl ? (
          <>
            <img src={logoDataUrl} alt="Company logo" className="alerts-logo-thumbnail" />
            <button type="button" className="alerts-logo-action" onClick={onRemoveLogo}>
              REMOVE
            </button>
          </>
        ) : (
          <button type="button" className="alerts-logo-action" onClick={onSetLogo}>
            UPLOAD
          </button>
        )}
      </div>
    </div>
  );
}
