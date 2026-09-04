# Relay Web

Relay Web provides backup access to Relay from a desktop browser on the same trusted LAN or approved private VPN as the Relay server. It uses the main Relay interface and the server's authoritative data, so operators do not need a separate web application or workflow.

## Requirements

- Relay must be running in server mode.
- **Direct LAN access** must be enabled for the Relay server.
- The browser must be desktop Chrome, Edge, or Safari with a viewport at least 1,024 pixels wide.
- The browser and Relay server must be connected through the same trusted LAN or an approved private VPN.

Phones and narrow tablet layouts are intentionally unsupported. Relay shows a focused larger-window message instead of compressing operational controls into a mobile layout. Maximize the desktop window or reduce browser zoom to provide at least 1,024 CSS pixels of usable width.

## Enable Relay Web

1. On the Relay server PC, open **Settings**.
2. Open **Relay data**.
3. Enable **Relay Web** and choose a port that is different from the PocketBase port.
4. Save the setting.
5. Open the displayed Relay Web URL from a supported desktop browser.
6. Enter the Relay connection passphrase shown on the server PC.

The browser session remains signed in for up to one hour without activity and eight hours total. When it expires, Relay asks for the passphrase in place without discarding the mounted workspace.

The sign-in screen identifies the Relay server and explains where to get the passphrase. The Web notice occupies its own space above the workspace header, so it does not cover operational counts or connection state. **Settings → About** reports the server name and version, running time, session deadline, data connection, live server updates, and the latest Dynatrace and Radar timestamps. Refresh status after reconnecting; these are observations, not a guarantee that an upstream service is healthy.

## Supported experience

Relay Web supports Compose, Alerts, On-Call, Knowledge (Wiki, Contacts, and Servers), Service Status, Dynatrace Problems, Dispatcher Radar, Settings, realtime updates, and protected workflows. Data Manager imports use the browser's file picker and report processed, imported, updated, and error counts while the selected file is applied to the Relay server.

Dispatcher Radar remains owned by Relay Desktop on the server PC. Relay Web receives validated Radar snapshots and live changes from that server session; it never receives CW Dashboard cookies or signs in to CW independently. If the CW session expires, open Relay Desktop on the server PC, sign in to CW Dashboard there, and then refresh Radar in the browser.

Owners and Administrators with settings permission can request **Sync now from Dynatrace** in Problems. Other browser operators can reload the stored Relay data; the control explains that this does not request an upstream sync.

For first-time Dynatrace setup, open **Settings → Administration → Relay server**, enter the environment URL and platform token, then choose **Review token replacement** and confirm your password. Relay saves both together through the protected server action. Once configured, URL and token replacements remain independent; replacing a token does not save an unsubmitted URL draft. Failed password confirmation clears the token and returns to entry so it can be entered again safely.

Browser navigation uses **Alt+Shift+1–7**, search uses **Alt+Shift+K**, and Settings uses **Alt+Shift+,**. Global navigation does not interrupt text entry. The shortcut reference displays the bindings for the active runtime.

Alerts accepts images explicitly pasted or dropped into the body, in addition to its file picker. PNG, JPEG, and WebP images are limited to 5 MiB. **Download Draft** starts a `relay-alert.eml` download; open it in Outlook, review recipients, and send. Calendar invites download as `relay-schedule.ics`; open the file in your calendar, review attendees, and send. Relay cannot confirm completion in the external application.

The following device-specific operations stay on the desktop app:

- Native window controls and Electron popout management
- Server/client connection setup and reconfiguration
- Backup creation, restore, and backup retention controls
- Offline cache reads, queued offline mutations, and offline file caching
- Restart-persistent Wiki upload queues; Relay Web upload queues are scoped to the current browser/server session
- Native alarm-file selection
- Unrestricted image clipboard capture (explicit image paste and drop are supported)

An interrupted browser PDF transfer can be recovered in **Manage Wiki** using **Reselect PDFs**. Select all original files with matching names and sizes; the transfer restarts from the beginning. Queued uploads with a missing source offer **Reselect PDF**, with server-side filename, size, checksum, and permission verification. Neither recovery path survives session expiry, sign-out, or a Relay server restart. No source files are persisted in browser storage.

## Notifications and service status

Relay Web shows in-app toasts while its workspace is mounted. Built-in alarm audio plays while the tab is open when the browser permits autoplay; visual alarms remain available if audio is blocked. Relay Web does not request browser notification permission, install a service worker, or send operating-system push notifications.

The Web notice includes **Test sound**, reports blocked playback, and shows the number of overdue alarms. Overdue alarms also mark the tab title and favicon. Keep the tab open; a successful sound test does not guarantee future playback if the browser later suspends the tab or changes its audio policy.

Dynatrace Problems take priority over provider-status notifications. Service Status reports the server's validated provider view, including separate Global, EMEA, APAC, and Federal rows for Juniper Mist. Planned maintenance does not create a provider notification.

## Network and security boundary

Relay Web is an HTTP service for a managed trusted LAN or private VPN. HTTP does not encrypt browser traffic.

- Do not port-forward the Relay Web port.
- Do not publish it through public DNS, a public reverse proxy, or a WAN-facing firewall rule.
- Do not use it over an untrusted Wi-Fi network or the public internet.
- Use network controls to restrict the port to approved LAN/VPN devices.

The sign-in cookie is HTTP-only, path-scoped, and `SameSite=Strict`. Browser API requests require the active server-side session and same-origin request checks. Protected Owner, Administrator, and Publisher actions keep their existing capability checks and require server-local approval codes where the desktop flow does.

If the server, network, or browser is not trusted, use the managed Relay desktop client instead.
