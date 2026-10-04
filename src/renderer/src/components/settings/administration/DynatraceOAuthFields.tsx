import { DYNATRACE_OAUTH_SCOPES, type DynatraceOAuthCredentials } from '@shared/dynatraceProblems';

/** `errorId` names the shared validation error; while set, all three fields are marked invalid
    and described by it, since the error covers the credentials as a whole. */
export function DynatraceOAuthFields({
  value,
  onChange,
  errorId,
}: Readonly<{
  value: DynatraceOAuthCredentials;
  onChange: (value: DynatraceOAuthCredentials) => void;
  errorId?: string;
}>) {
  const errorProps = errorId
    ? { 'aria-invalid': true, 'aria-describedby': errorId }
    : { 'aria-invalid': false };
  return (
    <>
      <p>
        In Dynatrace Account Management, create an OAuth client using the Client credentials grant.
        Assign these read scopes:
      </p>
      <ul>
        {DYNATRACE_OAUTH_SCOPES.map((scope) => (
          <li key={scope}>
            <code>{scope}</code>
          </li>
        ))}
      </ul>
      <p>
        The subject user also needs environment:roles:viewer and access to the relevant Grail
        buckets and workflows. This is a user permission, not an OAuth scope. Relay obtains and
        renews access tokens automatically and checks live Problems API access before saving.
      </p>
      <label className="administration-field">
        <span>OAuth client ID</span>
        <input
          className="tactile-input"
          value={value.clientId}
          autoComplete="off"
          maxLength={256}
          {...errorProps}
          onChange={(event) => onChange({ ...value, clientId: event.target.value })}
        />
      </label>
      <label className="administration-field">
        <span>OAuth client secret</span>
        <input
          className="tactile-input"
          type="password"
          value={value.clientSecret}
          autoComplete="off"
          maxLength={4096}
          {...errorProps}
          onChange={(event) => onChange({ ...value, clientSecret: event.target.value })}
        />
      </label>
      <label className="administration-field">
        <span>Dynatrace account UUID</span>
        <input
          className="tactile-input"
          value={value.accountUuid}
          autoComplete="off"
          maxLength={36}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          {...errorProps}
          onChange={(event) => onChange({ ...value, accountUuid: event.target.value })}
        />
      </label>
    </>
  );
}
