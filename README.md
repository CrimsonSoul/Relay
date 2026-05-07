# Relay

Relay is an Electron desktop command center for operations teams managing people, systems, schedules, and incident communications.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-0a7ea4) ![Shell](https://img.shields.io/badge/shell-Electron%2041-47848f) ![UI](https://img.shields.io/badge/ui-React%2019-149eca) ![Language](https://img.shields.io/badge/language-TypeScript%206.0-2ea043)

## Snapshot

- Embedded PocketBase for local-first data storage and realtime sync
- Typed preload bridge with Zod-validated IPC contracts
- Feature tabs for compose, on-call, directories, alerts, notes, and status monitoring
- Offline cache and pending-change replay for reconnect scenarios
- Electron hardening with context isolation, sandboxing, CSP, and path validation

## Preview

| Compose                                      | On-Call Board                               |
| -------------------------------------------- | ------------------------------------------- |
| ![Compose tab](docs/screenshots/compose.png) | ![On-Call tab](docs/screenshots/oncall.png) |

## Core Features

- **Compose**: Build bridge communication lists from contacts and saved groups
- **On-Call Board**: Manage team and role coverage with drag-and-drop scheduling and pop-out support
- **People and Servers**: Search large directories, open context actions, and keep entity notes close to the record
- **Alerts**: Compose styled incident cards, apply severity formatting, and capture them to disk or clipboard
- **Notes**: Maintain standalone tagged notes with reorderable cards and adjustable reading density
- **Cloud Status**: Monitor provider incident feeds across major cloud and SaaS vendors

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
npm run build
```

## Project Layout

- `src/main/`: Electron main process, PocketBase bootstrap, IPC handlers, cache, and backup logic
- `src/preload/`: typed `window.api` bridge
- `src/renderer/`: React UI, hooks, services, tabs, and styles
- `src/shared/`: shared types, IPC channel definitions, validation, and utilities
- `docs/`: contributor-facing architecture, development, design, and security docs

## License

MIT
