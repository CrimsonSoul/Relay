# Relay Web Backup

Relay Web provides a backup way to use Relay from a desktop web browser on the same trusted LAN or VPN as the Relay server. It reuses the main Relay interface and data model, so operators do not need a separate web application or workflow.

## Requirements

- Relay must be running in server mode.
- **Direct LAN access** must be enabled for the Relay server.
- The browser must be desktop Chrome, Edge, or Safari with a viewport at least 1,024 pixels wide.
- The browser and Relay server must be connected through the same trusted LAN or an approved private VPN.

Phones and narrow tablet layouts are intentionally unsupported. Relay shows a focused larger-window message instead of compressing operational controls into a mobile layout.

## Enable Relay Web

1. On the Relay server PC, open **Settings**.
2. Open **Relay data**.
3. Enable **Relay Web** and choose a port that is different from the PocketBase port.
4. Save the setting.
5. Open the displayed Relay Web URL from a supported desktop browser.
6. Enter the Relay connection passphrase shown on the server PC.

The browser session remains signed in for up to one hour without activity and eight hours total. When it expires, Relay asks for the passphrase in place without discarding the mounted workspace.

## Supported Experience

Relay Web stays close to desktop parity by running the shared React renderer through a browser-safe runtime adapter. Core Compose, Alerts, On-Call, People, Servers, Knowledge, Service Status, Problems, settings, realtime updates, and protected workflows remain available.

Browser sessions appear in the server's client-presence list as `Web · Browser · address`. The address is sanitized before display.

The following device-specific operations stay on the desktop app:

- Native window controls and Electron popout management
- Server/client connection setup and reconfiguration
- Backup creation, restore, and backup retention controls
- Offline cache reads, queued offline mutations, and offline file caching
- Native alarm-file selection
- Image clipboard capture

## Notifications And Service Status

Relay Web shows the same in-app toasts and alarm sounds while its tab is open. It does not request browser notification permission, install a service worker, or send operating-system push notifications.

Dynatrace Problems always take priority when a toast could show both a Problem and a provider event. Provider toasts are limited to current outage-severity events from the last seven days. The Service Status page uses that same outage-focused seven-day window and retains the official status, X, and Downdetector links.

## Network And Security Boundary

Relay Web is an HTTP service for a managed trusted LAN or private VPN. HTTP does not encrypt browser traffic.

- Do not port-forward the Relay Web port.
- Do not publish it through public DNS, a public reverse proxy, or a WAN-facing firewall rule.
- Do not use it over an untrusted Wi-Fi network or the public internet.
- Use network controls to restrict the port to approved LAN/VPN devices.

The sign-in cookie is HTTP-only, path-scoped, and `SameSite=Strict`. Browser API requests require the active server-side session and same-origin request checks. Protected Owner, Administrator, and Publisher actions keep their existing capability checks and require server-local approval codes where the desktop flow does.

If the server, network, or browser is not trusted, use the managed Relay desktop client instead.
