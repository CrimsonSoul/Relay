# Relay

Relay is an Electron desktop command center for operations teams managing people, systems, schedules, and incident communications.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-0a7ea4) ![Shell](https://img.shields.io/badge/shell-Electron%2042-47848f) ![UI](https://img.shields.io/badge/ui-React%2019-149eca) ![Language](https://img.shields.io/badge/language-TypeScript%206.0-2ea043)

## Snapshot

- Embedded PocketBase server/client mode with local-first storage and realtime sync
- Typed preload bridge with Zod-validated IPC contracts
- Feature tabs for compose, alerts, on-call, notes, knowledge, service status, people, and servers
- Sidebar client presence, connect toasts, and a unified connected/cached/offline indicator
- Dynatrace dashboard launcher with Relay-styled popout windows and isolated SSO session storage
- Electron hardening with context isolation, sandboxing, CSP, path validation, and domain-gated external navigation

## Preview

| Compose                                      | On-Call Board                               | People Directory                           |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| ![Compose tab](docs/screenshots/compose.png) | ![On-Call tab](docs/screenshots/oncall.png) | ![People tab](docs/screenshots/people.png) |

| Servers                                      | Service Status                                       | Settings And Connections                               |
| -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| ![Servers tab](docs/screenshots/servers.png) | ![Service status](docs/screenshots/cloud-status.png) | ![Settings modal](docs/screenshots/settings-modal.png) |

| Data Manager                                       | Notifications                                     | On-Call Popout                                        |
| -------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| ![Data Manager](docs/screenshots/data-manager.png) | ![Toast notification](docs/screenshots/toast.png) | ![On-call popout](docs/screenshots/oncall-popout.png) |

## Core Features

- **Compose**: Build bridge communication lists from contacts and saved groups, then start or schedule the bridge
- **On-Call Board**: Manage team and role coverage with drag-and-drop scheduling, lock control, export/copy tools, and popout support
- **People and Servers**: Search large directories, filter operational records, open context actions, and keep entity notes close to the record
- **Alerts**: Compose styled incident cards, apply severity formatting, schedule reminders, and capture them to disk or clipboard
- **Notes**: Maintain standalone tagged notes with reorderable cards and adjustable reading density
- **Knowledge Base**: Read server-managed PDF runbooks with nested document headings, local search, and on-demand offline caching
- **Service Status**: Monitor provider incident feeds across major cloud and SaaS vendors
- **Client Presence**: Show connected Relay clients in server mode, list hostnames on hover, and notify when clients connect
- **Dynatrace Dashboards**: Save Dynatrace dashboard URLs in Settings, launch them from the sidebar, support Microsoft SSO, and clear the dashboard session when needed
- **Data Management**: Export, import, reset, and restore Relay data from the Settings modal

## Knowledge Base Setup

The Knowledge tab is read-only for operators. On the Relay server, place PDFs in the `knowledge-base` folder under Relay's configuration data directory:

```text
knowledge-base/
├── General runbook.pdf
├── Monitoring/
│   └── Dynatrace triage.pdf
└── Network/
    └── Edge response.pdf
```

Root PDFs appear under **General**. One immediate folder level becomes the category; deeper folders are ignored. Relay accepts PDFs up to 50 MiB and 1,000 pages, watches the folder for changes, and also reconciles it every five minutes.

Relay extracts PDF bookmarks when available and otherwise infers a bounded two-level heading outline from page text. Clients receive searchable metadata in realtime and download PDF bytes only when an operator opens a document. There are no in-app upload, edit, download, print, or annotation controls.

## Docs

- `docs/architecture.md`: runtime model, data flow, and subsystem layout
- `docs/DEVELOPMENT.md`: service patterns, hooks, testing, and contributor conventions
- `docs/DESIGN.md`: current renderer styling and component conventions
- `docs/SECURITY.md`: trust boundaries, hardening, validation, and secret handling

## Quick Start

```bash
npm install
npm run dev
```

## Common Commands

```bash
npm run typecheck
npm run lint
npm test
npm run test:electron
npm run test:coverage
npm run build
```

## Screenshot Refresh

The README screenshots are generated from the Electron Playwright harness.

```bash
npm run build
npx playwright test tests/e2e/redesign-screenshots.spec.ts -c playwright.electron.config.ts
cp tmp/redesign-shots/compose.png docs/screenshots/compose.png
cp tmp/redesign-shots/oncall.png docs/screenshots/oncall.png
cp tmp/redesign-shots/people.png docs/screenshots/people.png
cp tmp/redesign-shots/servers.png docs/screenshots/servers.png
cp tmp/redesign-shots/cloud-status.png docs/screenshots/cloud-status.png
cp tmp/redesign-shots/settings-modal.png docs/screenshots/settings-modal.png
cp tmp/redesign-shots/data-manager.png docs/screenshots/data-manager.png
cp tmp/redesign-shots/toast.png docs/screenshots/toast.png
cp tmp/redesign-shots/popout.png docs/screenshots/oncall-popout.png
```

## Project Layout

- `src/main/`: Electron main process, PocketBase bootstrap, IPC handlers, cache, backups, and Dynatrace popout windows
- `src/preload/`: typed `window.api` bridge
- `src/renderer/`: React UI, hooks, services, tabs, and styles
- `src/shared/`: shared types, IPC channel definitions, validation, and utilities
- `docs/`: contributor-facing architecture, development, design, and security docs

## License

MIT
