# Dynatrace Popouts Design

## Goal

Let Relay open and manage Dynatrace dashboard popouts so an operations desk can run Relay on one monitor and one or more Dynatrace dashboards on another without keeping a separate browser open.

The feature must be generic for public GitHub distribution. It must not contain hardcoded tenant, company, or work URLs.

## Approved Direction

Use dedicated Electron `BrowserWindow` popouts that load Dynatrace dashboard URLs directly. Do not embed Dynatrace in an iframe, do not use a renderer webview, and do not inject scripts into Dynatrace pages.

Saved dashboards are configured locally in Relay Settings. Each saved dashboard has:

- A user-facing name.
- A dashboard URL that must be HTTPS and under a Dynatrace-owned domain.
- Last known window bounds.
- Runtime state reported by the main process, such as `Live`, `Authenticating`, `Blocked`, `Load failed`, or `Closed`.

Dashboard definitions are local to each machine by default. They are not synced through the Relay PocketBase database because dashboard URLs may expose tenant names, shared-link tokens, or other environment details.

## User Interface

Settings gets a `Dynatrace Dashboards` section:

- Add a dashboard with name and URL.
- Edit a saved dashboard name or URL.
- Remove a saved dashboard.
- Open/focus each saved dashboard.
- Clear the isolated Dynatrace session for logout and troubleshooting.

The main sidebar footer gets a global runtime launcher:

- Place a `Dashboards` button above `Settings` and below the client count block.
- Use the same visual vocabulary as the existing sidebar buttons.
- Hide the button when no Dynatrace dashboards are configured.
- If one dashboard is configured, clicking the button opens or focuses that dashboard popout.
- If multiple dashboards are configured, clicking the button opens a compact Relay-styled popover that lists dashboard names and current runtime state.

Dynatrace is not a top-level Relay tab because opening a dashboard does not navigate Relay content. It should not live in the On-Call header because the dashboards support on-call work but are not owned by the on-call board.

## Main Process Architecture

Add a Dynatrace popout manager owned by the main process. It is responsible for:

- Loading and saving local dashboard settings.
- Validating dashboard start URLs.
- Creating and tracking popout windows by dashboard id.
- Focusing an existing popout instead of opening duplicates.
- Saving bounds on move, resize, and close.
- Broadcasting dashboard runtime state to renderer windows.
- Clearing the isolated Dynatrace session on request.

The manager should be separate from the existing local Relay aux-window route system. Relay aux windows load local app routes such as the on-call board; Dynatrace popouts load untrusted remote content and need a different security policy.

## Window Behavior

Each Dynatrace popout uses a persistent isolated Electron session partition, for example `persist:relay-dynatrace`, so Dynatrace and Microsoft SSO cookies survive Relay restarts.

Window preferences:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `backgroundThrottling: false`
- No Relay preload.

Disabling background throttling is required so Dynatrace's one-minute dashboard auto-refresh is not slowed because the popout is unfocused, covered, or on a secondary monitor. Relay does not own Dynatrace refresh; it must avoid interfering with it.

## Storage And IPC

Store dashboard definitions in a local JSON file under Relay's app data/config area, not in PocketBase. Include a small schema version so future migrations can rename fields without losing configured dashboards.

Expose typed IPC methods for renderer access:

- List configured dashboards and current runtime states.
- Add, update, and remove a dashboard.
- Open or focus a dashboard.
- Clear the Dynatrace session.

Dashboard runtime updates flow from the main process to all Relay renderer windows so the sidebar popover and Settings section stay in sync.

## URL And Navigation Policy

Dashboard start URLs:

- Must use `https:`.
- Must resolve to a Dynatrace-owned host, broadly `dynatrace.com` and subdomains such as tenant or app hosts.
- Must not accept arbitrary public web URLs.

Allowed top-level navigation:

- Dynatrace-owned HTTPS hosts.
- Microsoft identity hosts required for SSO, such as Microsoft Entra sign-in pages.

Blocked navigation:

- Unknown hosts.
- Non-HTTPS web URLs.
- File, data, javascript, or custom protocols.
- Unexpected popups or window-open attempts.

When navigation is blocked, keep the dashboard popout open, mark its state as `Blocked`, log a sanitized URL description, and offer the user an external-open path only if the implementation can do so through an explicit user action.

The Microsoft host allowlist exists only to support SSO redirects. A saved dashboard still has to start from a Dynatrace URL.

## Authentication State

Dynatrace normally logs itself out to its own sign-in page after the user's session expires. Treat that page as the primary auth-expired signal.

State model:

- `Live`: the popout is on a Dynatrace dashboard or accepted Dynatrace app route.
- `Authenticating`: the popout is on a Dynatrace sign-in route or Microsoft SSO route.
- `Blocked`: the popout attempted disallowed navigation.
- `Load failed`: the popout failed to load the page.
- `Closed`: the popout window is not open.

When a dashboard transitions from `Live` to `Authenticating`, Relay shows one toast: `Dynatrace dashboard signed out`. Do not repeat that toast every refresh or every redirect. After the user signs in and navigation returns to a Dynatrace dashboard route, Relay marks the dashboard `Live` again.

Relay must not attempt automatic login, credential storage, form filling, token extraction, or SSO bypass.

## Error Handling

Invalid configured URLs should be rejected in Settings with a concise inline error.

If a dashboard fails to load:

- Mark the runtime state as `Load failed`.
- Keep the popout available for manual reload.
- Do not remove or rewrite the saved dashboard URL.

If clearing the Dynatrace session fails:

- Keep the configured dashboard list intact.
- Show a Relay error toast.
- Log the sanitized failure details in the main process.

## Testing

Unit and renderer tests:

- Validate Dynatrace URL acceptance and rejection.
- Validate Microsoft SSO navigation is allowed only as a redirect path, not as a dashboard start URL.
- Validate unknown navigation is blocked.
- Validate dashboard settings add, edit, remove, and validation behavior.
- Validate the sidebar button is hidden with zero dashboards.
- Validate one-dashboard click opens the dashboard directly.
- Validate multi-dashboard click opens the popover with names and runtime states.
- Validate `Live` to `Authenticating` emits one toast.
- Validate the removed or closed dashboard state is reflected in the sidebar popover.

Main-process tests:

- Creating a Dynatrace popout uses isolated persistent session options and `backgroundThrottling: false`.
- Opening an already-open dashboard focuses the existing window.
- Window bounds are saved and reused.
- Session clearing calls the Dynatrace session clear path without deleting dashboard definitions.

Manual verification:

- Add a real Dynatrace dashboard URL.
- Sign in through Microsoft SSO in the popout.
- Confirm the dashboard auto-refreshes every minute while the window is unfocused.
- Confirm closing and reopening Relay preserves the Dynatrace session.
- Confirm a sign-out page is detected as `Authenticating` and raises one toast.
- Confirm unknown links are blocked or opened externally only through explicit user action.
